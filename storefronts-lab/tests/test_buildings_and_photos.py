"""The building-model side of the lab: app business types, licence facts, observations,
seating rules and the photo camera model used to rectify walls."""

from __future__ import annotations

import json
import math
import re

import numpy as np
import pytest

from kerbfront import observe
from kerbfront.model import CLEAR_PATH_M, seating_for
from kerbfront.photos.rectify import project, wall_frame
from kerbfront.sources import kerbside


# ---- the app's tenant rules (shopKinds port) ---------------------------------------------------

RULES = [
    {"pattern": r"\b(llc|inc|partners)\b", "kind": None, "replaces": ["*"]},
    {"pattern": r"taco", "kind": "mexican", "replaces": ["restaurant", "shop"], "group": "food"},
    {"pattern": r"wine", "kind": "bar", "replaces": ["restaurant"], "combines": True},
]


@pytest.fixture
def rules(monkeypatch):
    monkeypatch.setattr(kerbside, "_rules", lambda ref=kerbside.REF: [{**t, "re": re.compile(t["pattern"], re.I)} for t in RULES])


def test_shop_kinds_follows_the_app_rules(rules):
    assert kerbside.shop_kinds("restaurant", "Tacolicious") == ["mexican"]
    assert kerbside.shop_kinds("restaurant", "Blue Plate") == ["restaurant"]   # no rule: keeps its tag
    assert kerbside.shop_kinds("shop", "Acme Partners LLC") == []               # office rule
    assert kerbside.shop_kinds(None, None) == []


def _biz(name, category=None, osm_kind=None, likelihood=0.9):
    f = lambda v: {"value": v}  # noqa: E731
    return {"fields": {"name": f(name), "category": f(category), "osm_kind": f(osm_kind), "cuisine": f(None)},
            "storefront_likelihood": likelihood, "address": {}, "occupancy": {}}


def test_business_type_office_rule_needs_no_shop_evidence(rules):
    # a bare registry name with a legal suffix is an office (drawn as a plain building) ...
    office = kerbside.business_type(_biz("Acme Partners LLC"))
    assert office["office"] and office["render"] == "plain_building"
    # ... but a mapped shop keeps its kind whatever its suffix (Books Inc.)
    shop = kerbside.business_type(_biz("Books Inc", category="book_store", osm_kind="shop=books"))
    assert not shop["office"] and shop["kinds"] == ["books"] and shop["render"] == "storefront"
    food = kerbside.business_type(_biz("Tacolicious", category="mexican_restaurant"))
    assert food["render"] == "restaurant"


def test_licence_codes_carry_seating_and_size():
    f = kerbside.licence_facts("RESTAURANT - OVER 2,000 SQFT; FIXED COMMERCIAL PARKLET ; BARS/TAVERNS")
    assert f == {"dining_sqft": (2000, None), "parklet": "commercial", "bar": True}
    assert kerbside.licence_facts(None) == {}


# ---- seating rules --------------------------------------------------------------------------

def test_sidewalk_strip_keeps_six_feet_clear_and_parklet_sits_in_front():
    z = {"outdoor": {"kinds": ["sidewalk", "parklet"], "sources": ["osm", "registry_licence"]}}
    sf = {"id": "sf", "edge": 2, "u0": 3.0, "u1": 9.0}
    out = {s["kind"]: s for s in seating_for(z, sf, {"sidewalk_m": 3.0, "kerb_m": 0.15})}
    strip, park = out["sidewalk_strip"], out["parklet"]
    assert strip["offset_m"] + strip["depth_m"] <= 3.0 - CLEAR_PATH_M + 0.15 + 1e-9
    assert 6.0 <= park["u1"] - park["u0"] <= 12.0 and (park["u0"] + park["u1"]) / 2 == pytest.approx(6.0)
    # too narrow a sidewalk for any table strip: only the parklet
    narrow = seating_for(z, sf, {"sidewalk_m": 2.2})
    assert [s["kind"] for s in narrow] == ["parklet"]


# ---- observations ---------------------------------------------------------------------------

def test_observations_apply_dotted_paths_and_keep_evidence(tmp_path):
    model = {"id": "m", "walls": [{"colour": "#fff"}, {"colour": "#fff"}], "storefronts": []}
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"model": "m", "observations": [
        {"path": "walls.1.colour", "value": "#a4573a", "evidence": {"frames": ["1"], "how": "rectified"}},
        {"path": "roof.parapet_h", "value": 0.5, "evidence": {"frames": ["1"], "how": "rectified"}}]}))
    assert observe.apply_observations(model, p) == 2
    assert model["walls"][1]["colour"] == "#a4573a" and model["roof"]["parapet_h"] == 0.5
    assert model["evidence"]["walls.1.colour"]["kind"] == "observed"
    p.write_text(json.dumps({"model": "m", "observations": [{"path": "height_m", "value": 3}]}))
    with pytest.raises(ValueError):
        observe.apply_observations(model, p)


# ---- the photo camera model -----------------------------------------------------------------

MODEL = {"footprint": [[0, 0], [10, 0], [10, 8], [0, 8]]}  # wall 0 runs east along y=0, faces south


def test_wall_frame_normal_points_out_of_a_ccw_ring():
    a, t, n, L = wall_frame(MODEL, 0)
    assert L == 10 and np.allclose(t, [1, 0]) and np.allclose(n, [0, -1])


def test_spherical_projection_centre_and_vertical():
    photo = {"x": 5, "y": -10, "z": 2.0, "camera_type": "spherical", "heading": 0.0}
    W, H = 4096, 2048
    # straight north at camera height: the panorama's centre column, on the horizon
    x, y = project(MODEL, photo, np.array([[5.0, 0.0, 2.0]]), (H, W))
    assert x[0] == pytest.approx(W / 2) and y[0] == pytest.approx(H / 2)
    # a point 10 m up at 10 m range sits 45 degrees above the horizon
    x, y = project(MODEL, photo, np.array([[5.0, 0.0, 12.0]]), (H, W))
    assert y[0] == pytest.approx(H / 2 - H / 4)
    # the align block moves the camera: raising it 1 m lowers what it sees
    raised = {**photo, "align": {"dz": 1.0}}
    _, y2 = project(MODEL, raised, np.array([[5.0, 0.0, 2.0]]), (H, W))
    assert y2[0] > H / 2


def test_perspective_projection_pinhole():
    photo = {"x": 5, "y": -10, "z": 2.0, "camera_type": "perspective", "heading": 0.0, "hfov": 90.0}
    W, H = 2000, 1500
    x, y = project(MODEL, photo, np.array([[5.0, 0.0, 2.0], [15.0, 0.0, 2.0]]), (H, W))
    assert x[0] == pytest.approx(W / 2) and y[0] == pytest.approx(H / 2)
    # 45 degrees right at hfov 90 lands on the right edge
    assert x[1] == pytest.approx(W) and math.isclose(y[1], H / 2)
