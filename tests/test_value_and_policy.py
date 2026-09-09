"""B8 and B9: the claims each makes, as tests rather than as prose."""

from __future__ import annotations

from smc.enrich.policy import (
    FaceEvidence,
    marginal_value,
    readiness,
    readiness_terms,
)
from smc.enrich.value import WEIGHTS, build_value


def test_the_weights_are_a_distribution() -> None:
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


def test_a_sharp_photograph_of_nothing_loses_to_a_soft_one_of_the_kerb() -> None:
    """The whole reason B8 exists.

    ``resolution_tier`` ranked a twelve megapixel frame pointed at the sky above a two megapixel
    frame with the kerb across the middle of it. In the corridor this is not a hypothetical: the
    top one per cent of frames by value is 3,606 tier C against 80 tier A.
    """
    sky = build_value("sky", megapixels=24.0,
                      semantics={"kerb_value": 0.0, "facade_value": 0.02, "road_value": 0.0,
                                 "occlusion": 0.05},
                      context={"segment_id": "s", "street_side": 1, "station_m": 10.0})
    kerb = build_value("kerb", megapixels=1.6,
                       semantics={"kerb_value": 0.62, "facade_value": 0.4, "road_value": 0.3,
                                  "occlusion": 0.05},
                       pairs={"n_baseline_1_to_3m": 3, "geometry_baseline_m": 1.8,
                              "geometry_parallax_deg": 9.0},
                       pose={"position_sigma_m": 0.3},
                       context={"segment_id": "s", "street_side": 1, "station_m": 10.0})
    assert kerb.scalar() > sky.scalar() * 2


def test_an_ineligible_frame_scores_zero_but_keeps_its_reasons() -> None:
    out = build_value("x", megapixels=20.0, eligible=False,
                      semantics={"kerb_value": 0.9, "facade_value": 0.9, "road_value": 0.9,
                                 "occlusion": 0.0})
    assert out.scalar() == 0.0
    # The components were still computed, so why it was excluded stays inspectable.
    assert "sees_kerb" in out.known


def test_the_limiting_factor_is_the_one_worth_fixing() -> None:
    """Not the smallest component -- the one whose absence costs the most.

    A frame missing the three per cent resolution term is not held back by its sensor.
    """
    frame = build_value("x", megapixels=0.0,
                        semantics={"kerb_value": 0.0, "facade_value": 0.8, "road_value": 0.5,
                                   "occlusion": 0.1},
                        pairs={"n_baseline_1_to_3m": 4, "geometry_baseline_m": 2.0,
                               "geometry_parallax_deg": 10.0},
                        pose={"position_sigma_m": 0.2},
                        context={"segment_id": "s", "street_side": 1, "station_m": 1.0})
    assert frame.limiting_factor() == "sees_kerb"


def test_confidence_separates_a_zero_from_an_unknown() -> None:
    """A frame the semantic pass looked at and found nothing in scores the same as one it never
    reached -- and the two are not the same fact. Confidence is what tells them apart, and it is
    why an absent pass leaves the components at zero rather than at some hopeful default."""
    # Fully occluded, so every measured component really is zero and the scalars are comparable.
    measured = build_value("a", megapixels=4.0,
                           semantics={"kerb_value": 0.0, "facade_value": 0.0, "road_value": 0.0,
                                      "occlusion": 1.0})
    unknown = build_value("b", megapixels=4.0)
    assert measured.scalar() == unknown.scalar() == unknown.resolution * WEIGHTS["resolution"]
    assert measured.confidence() > unknown.confidence()


# ---------------------------------------------------------------- B9


def _face(**kw) -> FaceEvidence:
    base = dict(segment_id="s", side=1, street_name="CLAY ST", length_m=90.0)
    base.update(kw)
    return FaceEvidence(**base)


def test_forty_frames_that_never_see_the_kerb_are_not_a_covered_block() -> None:
    """The density target's first failure, and the reason for a multiplicative readiness."""
    blind = _face(frames=40, kerb_views=tuple([0.0] * 40), best_geometry=0.9, best_pose=0.9)
    assert readiness(readiness_terms(blind)) < 0.1
    _, gain, need = marginal_value(blind)
    assert need == "kerb_view"
    assert gain > 0.15


def test_four_good_frames_beat_forty_blind_ones() -> None:
    good = _face(frames=4, kerb_views=(0.55, 0.48, 0.4, 0.3), best_geometry=0.8, best_pose=0.8,
                 kerb_stations=(8.0, 30.0, 55.0, 82.0), kerb_headings=(10.0, 100.0, 190.0))
    blind = _face(frames=40, kerb_views=tuple([0.0] * 40), best_geometry=0.9, best_pose=0.9)
    assert readiness(readiness_terms(good)) > readiness(readiness_terms(blind))


def test_the_next_frame_is_worth_least_where_the_work_is_already_done() -> None:
    """Marginal value, which is the whole point: a thirteenth frame on a measured face is
    nearly worthless however few frames preceded it."""
    done = _face(frames=6, kerb_views=(0.7, 0.65, 0.6), best_geometry=0.85, best_pose=0.85,
                 kerb_stations=tuple(range(4, 90, 8)),
                 kerb_headings=(20.0, 110.0, 200.0))
    starved = _face(frames=0)
    _, gain_done, _ = marginal_value(done)
    _, gain_starved, need = marginal_value(starved)
    assert gain_starved > gain_done * 4
    assert need == "no photograph at all"


def test_frames_piled_at_one_end_do_not_cover_the_block() -> None:
    clustered = _face(frames=30, kerb_views=tuple([0.5] * 30), best_geometry=0.8, best_pose=0.8,
                      kerb_stations=tuple(2.0 + 0.2 * i for i in range(30)),
                      kerb_headings=(30.0, 120.0, 210.0))
    spread = _face(frames=30, kerb_views=tuple([0.5] * 30), best_geometry=0.8, best_pose=0.8,
                   kerb_stations=tuple(3.0 * i for i in range(30)),
                   kerb_headings=(30.0, 120.0, 210.0))
    terms_clustered = readiness_terms(clustered)
    terms_spread = readiness_terms(spread)
    assert terms_clustered["along"] < terms_spread["along"]
    assert readiness(terms_clustered) < readiness(terms_spread)


def test_a_face_nobody_has_photographed_ranks_above_every_photographed_one() -> None:
    empty = _face(frames=0)
    _, gain_empty, _ = marginal_value(empty)
    for frames in (1, 5, 12, 60):
        seen = _face(frames=frames, kerb_views=tuple([0.45] * frames),
                     best_geometry=0.7, best_pose=0.7,
                     kerb_stations=tuple(6.0 * i for i in range(min(frames, 14))),
                     kerb_headings=(45.0, 135.0))
        _, gain_seen, _ = marginal_value(seen)
        assert gain_empty >= gain_seen


# ---------------------------------------------------------------- A9


def test_a_bay_with_a_neighbourhood_in_it_is_not_a_bay() -> None:
    """The rule that decides which side of a coastline is wet.

    OpenStreetMap's convention is land to starboard. Every one of the seven coastline ways in
    this corridor needed drawing the other way, and taking the convention on trust put a 1.4 km
    band of water over North Beach -- six of the fourteen water polygons covered dry land.

    Counting buildings alone is the wrong test and rejected Aquatic Park, which is a cove with a
    maritime museum and two boathouses on its shore. Density is the test that separates them.
    """
    from scripts.build_sf_corridor_3d import covers_the_city

    # A square kilometre with a city block's worth of buildings scattered through it.
    city = [[-122.410, 37.795], [-122.399, 37.795], [-122.399, 37.804], [-122.410, 37.804]]
    dense = [(-122.410 + 0.0004 * i, 37.795 + 0.0003 * j)
             for i in range(24) for j in range(24)]
    assert covers_the_city(city, dense)

    # The same polygon with a handful of buildings on one edge, as a cove has.
    shore = [(-122.4098, 37.7952), (-122.4094, 37.7951), (-122.4090, 37.7952),
             (-122.4086, 37.7951), (-122.4082, 37.7952), (-122.4078, 37.7951)]
    assert not covers_the_city(city, shore)

    # And a sliver with a few buildings in it is still wrong, however small its area.
    sliver = [[-122.4100, 37.7950], [-122.4096, 37.7950],
              [-122.4096, 37.7952], [-122.4100, 37.7952]]
    assert covers_the_city(sliver, [(-122.4098, 37.7951)] * 6)
