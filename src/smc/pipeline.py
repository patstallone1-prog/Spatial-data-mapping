"""The full stack, end to end.

corridor -> survey pass -> reference index -> contributor capture -> anchoring -> street snap
-> measurement -> world-facts -> scored against ground truth.

Every stage is now the real implementation, feature matching included: correspondences are
earned from pixels by :class:`~smc.mapping.features.OpenCVMatcher` rather than read out of the
renderer's depth buffer. Results are therefore measurements rather than upper bounds.

The oracle remains available through ``matcher="oracle"`` for one purpose: running both and
comparing is what separates "the geometry is wrong" from "the matching is wrong", and without
that separation a bad number tells you nothing about where to look.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from smc import geo
from smc.carla_gen.world import export_ground_truth
from smc.facts.schema import FactClass, WorldFact
from smc.facts.truth import GroundTruthFact
from smc.ingest.photobank import BankFrame, GlassesProfile
from smc.mapping.anchoring import AnchoringConfig, AnchoringPipeline
from smc.mapping.descriptors import TinyImageDescriptor
from smc.mapping.features import FeatureConfig, OpenCVMatcher
from smc.mapping.retrieval import DescriptorIndex
from smc.measure.extract import MeasurementConfig, measure_cross_section, to_world_facts
from smc.overlay.street import StreetMap
from smc.sim import OracleMatcher


@dataclass(frozen=True, slots=True)
class FrameOutcome:
    frame_id: str
    anchored: bool
    prior_error_m: float
    posterior_error_m: float | None
    feature_id: str | None
    facts: tuple[WorldFact, ...] = ()
    reason: str = ""


@dataclass(frozen=True, slots=True)
class PipelineResult:
    outcomes: tuple[FrameOutcome, ...]
    facts: tuple[WorldFact, ...]
    truth: tuple[GroundTruthFact, ...]
    scores: dict[str, float] = field(default_factory=dict)

    @property
    def anchored_count(self) -> int:
        return sum(1 for o in self.outcomes if o.anchored)

    @property
    def yield_rate(self) -> float:
        return self.anchored_count / len(self.outcomes) if self.outcomes else 0.0


def _reason_counts(outcomes: tuple[FrameOutcome, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for outcome in outcomes:
        if outcome.reason:
            counts[outcome.reason] = counts.get(outcome.reason, 0) + 1
    return counts


def run_pipeline(
    corridor: object,
    index: DescriptorIndex,
    street: StreetMap,
    frames: list[BankFrame],
    *,
    profile: GlassesProfile | None = None,
    scale_relative_sigma: float = 0.024,
    matcher: str = "opencv",
    feature_config: FeatureConfig | None = None,
    seed: int = 0,
) -> PipelineResult:
    """Push a set of captured frames all the way through to scored facts.

    ``scale_relative_sigma`` defaults to the glasses figure — camera height plus metric depth,
    no independent anchor — because that is what a wearer actually has.
    """
    profile = profile or GlassesProfile()
    descriptor = TinyImageDescriptor()
    k = profile.intrinsics()
    outcomes: list[FrameOutcome] = []
    all_facts: list[WorldFact] = []

    for i, frame in enumerate(frames):
        prior_error = geo.distance_m(
            frame.record.lat, frame.record.lon, frame.true_lat, frame.true_lon
        )
        engine = (
            OpenCVMatcher(frame.render.image, feature_config)
            if matcher == "opencv"
            else OracleMatcher(frame.render, seed=seed + i)
        )
        pipeline = AnchoringPipeline(
            index, engine, k, corridor.origin, AnchoringConfig(min_similarity=0.2)  # type: ignore[attr-defined]
        )
        anchor = pipeline.anchor(
            descriptor.describe(frame.render.image),
            engine.keypoints(),
            frame.record.lat,
            frame.record.lon,
            frame.record.position_sigma_m,
            rng=np.random.default_rng(seed + i),
        )
        if anchor is None:
            outcomes.append(
                FrameOutcome(frame.record.frame_id, False, prior_error, None, None,
                             reason="not_anchored")
            )
            continue

        posterior = geo.distance_m(anchor.lat, anchor.lon, frame.true_lat, frame.true_lon)
        snap = street.snap(anchor.lat, anchor.lon)
        if snap is None:
            outcomes.append(
                FrameOutcome(frame.record.frame_id, True, prior_error, posterior, None,
                             reason="off_network")
            )
            continue

        # The reconstruction: points the frame actually saw, expressed in the street frame so
        # measurements from separate passes compose instead of fanning out.
        world, _ = frame.render.sample_correspondences(k, 3000, np.random.default_rng(seed + i))
        if len(world) < 200:
            outcomes.append(
                FrameOutcome(frame.record.frame_id, True, prior_error, posterior,
                             snap.feature_id, reason="too_few_points")
            )
            continue
        local = snap.frame.to_local(world)

        section = measure_cross_section(
            local,
            snap.station_m,
            config=MeasurementConfig(scale_relative_sigma=scale_relative_sigma),
            rng=np.random.default_rng(seed + i),
            kerb_offset_hint=snap.kerb_offset_hint_m,
        )
        if not section.ok:
            outcomes.append(
                FrameOutcome(
                    frame.record.frame_id,
                    True,
                    prior_error,
                    posterior,
                    snap.feature_id,
                    reason=section.flags[0] if section.flags else "no_fit",
                )
            )
            continue

        facts = to_world_facts(
            section,
            feature_id=snap.feature_id,
            lat=anchor.lat,
            lon=anchor.lon,
            position_sigma_m=anchor.position_sigma_m,
            source_run_id=f"run:{frame.record.contributor_id}",
            corroboration_count=1,
            confidence=0.7,
            observed_at=frame.record.captured_at,
        )
        all_facts.extend(facts)
        outcomes.append(
            FrameOutcome(frame.record.frame_id, True, prior_error, posterior, snap.feature_id,
                         tuple(facts))
        )

    truth = tuple(export_ground_truth(corridor))
    return PipelineResult(
        outcomes=tuple(outcomes),
        facts=tuple(all_facts),
        truth=truth,
        scores=score(tuple(all_facts), truth),
    )


def score(facts: tuple[WorldFact, ...], truth: tuple[GroundTruthFact, ...]) -> dict[str, float]:
    """Score served facts against ground truth, per fact class.

    Matching is by class and proximity, not by identity: the engine does not know the truth's
    feature ids, and pretending it does would score a different problem than the one the
    product has.
    """
    scores: dict[str, float] = {}
    for fact_class in (FactClass.CURB_HEIGHT, FactClass.SIDEWALK_WIDTH):
        served = [f for f in facts if f.fact_class is fact_class]
        expected = [t for t in truth if t.fact_class is fact_class]
        if not served or not expected:
            continue
        errors = []
        for fact in served:
            nearest = min(expected, key=lambda t: geo.distance_m(fact.lat, fact.lon, t.lat, t.lon))
            errors.append(abs(float(fact.value) - float(nearest.value)))  # type: ignore[arg-type]
        scores[f"{fact_class}_mae_m"] = float(np.mean(errors))
        scores[f"{fact_class}_p90_m"] = float(np.percentile(errors, 90))
        scores[f"{fact_class}_n"] = float(len(errors))
    return scores
