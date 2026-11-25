"""The background wall the storefront lab's Opus reader saw on each building, applied to every
side of its shell, and the fallback for shops nobody read (smc.exteriors.wall_materials)."""

from __future__ import annotations

import json
from pathlib import Path

from smc.exteriors import wall_materials as W

ROOT = Path(__file__).resolve().parents[1]


def _obs(*edges, conf=0.6):
    return {"observations": [{"path": f"walls.{e}.material", "value": "x",
                              "evidence": {"read_by": "claude-opus-5-5", "confidence": conf}} for e in edges]}


def _model(**kw):
    m = {"id": "m", "app_building": "1", "height_m": 10.0, "business_type": {"render": "restaurant"},
         "walls": [{"id": "w0", "length_m": 10.0, "material": "wood_siding", "colour": "#8a6f52", "openings": []},
                   {"id": "w1", "length_m": 4.0, "material": "brick", "colour": "#9c5540", "openings": []}],
         "storefronts": []}
    m.update(kw)
    return m


def test_only_read_walls_count_and_the_largest_solid_material_wins():
    b = W.background([(_model(), _obs(0, 1))])
    assert b["class"] == "wood_siding" and b["colour"] == "#8a6f52"
    assert b["by_class"] == {"wood_siding": 100.0, "brick": 40.0}
    # wall 0 was never read: what the app guessed for it says nothing
    assert W.background([(_model(), _obs(1))])["class"] == "brick"


def test_windows_doors_and_shopfront_glass_are_cut_out_before_counting():
    m = _model()
    m["walls"][0]["openings"] = [{"kind": "window", "u": 1, "v": 4, "w": 8, "h": 5}]  # 40 of 100 m2
    m["storefronts"] = [{"id": "s", "edge": 0, "u0": 0, "u1": 10, "band_h": 3.0, "material": "tile",
                         "palette": {"wall": "#ffffff"}, "openings": [{"kind": "glazing", "w": 8, "h": 2.5}]}]
    parts = {p["part"]: p for p in W.solid_parts(m, {0: 0.6})}
    assert parts["s"]["solid_m2"] == 10.0  # a 30 m2 band less 20 m2 of glass
    assert parts["w0"]["solid_m2"] == 30.0  # 100 less the band less the upper windows
    assert W.background([(m, _obs(0))])["class"] == "wood_siding"


def test_glass_is_never_a_background_and_two_tenants_pool():
    glass = _model(walls=[{"id": "w0", "length_m": 10.0, "material": "glass", "colour": "#88aacc"}])
    assert W.background([(glass, _obs(0))]) is None
    other = _model(id="n", walls=[{"id": "w0", "length_m": 30.0, "material": "brick", "colour": "#9c5540"}])
    b = W.background([(_model(), _obs(0)), (other, _obs(0))])
    assert b["class"] == "brick" and b["read_walls"] == ["m:0", "n:0"]


def test_type_priors_need_enough_read_buildings():
    log = {"buildings": {str(i): {"class": "stucco_render", "colour": f"#0000{i:02x}", "kind": "restaurant",
                                  "by_class": {"stucco_render": 60.0, "wood_siding": 40.0}} for i in range(12)}}
    log["buildings"]["r"] = {"class": "brick", "colour": "#9c5540", "kind": "retail", "by_class": {"brick": 9.0}}
    priors = W.type_priors(log)
    assert set(priors) == {"restaurant"}
    assert priors["restaurant"]["class"] == "stucco_render" and priors["restaurant"]["confidence"] == 0.45
    assert len(priors["restaurant"]["colours"]) == 12


def test_the_published_assignments_carry_the_log():
    log = json.loads((ROOT / "data/sf_public_works/opus_wall_materials.json").read_text())
    out = json.loads((ROOT / "docs/sf-corridor-materials.json").read_text())
    assert log["schema"] == W.SCHEMA and len(log["buildings"]) >= 100
    for key, b in log["buildings"].items():
        if key in out["walls"]:
            assert out["assigned"][key]["basis"] == "opus_wall_reading"
            assert out["walls"][key][:1] == [b["class"]] and out["walls"][key][2] == "o"
    assert {"restaurant", "retail"} <= set(out["type_priors"])
    assert all(out["type_priors"][k]["class"] not in {"metal_panel"} for k in out["type_priors"])
