"""End-to-end pipeline tests.

Kept small on purpose: rendering dominates the runtime, so these use a short corridor and a
handful of frames. They assert that the stages connect and that the guards fire, not that the
accuracy figures hold at scale — that is what the `smc.ingest fullstack` run is for.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from smc import geo
from smc.carla_gen.world import build_corridor
from smc.facts.schema import FactClass, Provenance, Tier
from smc.ingest.capture import RigConfig, survey_pass
from smc.ingest.photobank import GlassesProfile, build_photo_bank, wearer_pose
from smc.ingest.store import LocalFrameStore
from smc.mapping.features import FeatureConfig
from smc.mapping.seeding import seed_index
from smc.overlay.street import corridor_street_map
from smc.pipeline import _reason_counts, run_pipeline, score
from smc.render.raster import corridor_triangles, render_meshes

ORIGIN = geo.Origin(38.9072, -77.0369)
SEED = 20260820


#: Real matching only works when the reference index shares the query's vantage, so the
#: wearer stack is seeded from the footway. See `test_vantage_mismatch_defeats_real_matching`.
FEATURES = FeatureConfig(max_features=4000, contrast_threshold=0.008, min_matches=10)


def footway_survey(corridor: object, profile: GlassesProfile, spacing_m: float = 3.0) -> list:
    """Survey the footway at wearer height and heading."""
    triangles, colours = corridor_triangles(corridor)
    k = profile.intrinsics()
    width, height = profile.resolution()
    frames = []
    for i, station in enumerate(np.arange(4.0, corridor.length_m - 15.0, spacing_m)):  # type: ignore[attr-defined]
        pose = wearer_pose(float(station), profile, 0.0)
        frames.append(
            (f"walk-{i:05d}", render_meshes(triangles, colours, pose, k, width, height), pose)
        )
    return frames


@pytest.fixture(scope="module")
def stack(tmp_path_factory: pytest.TempPathFactory) -> tuple:
    corridor = build_corridor("t", ORIGIN, SEED, n_blocks=1)
    profile = GlassesProfile(photo_width=320, photo_height=240)
    survey = footway_survey(corridor, profile)
    index, report = seed_index(survey, corridor.origin, seed=SEED)
    store = LocalFrameStore(Path(tmp_path_factory.mktemp("bank")))
    bank = build_photo_bank(
        corridor, store, contributor_id="w1", profile=profile, seed=3, max_frames=10
    )
    street = corridor_street_map(corridor)
    result = run_pipeline(
        corridor, index, street, bank, profile=profile, feature_config=FEATURES, seed=5
    )
    return corridor, index, street, bank, profile, result, report


class TestFullStack:
    def test_frames_anchor(self, stack: tuple) -> None:
        """Real feature matching, no oracle.

        Yield is materially below 1.0 and that is the intended trade: strict ratio, mutual and
        geometric filters throw away good matches to remove bad ones, because an unanchored
        frame is withheld while a wrongly anchored one poisons every fact built on it.
        """
        *_, result, _ = stack
        assert result.anchored_count > 0

    def test_anchoring_improves_on_the_gnss_prior(self, stack: tuple) -> None:
        *_, result, _ = stack
        posterior = [
            o.posterior_error_m for o in result.outcomes if o.posterior_error_m is not None
        ]
        priors = [o.prior_error_m for o in result.outcomes]
        assert posterior
        assert float(np.mean(posterior)) < float(np.mean(priors))

    def test_facts_are_emitted_and_placed_on_the_street(self, stack: tuple) -> None:
        *_, result, _ = stack
        assert result.facts
        for outcome in result.outcomes:
            if outcome.facts:
                assert outcome.feature_id is not None
                assert ":" in outcome.feature_id

    def test_curb_height_is_measured_not_inferred(self, stack: tuple) -> None:
        *_, result, _ = stack
        heights = [f for f in result.facts if f.fact_class is FactClass.CURB_HEIGHT]
        assert heights
        assert all(f.provenance is Provenance.MEASURED for f in heights)

    def test_cross_slope_stays_advisory_through_the_whole_stack(self, stack: tuple) -> None:
        """The rule most likely to be lost between layers. Checked at the far end."""
        *_, result, _ = stack
        slopes = [f for f in result.facts if f.fact_class is FactClass.SIDEWALK_CROSS_SLOPE]
        assert slopes
        for fact in slopes:
            assert fact.tier is Tier.C
            assert fact.provenance is Provenance.INFERRED
            assert fact.confidence <= 0.45

    def test_curb_height_is_in_the_right_ballpark(self, stack: tuple) -> None:
        """A loose bound on purpose.

        With strict matching only a handful of frames anchor per fixture, so this statistic is
        a small sample over one corridor's sampled geometry and swings with both. The headline
        figure comes from the larger sweep in docs/09; this guards against the measurement
        being wrong by a bucket, which is what would actually break the product.
        """
        *_, result, _ = stack
        scored = result.scores
        if "curb_height_mae_m" in scored:
            assert scored["curb_height_mae_m"] < 0.10

    def test_facts_carry_position_uncertainty(self, stack: tuple) -> None:
        *_, result, _ = stack
        assert all(f.position_sigma_m > 0.0 for f in result.facts)

    def test_dropped_frames_record_why(self, stack: tuple) -> None:
        *_, result, _ = stack
        reasons = _reason_counts(result.outcomes)
        for outcome in result.outcomes:
            if not outcome.facts and outcome.reason == "":
                pytest.fail("a frame produced no facts and gave no reason")
        assert isinstance(reasons, dict)

    def test_survey_reference_is_centimetre_grade(self, stack: tuple) -> None:
        *_, report = stack
        assert report.mean_reference_sigma_m < 0.10


class TestVantage:
    """The architectural finding: an index only anchors queries from its own vantage."""

    def test_vantage_mismatch_defeats_real_matching(
        self, stack: tuple, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        corridor, _, street, bank, profile, *_ = stack
        rig = RigConfig(width=320, height=240, focal_px=240.0, spacing_m=6.0)
        roadway_index, _ = seed_index(survey_pass(corridor, rig), corridor.origin, seed=SEED)

        mismatched = run_pipeline(
            corridor, roadway_index, street, bank, profile=profile,
            feature_config=FEATURES, seed=5,
        )
        # A roadway survey cannot anchor footway captures with real features...
        assert mismatched.anchored_count == 0
        # ...while the oracle, which never looks at pixels, is blind to the difference.
        oracle = run_pipeline(
            corridor, roadway_index, street, bank, profile=profile,
            matcher="oracle", seed=5,
        )
        assert oracle.anchored_count > 0


class TestScoring:
    def test_scoring_handles_no_overlap(self) -> None:
        assert score((), ()) == {}

    def test_scoring_matches_by_proximity(self, stack: tuple) -> None:
        *_, result, _ = stack
        scored = score(result.facts, result.truth)
        if not result.facts:
            pytest.skip("no facts survived strict matching in this fixture")
        assert scored
        assert all(np.isfinite(v) for v in scored.values())
