from datetime import datetime, timezone

import pytest
from shapely.geometry import Polygon
from shapely.strtree import STRtree

from conftest import frame
from kerbfront.photos.geometry import assess

NOW = datetime(2026, 11, 23, tzinfo=timezone.utc)


def run(block, face, f, cam, **kw):
    a = block["buildings"][face.building_id]
    return assess(face, f, cam, building_h=a.height_m, own=a.poly, tree=block["tree"],
                  polys=block["polys"], now=NOW, **kw)


def test_frontal_frame_across_the_street_passes(block, a_front):
    r = run(block, a_front, frame(heading=180), (5, 28))
    assert r.ok, r.rejects
    assert r.view == "frontal"
    assert r.metrics["incidence_deg"] < 1
    assert r.scores["architecture"] > 0.5 and r.scores["signage"] > 0.4
    assert r.aim["bearing"] == pytest.approx(180, abs=0.5)


def test_camera_behind_the_face_is_rejected(block, a_front):
    assert "behind_face" in run(block, a_front, frame(heading=0), (5, -10)).rejects


def test_looking_away_puts_face_out_of_frame(block, a_front):
    r = run(block, a_front, frame(heading=0), (5, 28))
    assert "face_out_of_frame" in r.rejects


def test_spherical_frames_always_see_the_face(block, a_front):
    r = run(block, a_front, frame(heading=0, camera_type="spherical", hfov=360, width=5760,
                                  height=2880), (5, 28))
    assert r.ok and r.metrics["in_view"] == 1.0
    assert r.aim["rel_to_heading"] == pytest.approx(180, abs=0.5)


def test_range_and_grazing_gates(block, a_front):
    assert "too_far" in run(block, a_front, frame(heading=180), (5, 70)).rejects
    graze = run(block, a_front, frame(heading=100), (-40, 18))
    assert "grazing" in graze.rejects


def test_building_between_camera_and_face_occludes(block, a_front):
    kiosk = Polygon([(-2, 17), (12, 17), (12, 20), (-2, 20)])
    polys = block["polys"] + [kiosk]
    a = block["buildings"]["A"]
    r = assess(a_front, frame(heading=180), (5, 28), building_h=9, own=a.poly,
               tree=STRtree(polys), polys=polys, now=NOW)
    assert "occluded_by_building" in r.rejects
    assert r.metrics["visible"] < 0.2


def test_oblique_views_are_labelled_by_side(block, a_front):
    # a viewer facing this north facade looks south, so their right hand is west (-x)
    left = run(block, a_front, frame(heading=200), (18, 28))
    right = run(block, a_front, frame(heading=160), (-8, 28))
    assert left.ok and right.ok
    assert left.view == "oblique-left" and right.view == "oblique-right"


def test_resolution_rises_as_camera_nears(block, a_front):
    near = run(block, a_front, frame(heading=180), (5, 20))
    far = run(block, a_front, frame(heading=180), (5, 45))
    assert near.metrics["ppm"] > far.metrics["ppm"] * 2


def test_frame_before_tenant_moved_in_cannot_show_its_sign(block, a_front):
    old = run(block, a_front, frame(heading=180, captured_at="2020-05-01T20:00:00+00:00"), (5, 28),
              tenant_since="2023-01-01")
    assert "pre_tenancy" in old.flags
    assert old.scores["signage"] == 0.0
    assert old.scores["architecture"] > 0.2       # the shell is still useful
    new = run(block, a_front, frame(heading=180, captured_at="2024-05-01T20:00:00+00:00"), (5, 28),
              tenant_since="2023-01-01")
    assert new.metrics["tenant_era"] == "current_tenant" and new.scores["signage"] > 0


def test_frame_before_a_sign_permit_is_stale_for_signage(block, a_front):
    r = run(block, a_front, frame(heading=180, captured_at="2022-05-01T20:00:00+00:00"), (5, 28),
            altered_on="2024-03-01")
    assert "pre_alteration" in r.flags and r.scores["signage"] == 0.0


def test_night_and_recency_lower_the_score(block, a_front):
    day = run(block, a_front, frame(heading=180, captured_at="2026-06-01T20:00:00+00:00"), (5, 28))
    night = run(block, a_front, frame(heading=180, captured_at="2026-06-01T08:00:00+00:00"), (5, 28))
    old = run(block, a_front, frame(heading=180, captured_at="2014-06-01T20:00:00+00:00"), (5, 28))
    assert "night" in night.flags
    assert night.scores["architecture"] < day.scores["architecture"]
    assert old.scores["signage"] < day.scores["signage"] * 0.5


def test_close_narrow_lens_misses_the_upper_floors(block, a_front):
    across = run(block, a_front, frame(heading=180, hfov=50, width=4000, height=3000), (5, 28))
    close = run(block, a_front, frame(heading=180, hfov=50, width=4000, height=3000), (5, 18))
    assert across.metrics["cover_storefront"] == pytest.approx(1.0)
    assert close.metrics["cover_storefront"] < 0.6        # 3 m away: a slice of the shopfront
    assert close.metrics["cover_full"] < 0.3


def test_fisheye_is_refused_until_its_lens_is_modelled(block, a_front):
    assert "fisheye_unsupported" in run(block, a_front, frame(camera_type="fisheye"), (5, 28)).rejects
