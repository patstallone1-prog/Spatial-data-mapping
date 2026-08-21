"""Tests for config, rendering, the frame store, seeding, and the end-to-end slice."""

from __future__ import annotations

import struct
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from smc import geo
from smc.carla_gen.buildings import Facade, facade_triangles, sample_facades
from smc.carla_gen.world import build_corridor
from smc.config import Settings, load_env_file, redact
from smc.ingest.capture import RigConfig, contributor_pass, pose_at_station, survey_pass
from smc.ingest.store import (
    DEFAULT_RETENTION,
    FrameRecord,
    LocalFrameStore,
    content_id,
    object_store_uri,
)
from smc.mapping.anchoring import AnchoringConfig, AnchoringPipeline
from smc.mapping.descriptors import TinyImageDescriptor
from smc.mapping.seeding import SeedingConfig, seed_index
from smc.render.png import encode_png
from smc.render.raster import corridor_triangles, render_corridor, subdivide
from smc.sim import OracleMatcher

ORIGIN = geo.Origin(38.9072, -77.0369)
SEED = 20260820


@pytest.fixture(scope="module")
def corridor() -> object:
    return build_corridor("t", ORIGIN, SEED, n_blocks=1)


@pytest.fixture(scope="module")
def rig() -> RigConfig:
    return RigConfig(width=192, height=120, focal_px=144.0, spacing_m=8.0)


class TestConfig:
    def test_secrets_are_redacted_by_name(self) -> None:
        assert redact("HUGGINGFACE_TOKEN", "hf_abc123") == "<set:9 chars>"
        assert redact("GOOGLE_MAPS_API_KEY", "x" * 5) == "<set:5 chars>"
        assert redact("SMC_DATABASE_URL", "postgres://h/db") == "postgres://h/db"
        assert redact("ANY_TOKEN", None) == "<unset>"

    def test_describe_never_prints_a_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HUGGINGFACE_TOKEN", "hf_supersecretvalue")
        text = Settings.from_env(env_file=None).describe()
        assert "hf_supersecretvalue" not in text

    def test_env_file_does_not_override_the_environment(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SMC_DATABASE_URL", "postgres://real/db")
        env = tmp_path / ".env.local"
        env.write_text("SMC_DATABASE_URL=postgres://stray/db\n# comment\nEMPTY=\n")
        load_env_file(env)
        assert Settings.from_env(env_file=None).database_url == "postgres://real/db"

    def test_env_file_sets_unset_values(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SMC_ANCHOR_INDEX_URL", raising=False)
        env = tmp_path / ".env.local"
        env.write_text('SMC_ANCHOR_INDEX_URL="gs://bucket/index"\n')
        load_env_file(env)
        assert Settings.from_env(env_file=None).anchor_index_url == "gs://bucket/index"

    def test_missing_env_file_is_not_an_error(self, tmp_path: Path) -> None:
        assert load_env_file(tmp_path / "absent") == {}

    def test_remote_store_detection(self) -> None:
        assert Settings(object_store_url="gs://b").has_remote_store
        assert not Settings(object_store_url="build/data").has_remote_store


class TestPng:
    def test_output_is_a_valid_png(self) -> None:
        image = np.zeros((4, 6, 3), dtype=np.uint8)
        image[1, 2] = (255, 128, 0)
        data = encode_png(image)
        assert data[:8] == b"\x89PNG\r\n\x1a\n"
        width, height, depth, colour = struct.unpack(">IIBB", data[16:26])
        assert (width, height, depth, colour) == (6, 4, 8, 2)

    def test_pixels_survive_the_roundtrip(self) -> None:
        rng = np.random.default_rng(0)
        image = rng.integers(0, 255, (5, 7, 3), dtype=np.uint8)
        data = encode_png(image)
        start = data.index(b"IDAT") + 4
        length = struct.unpack(">I", data[start - 8 : start - 4])[0]
        raw = zlib.decompress(data[start : start + length])
        # Each row carries a leading filter byte.
        rows = [raw[i * (7 * 3 + 1) + 1 : (i + 1) * (7 * 3 + 1)] for i in range(5)]
        assert np.array_equal(np.frombuffer(b"".join(rows), dtype=np.uint8).reshape(5, 7, 3), image)

    def test_rejects_wrong_shape(self) -> None:
        with pytest.raises(ValueError, match=r"\(H, W, 3\)"):
            encode_png(np.zeros((4, 4)))


class TestSubdivision:
    def test_converges_on_a_long_slab(self) -> None:
        """The failure that silently deleted the road: too few passes, no error raised."""
        slab = np.array(
            [
                [[0.0, -9.0, 0.0], [220.0, -9.0, 0.0], [220.0, 0.0, 0.0]],
                [[0.0, -9.0, 0.0], [220.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
            ]
        )
        divided = subdivide(slab, 4.0)
        edges = np.stack(
            [
                np.linalg.norm(divided[:, 1] - divided[:, 0], axis=1),
                np.linalg.norm(divided[:, 2] - divided[:, 1], axis=1),
                np.linalg.norm(divided[:, 0] - divided[:, 2], axis=1),
            ],
            axis=1,
        )
        assert edges.max() <= 4.0

    def test_small_triangles_are_untouched(self) -> None:
        tiny = np.array([[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]])
        assert len(subdivide(tiny, 4.0)) == 1


class TestFacades:
    def test_facades_reproduce_for_a_block(self) -> None:
        a = sample_facades(SEED, "blk1", 110.0, 3.0)
        b = sample_facades(SEED, "blk1", 110.0, 3.0)
        assert a == b

    def test_facades_stay_within_the_block(self) -> None:
        for facade in sample_facades(SEED, "blk1", 110.0, 3.0):
            assert 0.0 <= facade.start_m
            assert facade.start_m + facade.length_m <= 110.0 + 1e-9

    def test_facade_has_vertical_corners(self) -> None:
        """Anchoring locks onto building corners; a flat billboard has none."""
        tris = facade_triangles(Facade(0.0, 12.0, 15.0, 3.0, 3.5, 0.1))
        depths = tris[..., 1]
        assert depths.max() - depths.min() > 1.0


class TestRendering:
    def test_scene_has_ground_and_buildings(self, corridor: object) -> None:
        triangles, _ = corridor_triangles(corridor)
        assert triangles[..., 2].max() > 5.0, "no buildings — anchoring would have no corners"
        assert triangles[..., 1].min() <= -8.0, "no roadway"

    def test_render_is_mostly_geometry_not_sky(self, corridor: object, rig: RigConfig) -> None:
        result = render_corridor(
            corridor, pose_at_station(10.0, rig), rig.intrinsics, rig.width, rig.height
        )
        assert result.coverage > 0.4

    def test_render_has_texture_to_match_on(self, corridor: object, rig: RigConfig) -> None:
        result = render_corridor(
            corridor, pose_at_station(10.0, rig), rig.intrinsics, rig.width, rig.height
        )
        assert result.image.astype(float).std() > 15.0

    def test_detail_is_view_consistent(self, corridor: object, rig: RigConfig) -> None:
        """Surface detail keyed on world position, so the same spot looks the same twice.

        Screen-space noise would look identical to a human and be useless to a matcher.
        """
        near = render_corridor(
            corridor, pose_at_station(20.0, rig), rig.intrinsics, rig.width, rig.height
        )
        shifted = render_corridor(
            corridor, pose_at_station(20.5, rig), rig.intrinsics, rig.width, rig.height
        )
        descriptor = TinyImageDescriptor()
        similarity = float(
            descriptor.describe(near.image) @ descriptor.describe(shifted.image)
        )
        assert similarity > 0.9, similarity

    def test_correspondences_come_only_from_visible_surfaces(
        self, corridor: object, rig: RigConfig
    ) -> None:
        result = render_corridor(
            corridor, pose_at_station(10.0, rig), rig.intrinsics, rig.width, rig.height
        )
        world, pixels = result.sample_correspondences(
            rig.intrinsics, 100, np.random.default_rng(0)
        )
        assert len(world) == len(pixels) > 0
        assert np.all(np.isfinite(world))


class TestDescriptors:
    def test_brightness_invariance(self) -> None:
        rng = np.random.default_rng(0)
        image = rng.integers(0, 200, (64, 96, 3), dtype=np.uint8)
        descriptor = TinyImageDescriptor()
        brighter = np.clip(image.astype(int) + 40, 0, 255).astype(np.uint8)
        assert descriptor.describe(image) @ descriptor.describe(brighter) > 0.95

    def test_unrelated_frames_are_dissimilar(self) -> None:
        rng = np.random.default_rng(0)
        descriptor = TinyImageDescriptor()
        a = descriptor.describe(rng.integers(0, 255, (64, 96, 3), dtype=np.uint8))
        b = descriptor.describe(rng.integers(0, 255, (64, 96, 3), dtype=np.uint8))
        assert abs(float(a @ b)) < 0.3

    def test_featureless_frame_matches_nothing(self) -> None:
        flat = np.full((64, 96, 3), 128, dtype=np.uint8)
        assert np.linalg.norm(TinyImageDescriptor().describe(flat)) < 1e-3

    def test_rejects_images_smaller_than_the_grid(self) -> None:
        with pytest.raises(ValueError, match="smaller than"):
            TinyImageDescriptor(side=32).describe(np.zeros((8, 8, 3), dtype=np.uint8))


class TestFrameStore:
    def _record(self, payload: bytes, **kw: object) -> FrameRecord:
        base = dict(
            frame_id=content_id(payload),
            contributor_id="u1",
            captured_at=datetime.now(UTC),
            lat=38.9,
            lon=-77.0,
            position_sigma_m=0.4,
            camera="cam_mono",
            focal_px=480.0,
            width=640,
            height=400,
            size_bytes=len(payload),
        )
        base.update(kw)
        return FrameRecord(**base)  # type: ignore[arg-type]

    def test_uploads_are_idempotent(self, tmp_path: Path) -> None:
        """A retried chunk must not become a second corroborating observation."""
        store = LocalFrameStore(tmp_path)
        payload = b"frame-bytes"
        record = self._record(payload)
        store.put(payload, record)
        store.put(payload, record)
        assert len(store.list_records()) == 1

    def test_content_addressing_detects_substitution(self, tmp_path: Path) -> None:
        store = LocalFrameStore(tmp_path)
        with pytest.raises(ValueError, match="does not match content hash"):
            store.put(b"other-bytes", self._record(b"frame-bytes"))

    def test_roundtrip(self, tmp_path: Path) -> None:
        store = LocalFrameStore(tmp_path)
        payload = b"frame-bytes"
        record = self._record(payload, cell_id="8a2a", trigger="novelty")
        store.put(payload, record)
        assert store.get(record.frame_id) == payload
        assert store.record(record.frame_id).trigger == "novelty"

    def test_missing_frame_raises(self, tmp_path: Path) -> None:
        store = LocalFrameStore(tmp_path)
        with pytest.raises(KeyError):
            store.get("deadbeef")

    def test_expiry_purges_pixels_but_keeps_provenance(self, tmp_path: Path) -> None:
        """A fact's provenance has to outlive the imagery it came from."""
        store = LocalFrameStore(tmp_path)
        payload = b"frame-bytes"
        record = self._record(payload)
        store.put(payload, record)
        later = record.captured_at + DEFAULT_RETENTION + timedelta(days=1)
        assert store.purge_expired(later) == 1
        assert len(store.list_records()) == 1
        with pytest.raises(KeyError):
            store.get(record.frame_id)

    def test_empty_payload_rejected(self) -> None:
        with pytest.raises(ValueError, match="empty payload"):
            content_id(b"")

    def test_object_store_uri_mirrors_local_layout(self) -> None:
        uri = object_store_uri("gs://spatialdataacquisiton", "ab" + "0" * 30)
        assert uri == "gs://spatialdataacquisiton/frames/ab/" + "ab" + "0" * 30 + ".png"
        with pytest.raises(ValueError, match="gs:// or s3://"):
            object_store_uri("https://example.com", "ab")

    def test_naive_timestamp_rejected(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            self._record(b"x", captured_at=datetime(2026, 8, 20))


class TestFrameConventions:
    def test_mesh_frame_is_the_enu_frame(self, corridor: object, rig: RigConfig) -> None:
        """The bug that produced a constant 6 m anchoring error: two frames, one offset."""
        pose = pose_at_station(30.0, rig)
        via_mesh = corridor.local_to_geodetic(pose.camera_centre)  # type: ignore[attr-defined]
        via_station = corridor.position_at(30.0, lateral_m=rig.lateral_m)  # type: ignore[attr-defined]
        assert geo.distance_m(*via_mesh, *via_station) < 1e-6


class TestEndToEnd:
    def test_survey_seeds_a_centimetre_reference(self, corridor: object, rig: RigConfig) -> None:
        survey = survey_pass(corridor, rig)
        _seeded, report = seed_index(survey, ORIGIN, seed=SEED)
        assert report.ok
        assert report.frames_seeded == len(survey)
        assert report.mean_reference_sigma_m < 0.10

    def test_reference_points_come_from_measurement_not_truth(
        self, corridor: object, rig: RigConfig
    ) -> None:
        """Seeding from the mesh would make the index perfect in a way no rig can be."""
        survey = survey_pass(corridor, rig)[:3]
        strict, _ = seed_index(
            survey, ORIGIN, config=SeedingConfig(depth_relative_sigma=0.0), seed=SEED
        )
        noisy, _ = seed_index(
            survey, ORIGIN, config=SeedingConfig(depth_relative_sigma=0.05), seed=SEED
        )
        a = strict.search(np.ones(256), *corridor.position_at(0.0), radius_m=1e4,  # type: ignore[attr-defined]
                          top_k=1, min_similarity=-1.0)[0]
        b = noisy.search(np.ones(256), *corridor.position_at(0.0), radius_m=1e4,  # type: ignore[attr-defined]
                         top_k=1, min_similarity=-1.0)[0]
        assert not np.allclose(a.frame.points_world, b.frame.points_world)

    def test_contributor_pass_stores_frames_and_hides_truth(
        self, corridor: object, rig: RigConfig, tmp_path: Path
    ) -> None:
        store = LocalFrameStore(tmp_path)
        frames = contributor_pass(corridor, store, contributor_id="u1", config=rig, seed=SEED)
        assert frames
        assert len(store.list_records()) == len(frames)
        record = store.record(frames[0].record.frame_id)
        assert not hasattr(record, "true_lat")
        assert record.position_sigma_m > 0.0

    def test_anchoring_beats_the_gnss_prior_by_an_order_of_magnitude(
        self, corridor: object, rig: RigConfig, tmp_path: Path
    ) -> None:
        """The end-to-end claim. Scored with the oracle matcher, so it is an upper bound."""
        survey = survey_pass(corridor, rig)
        reference_index, _ = seed_index(survey, ORIGIN, seed=SEED)
        store = LocalFrameStore(tmp_path)
        frames = contributor_pass(corridor, store, contributor_id="u1", config=rig, seed=SEED)

        descriptor = TinyImageDescriptor()
        errors: list[float] = []
        priors: list[float] = []
        for frame in frames[:6]:
            matcher = OracleMatcher(frame.render, seed=SEED)
            pipeline = AnchoringPipeline(
                reference_index,
                matcher,
                rig.intrinsics,
                ORIGIN,
                AnchoringConfig(min_similarity=0.25),
            )
            result = pipeline.anchor(
                descriptor.describe(frame.render.image),
                matcher.keypoints(),
                frame.record.lat,
                frame.record.lon,
                frame.record.position_sigma_m,
                rng=np.random.default_rng(SEED),
            )
            priors.append(frame.gnss_error_m)
            if result is not None:
                errors.append(
                    geo.distance_m(result.lat, result.lon, frame.true_lat, frame.true_lon)
                )

        assert errors, "nothing anchored"
        assert float(np.mean(errors)) < float(np.mean(priors)) / 10.0
        assert float(np.median(errors)) < 1.0
