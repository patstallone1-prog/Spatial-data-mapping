"""Tests for phone-side photo handling, curation, and compression."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from smc.curate.assess import (
    Assessment,
    CurationConfig,
    Verdict,
    assess,
    curate,
    dhash,
    hamming,
    sharpness,
)
from smc.curate.compress import (
    CompressionProfile,
    ImageFormat,
    fits_budget,
    frames_within_budget,
    plan_compression,
)
from smc.ingest.photos import discover_photos, load_photo, write_synthetic_iphone_photo


def textured(seed: int = 0, shape: tuple[int, int] = (360, 480)) -> np.ndarray:
    """A photo-like frame: low-frequency structure plus fine texture.

    Pure noise is the wrong fixture for anything involving the perceptual hash. dhash reads an
    8x9 thumbnail, so on a photograph it keys on large-scale structure and survives blur; on
    pure noise it keys on nothing but the high frequencies that blur destroys, and a single
    blur pass moves the hash 21 bits. That is a property of the fixture, not of the hash.
    """
    rng = np.random.default_rng(seed)
    height, width = shape
    ys = np.linspace(0, 1, height)[:, None]
    xs = np.linspace(0, 1, width)[None, :]
    # A few broad bands and blobs, seeded so different frames look genuinely different.
    structure = (
        90.0
        + 55.0 * np.sin(2.5 * np.pi * xs + rng.uniform(0, 6))
        + 40.0 * np.cos(1.7 * np.pi * ys + rng.uniform(0, 6))
        + 35.0 * np.sin(3.1 * np.pi * (xs + ys) + rng.uniform(0, 6))
        + 30.0 * np.cos(4.3 * np.pi * xs * ys + rng.uniform(0, 6))
    )
    texture = rng.normal(0.0, 26.0, (height, width))
    gray = np.clip(structure + texture, 0, 255)
    return np.repeat(gray[:, :, None], 3, axis=2).astype(np.uint8)


def blurred(image: np.ndarray, passes: int = 9) -> np.ndarray:
    out = image.astype(float).copy()
    for _ in range(passes):
        out[1:-1] = (out[:-2] + out[1:-1] + out[2:]) / 3
        out[:, 1:-1] = (out[:, :-2] + out[:, 1:-1] + out[:, 2:]) / 3
    return out.astype(np.uint8)


class TestPhotoLoading:
    def test_exif_orientation_is_applied(self, tmp_path: Path) -> None:
        """The failure that looks like a broken matcher and is a broken loader."""
        image = textured(shape=(300, 400))
        path = write_synthetic_iphone_photo(tmp_path / "corner01_a.jpg", image, orientation=6)
        loaded, meta = load_photo(path)
        assert meta.orientation_applied
        assert loaded.shape[:2] == (400, 300)
        assert meta.is_portrait

    def test_landscape_photo_is_left_alone(self, tmp_path: Path) -> None:
        path = write_synthetic_iphone_photo(
            tmp_path / "corner01_a.jpg", textured(shape=(300, 400)), orientation=1
        )
        loaded, meta = load_photo(path)
        assert not meta.orientation_applied
        assert loaded.shape[:2] == (300, 400)

    def test_focal_length_comes_from_exif(self, tmp_path: Path) -> None:
        path = write_synthetic_iphone_photo(
            tmp_path / "a_1.jpg", textured(shape=(300, 400)), focal_35mm=26.0, orientation=1
        )
        _, meta = load_photo(path)
        assert meta.focal_35mm == pytest.approx(26.0)
        # focal_px = width * f35 / 36
        assert meta.focal_px() == pytest.approx(400 * 26.0 / 36.0)
        assert meta.intrinsics() is not None

    def test_missing_exif_is_not_an_error(self, tmp_path: Path) -> None:
        from PIL import Image

        path = tmp_path / "plain_a.png"
        Image.fromarray(textured(shape=(120, 160))).save(path)
        loaded, meta = load_photo(path)
        assert loaded.shape[:2] == (120, 160)
        assert meta.focal_px() is None
        assert meta.intrinsics() is None

    def test_downscales_to_the_resolution_the_glasses_deliver(self, tmp_path: Path) -> None:
        """An iPhone shoots eight times the pixels the toolkit hands over."""
        path = write_synthetic_iphone_photo(
            tmp_path / "big_a.jpg", textured(shape=(1500, 2000)), orientation=1
        )
        loaded, meta = load_photo(path, to_glasses_resolution=True)
        assert loaded.shape[1] == 1440
        assert meta.downscaled_from == (2000, 1500)

    def test_small_photo_is_not_upscaled(self, tmp_path: Path) -> None:
        path = write_synthetic_iphone_photo(
            tmp_path / "small_a.jpg", textured(shape=(240, 320)), orientation=1
        )
        loaded, meta = load_photo(path, to_glasses_resolution=True)
        assert loaded.shape[1] == 320
        assert meta.downscaled_from is None

    def test_discovery_finds_heic_alongside_jpeg(self, tmp_path: Path) -> None:
        for name in ("a.jpg", "b.HEIC", "c.png", "notes.txt", "d.heif"):
            (tmp_path / name).write_bytes(b"x")
        assert {p.name for p in discover_photos(tmp_path)} == {"a.jpg", "b.HEIC", "c.png", "d.heif"}


class TestCurationSignals:
    def test_sharpness_separates_blur_by_orders_of_magnitude(self) -> None:
        crisp = textured()
        assert sharpness(crisp) > 50 * sharpness(blurred(crisp))

    def test_hash_is_stable_under_brightness_change(self) -> None:
        image = textured()
        brighter = np.clip(image.astype(int) + 30, 0, 255).astype(np.uint8)
        assert hamming(dhash(image), dhash(brighter)) <= 2

    def test_hash_separates_different_scenes(self) -> None:
        assert hamming(dhash(textured(1)), dhash(textured(2))) > 12


class TestCuration:
    def _batch(self) -> list[Assessment]:
        base = textured()
        frames = [
            (base, "sharp", "c1"),
            (blurred(base), "blurred", "c1"),
            (np.clip(base.astype(int) * 0.08, 0, 255).astype(np.uint8), "dark", "c1"),
            (np.clip(base.astype(int) * 4.5, 0, 255).astype(np.uint8), "blown", "c1"),
            (base.copy(), "duplicate", "c1"),
        ]
        frames += [(textured(10 + i), f"c2-{i:02d}", "c2") for i in range(14)]
        return [assess(img, fid, cell) for img, fid, cell in frames]

    def _verdict(self, result, frame_id: str) -> Verdict:
        return next(a.verdict for a in result.assessments if a.frame_id == frame_id)

    def test_quality_gates_fire(self) -> None:
        result = curate(self._batch(), CurationConfig(max_per_cell=20, daily_frame_budget=100))
        assert self._verdict(result, "sharp") is Verdict.KEEP
        assert self._verdict(result, "blurred") is Verdict.DROP_BLURRED
        assert self._verdict(result, "dark") is Verdict.DROP_DARK
        assert self._verdict(result, "blown") is Verdict.DROP_BLOWN
        assert self._verdict(result, "duplicate") is Verdict.DROP_DUPLICATE

    def test_blur_gate_is_relative_and_does_not_fire_on_a_uniform_batch(self) -> None:
        """An absolute threshold would drop a whole batch of a low-texture scene."""
        uniform = [assess(textured(i), f"u{i}", "c1") for i in range(16)]
        result = curate(uniform, CurationConfig(max_per_cell=20, daily_frame_budget=100))
        assert all(a.kept for a in result.assessments)

    def test_duplicates_keep_the_sharpest_not_the_first(self) -> None:
        base = textured()
        batch = [
            assess(blurred(base, 3), "soft-first", "c1"),
            assess(base, "crisp-second", "c1"),
        ]
        # Blur gates disabled: this test is about which of two near-identical frames wins.
        result = curate(
            batch,
            CurationConfig(blur_relative_floor=0.0, blur_floor=0.0, max_per_cell=20),
        )
        assert self._verdict(result, "crisp-second") is Verdict.KEEP
        assert self._verdict(result, "soft-first") is Verdict.DROP_DUPLICATE

    def test_cell_quota_caps_dense_coverage(self) -> None:
        batch = [assess(textured(i), f"f{i}", "c1") for i in range(20)]
        result = curate(batch, CurationConfig(max_per_cell=5, daily_frame_budget=100))
        assert len(result.kept) == 5
        assert Verdict.DROP_CELL_FULL in {a.verdict for a in result.dropped}

    def test_budget_trims_depth_not_coverage(self) -> None:
        """A budget cut must not spend the whole day on one street."""
        batch = [assess(textured(i), f"f{i}", f"cell{i % 4}") for i in range(24)]
        result = curate(batch, CurationConfig(max_per_cell=20, daily_frame_budget=8))
        cells = {a.cell_id for a in result.kept}
        assert len(result.kept) == 8
        assert len(cells) == 4, "budget collapsed onto a subset of cells"

    def test_empty_batch_is_handled(self) -> None:
        assert curate([]).assessments == ()

    def test_result_reports_why(self) -> None:
        result = curate(self._batch(), CurationConfig(max_per_cell=3, daily_frame_budget=100))
        assert result.reasons()
        assert 0.0 < result.keep_fraction < 1.0


class TestCompression:
    def test_iphone_frames_cost_the_same_as_glasses_frames(self) -> None:
        """Because both are capped at the delivered resolution before encoding."""
        glasses = plan_compression(100, 1440, 1080)
        iphone = plan_compression(100, 4032, 3024)
        assert iphone.estimated_bytes == pytest.approx(glasses.estimated_bytes, rel=0.02)
        assert iphone.pixel_reduction < 0.2

    def test_avif_beats_heic_beats_jpeg(self) -> None:
        sizes = [
            plan_compression(100, 1440, 1080, CompressionProfile(format=f)).estimated_bytes
            for f in (ImageFormat.AVIF, ImageFormat.HEIC, ImageFormat.JPEG)
        ]
        assert sizes[0] < sizes[1] < sizes[2]

    def test_budget_check(self) -> None:
        plan = plan_compression(900, 1440, 1080)
        assert fits_budget(plan, 250.0)
        assert not fits_budget(plan, 50.0)

    def test_frames_within_budget_is_consistent_with_the_plan(self) -> None:
        count = frames_within_budget(200.0, 1440, 1080)
        assert fits_budget(plan_compression(count, 1440, 1080), 200.0)
        assert not fits_budget(plan_compression(count + 50, 1440, 1080), 200.0)

    def test_rejects_unusable_settings(self) -> None:
        with pytest.raises(ValueError, match="quality"):
            CompressionProfile(quality=0)
        with pytest.raises(ValueError, match="not usable for feature matching"):
            CompressionProfile(max_edge_px=64)
        with pytest.raises(ValueError):
            plan_compression(-1, 100, 100)

    def test_plan_describes_itself(self) -> None:
        assert "MB" in plan_compression(10, 1440, 1080).describe()
