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
from smc.ingest.photobank import GlassesProfile, build_photo_bank
from smc.ingest.store import LocalFrameStore
from smc.mapping.seeding import seed_index
from smc.overlay.street import corridor_street_map
from smc.pipeline import _reason_counts, run_pipeline, score

ORIGIN = geo.Origin(38.9072, -77.0369)
SEED = 20260820


@pytest.fixture(scope="module")
def stack(tmp_path_factory: pytest.TempPathFactory) -> tuple:
    corridor = build_corridor("t", ORIGIN, SEED, n_blocks=1)
    rig = RigConfig(width=224, height=168, focal_px=168.0, spacing_m=10.0)
    survey = survey_pass(corridor, rig)
    index, report = seed_index(survey, corridor.origin, seed=SEED)
    profile = GlassesProfile(photo_width=224, photo_height=168)
    store = LocalFrameStore(Path(tmp_path_factory.mktemp("bank")))
    bank = build_photo_bank(
        corridor, store, contributor_id="w1", profile=profile, seed=3, max_frames=6
    )
    street = corridor_street_map(corridor)
    result = run_pipeline(corridor, index, street, bank, profile=profile, seed=5)
    return corridor, index, street, bank, profile, result, report


class TestFullStack:
    def test_frames_anchor(self, stack: tuple) -> None:
        *_, result, _ = stack
        assert result.anchored_count > 0
        assert result.yield_rate > 0.5

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

    def test_curb_height_lands_in_the_right_bucket(self, stack: tuple) -> None:
        *_, result, _ = stack
        scored = result.scores
        if "curb_height_mae_m" in scored:
            assert scored["curb_height_mae_m"] < 0.05

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


class TestScoring:
    def test_scoring_handles_no_overlap(self) -> None:
        assert score((), ()) == {}

    def test_scoring_matches_by_proximity(self, stack: tuple) -> None:
        *_, result, _ = stack
        scored = score(result.facts, result.truth)
        assert scored
        assert all(np.isfinite(v) for v in scored.values())
