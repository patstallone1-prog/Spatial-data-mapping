"""The Opus reader's answer handling: parsing, clamping to the wall and vocabulary, and the
observation rows it writes (no network, no key)."""

from __future__ import annotations

import copy
import json
from types import SimpleNamespace

from kerbfront.auto import opus as O
from kerbfront.observe import _set


def _base():
    return {
        "id": "t", "business_id": "mb-1", "height_m": 6.6,
        "walls": [{"length_m": 10.0}, {"length_m": 20.0}],
        "storefronts": [
            {"id": "sf-t", "business_id": "mb-1", "name": "Taco Place", "category": "restaurant", "edge": 1,
             "u0": 12.0, "u1": 20.0, "band_h": 3.0},
            {"id": "sf-other-wall", "business_id": "mb-2", "name": "Side", "edge": 0, "u0": 0, "u1": 5, "band_h": 3.0},
        ],
        "seating": [{"id": "s0", "kind": "parklet", "edge": 0, "u0": 1, "u1": 4}],
        "street_objects": [],
    }


ANSWER = {
    "height_m": 7.4, "floors": [{"v": 0, "h": 3.9}, {"v": 3.9, "h": 2.5}],
    "roof": {"cornice": {"h": 0.1, "depth": 0.2, "colour": "#2C5446"}, "parapet_h": 0.6},
    "wall": {"material": "stucco", "colour": "#d8c79b", "trim_colour": "teal",
             "openings": [{"kind": "window", "u": 1, "v": 4, "w": 0.6, "h": 0.9, "glazing": "diamond", "depth": 0.9},
                          {"kind": "porthole", "u": 2, "v": 4, "w": 1, "h": 1},
                          {"kind": "bay", "u": 5, "w": 2.5, "v0": 4, "v1": 6.5, "projection": 0.6}],
             "pilasters": [{"u": [1.5, 3, 99], "w": 0.6, "v0": 5, "v1": 7, "top": "stepped", "flutes": 3}],
             "friezes": [{"v": 5.8, "h": 0.4, "motif": "zigzag", "colour": "#2c5446"}]},
    "storefronts": [
        {"name": "Old Tenant Sign", "u0": 12.2, "u1": 19.9, "band_h": 3.9,
         "openings": [{"kind": "door", "u": 17, "v": 0, "w": 1, "h": 2.4}],
         "awnings": [{"kind": "shed", "u0": 12.3, "u1": 19, "depth_m": 1.05, "colour": "#1d4436"}],
         "extra_signs": [{"kind": "blade", "u": 19.5, "v": 4.2, "w": 1.5, "h": 1.5,
                          "layers": [{"type": "text", "text": "hola", "fill": "#fff"}, {"type": "text", "text": " "}]}]},
        {"name": "Cleaners", "u0": 0.5, "u1": 6.0},
        {"name": "sliver", "u0": 7.0, "u1": 7.2},
    ],
    "seating": [{"kind": "sidewalk_strip", "u0": 12.5, "u1": 18, "barrier": "velvet"}],
    "street_objects": [{"kind": "tree", "u": 14}, {"kind": "unicorn", "u": 3}],
    "confidence": 0.8,
}


def test_parse_takes_the_last_json_block():
    t = 'thinking...\n```json\n{"a": 1}\n```\nwait, corrected:\n```json\n{"a": 2}\n```'
    assert O.parse(t) == {"a": 2}
    assert O.parse('no fence {"b": 3} trailing') == {"b": 3}
    assert O.parse("nothing here") is None


def test_sanitize_clamps_to_the_wall_and_the_vocabulary():
    r = O.sanitize(copy.deepcopy(ANSWER), _base(), 1)
    w = r["wall"]
    assert w["trim_colour"] is None and r["cornice"]["colour"] == "#2c5446"
    kinds = [o["kind"] for o in w["openings"]]
    assert kinds == ["window", "bay"]  # the porthole is not in the vocabulary
    assert w["openings"][0]["depth"] == 0.5  # reveal clamped
    assert w["pilasters"][0]["u"] == [1.5, 3.0, 21.0]  # u clamped to L + 1
    assert "motif" not in w["friezes"][0]
    assert [s["name"] for s in r["storefronts"]] == ["Old Tenant Sign", "Cleaners"]
    blade = r["storefronts"][0]["extra_signs"][0]
    assert len(blade["layers"]) == 1 and "fill" not in blade["layers"][0]  # "#fff" is not #rrggbb
    assert "barrier" not in r["seating"][0]
    assert [o["kind"] for o in r["street_objects"]] == ["tree"]
    assert r["dropped"] == ["opening[1]", "storefront[2]", "street object[1]"]


def test_observations_keep_the_record_tenant_and_other_walls():
    base = _base()
    r = O.sanitize(copy.deepcopy(ANSWER), base, 1)
    rows = O.to_observations(base, 1, r, ["f1"], "test")
    m = copy.deepcopy(base)
    for row in rows:
        _set(m, row["path"], row["value"])
    by_id = {s["id"]: s for s in m["storefronts"]}
    # the pre-tenancy sign name does not replace the record's tenant
    assert by_id["sf-t"]["name"] == "Taco Place" and by_id["sf-t"]["business_id"] == "mb-1"
    assert by_id["sf-t"]["awnings"][0]["depth_m"] == 1.05
    assert "sf-other-wall" in by_id  # the other wall's shop is untouched
    neighbour = next(s for s in m["storefronts"] if s["name"] == "Cleaners")
    assert neighbour["business_id"] is None and neighbour["edge"] == 1
    assert [s["edge"] for s in m["seating"]] == [0, 1]
    assert m["walls"][1]["openings"][1]["kind"] == "bay" and m["height_m"] == 7.4
    assert all("evidence" in row and row["evidence"]["frames"] == ["f1"] for row in rows)
    json.dumps(m)


def test_cost_counts_cached_tokens_at_their_rates():
    u = SimpleNamespace(input_tokens=1_000_000, output_tokens=100_000, cache_read_input_tokens=1_000_000,
                        cache_creation_input_tokens=0)
    assert abs(O.cost(u) - (4.0 + 2.0 + 0.2)) < 1e-9


def test_repeat_lays_a_module_out_exactly():
    parts = [{"kind": "window", "u": 1.28, "v": 4, "w": 0.62, "h": 0.95, "repeat": {"period": 3.3, "count": 3}},
             {"u": [1.59, 2.85], "w": 0.62, "v0": 5, "v1": 7, "repeat": {"period": 3.3, "count": 2}}]
    win, pil = O.expand(parts, 27.4)[:3], O.expand(parts, 27.4)[3]
    assert [w["u"] for w in win] == [1.28, 4.58, 7.88] and all("repeat" not in w for w in win)
    assert pil["u"] == [1.59, 2.85, 4.89, 6.15]


def test_ornaments_and_bands_take_the_shapes_the_studio_draws():
    ans = {"wall": {"ornaments": [{"kind": "panel", "u": 1, "v": 3, "w": 3, "h": 0.4},
                                  {"kind": "medallion", "u": 5, "v": 6, "w": 0.8, "h": 0.8}],
                    "bands": [{"v": 5.0, "h": 1.5, "colour": "#aabbcc"}]}}
    w = O.sanitize(ans, _base(), 1)["wall"]
    assert [o["shape"] for o in w["ornaments"]] == ["rect", "circle"]
    assert w["bands"] == [{"v0": 5.0, "v1": 6.5, "colour": "#aabbcc"}]


def test_a_shop_with_nothing_seen_is_kept_but_not_drawn():
    base = _base()
    r = O.sanitize({"storefronts": [{"name": "Taco Place", "u0": 12, "u1": 20, "band_h": 0.6}]}, base, 1)
    sf = next(row for row in O.to_observations(base, 1, r, [], "t") if row["path"] == "storefronts")["value"]
    mine = next(s for s in sf if s["id"] == "sf-t")
    assert mine["visible"] is False and mine["business_id"] == "mb-1"
