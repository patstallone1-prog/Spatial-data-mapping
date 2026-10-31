"""Evidence retention, category/chain coverage and actual exterior geometry consumers."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import subprocess
from pathlib import Path

import pytest
from shapely import affinity
from shapely.geometry import LineString, box, mapping, shape

from smc.exteriors import ExteriorInput, infer_exterior
from smc.exteriors.bundle import build_bundle
from smc.exteriors.interiors import interior_envelope
from smc.exteriors.kerbside import from_kerbside
from smc.exteriors.library import brand_for, category, library
from smc.exteriors.validate import validate_exterior

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "tests/fixtures/storefront-exteriors.json"
ASSETS = ROOT / "src/smc/exteriors/assets"
RENDERER = (ROOT / "src/smc/exteriors/renderer.mjs").as_uri()


@pytest.fixture(scope="module")
def cohort():
    rows = json.loads(INPUTS.read_text())
    return rows, {r["id"]: infer_exterior(ExteriorInput.from_json(r)) for r in rows}


def test_reference_library_has_primary_sources_and_explicit_limits():
    data = library()
    assert len(data["sources"]) >= 40 and len(data["categories"]) >= 25
    assert len(data["brands"]) >= 13
    assert data["curation"]["not_a_representative_survey"] is True
    for source in data["sources"]:
        assert source["url"].startswith("https://") and source["observations"]
        assert "2026-10-29" <= source["reviewed_at"] <= data["version"]
    for profile in data["categories"].values():
        assert "not surveyed" in profile["parameter_basis"]
    assert "historic_approved_proposal" in {r["kind"] for r in data["sources"]}


def test_official_brand_assets_are_unchanged_and_svg_has_no_executable_content():
    rows = json.loads((ASSETS / "manifest.json").read_text())["assets"]
    assert set(rows) >= {"starbucks", "subway", "safeway", "seven_eleven", "whole_foods"}
    for row in rows.values():
        raw = (ASSETS / row["path"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == row["sha256"]
        assert row["retrieved_at"] and row["source_url"].startswith("https://")
        if row["path"].endswith("svg"):
            assert all(k not in raw.lower() for k in [b"<script", b"<foreignobject", b"onload="])


def test_classification_distinguishes_institutions_and_brand_names_are_not_substrings():
    assert category("assisted living facility") == "senior_living"
    assert category("medical office") == "clinic"
    assert category("convenience store") == "corner_store"
    assert category("diner") == "diner"
    assert category("pizza restaurant") == "pizza"
    assert category("shop", {"amenity": "nursing_home"}) == "senior_living"
    assert category("pharmacy", {"amenity": "doctors"}) == "clinic"
    assert category("grocery", {"shop": "convenience"}) == "corner_store"
    assert brand_for("Subway Electronics") is None
    assert brand_for("Starbucks", None) == "starbucks"
    assert brand_for("Peet\u2019s Coffee") == "peets"
    assert brand_for("7-Eleven") == "seven_eleven"


def test_fixed_programs_pass_without_geometry_replacement_or_dropped_categories(cohort):
    rows, plans = cohort
    assert len(rows) == len(plans) == 48
    assert {r["tenants"][0]["category"] for r in rows} >= set(library()["categories"])
    for row in rows:
        p = plans[row["id"]]
        assert validate_exterior(p)["passed"], (p["id"], p["validation"])
        assert shape(p["footprint"]).equals_exact(shape(row["footprint"]), 0)
        assert p["height_m"] == row["height_m"] and p["canonical_geometry_modified"] is False
        assert p["replica_status"] != "exact_site_replica"
        assert p["references"] and all(f["references"] for f in p["facades"])


def test_observed_windows_balcony_space_and_wall_bands_win_over_brand_style(cohort):
    rows, plans = cohort
    row = next(r for r in rows if r["id"] == "concave-observed")
    p = plans[row["id"]]
    f = p["facades"][0]
    assert len(f["openings"]) == 3
    for src, o in zip(row["frontages"][0]["openings"], f["openings"], strict=True):
        assert o["source_record"] == src and all(o[k] == v for k, v in src.items())
    assert f["observed_bands"] == row["frontages"][0]["bands"]
    branded = copy.deepcopy(row)
    branded["tenants"][0]["brand"] = "starbucks"
    b = infer_exterior(ExteriorInput.from_json(branded))
    assert b["validation"]["passed"] and "identity_band" not in b["facades"][0]
    bad = copy.deepcopy(p)
    bad["facades"][0]["openings"][0]["u"] += 0.1
    assert "observed opening changed or disappeared" in validate_exterior(bad)["errors"]


def test_narrow_store_uses_door_lettering_and_institutions_have_quiet_entry_identity(cohort):
    p = cohort[1]["skinny-door-sign"]
    assert p["facades"][0]["signs"][0]["kind"] == "door_vinyl"
    for key in ["office", "senior_living", "clinic", "school", "civic"]:
        face = cohort[1]["category-" + key]["facades"][0]
        assert all(s["kind"] in {"plaque", "entry_letters", "door_vinyl"} for s in face["signs"])
        assert all(s["illumination"] == "none" for s in face["signs"])
        assert all(s["w"] <= 3.2 for s in face["signs"])


def test_size_and_cost_affect_components_without_making_every_material_one_color(cohort):
    rows = [
        cohort[1]["cost-" + tier]["facades"][0]
        for tier in ("budget", "standard", "premium", "luxury")
    ]
    assert [r["economics"]["tier"] for r in rows] == ["budget", "standard", "premium", "luxury"]
    assert rows[0]["palette"]["roughness"] != rows[-1]["palette"]["roughness"]
    for f in rows:
        assert len(set(f["palette"][k] for k in ("wall", "base", "frame", "accent"))) >= 3
    diner = cohort[1]["category-diner"]["facades"][0]
    cafe = cohort[1]["category-cafe"]["facades"][0]
    assert max(o["w"] for o in diner["openings"] if o["component_kind"] == "window") > max(
        o["w"] for o in cafe["openings"] if o["component_kind"] == "window"
    )


def test_shared_shell_never_repeats_a_neighbors_sign_or_puts_display_glass_in_service_wall(cohort):
    p = cohort[1]["three-neighbor-tenants"]
    assert len(p["facades"]) == 3 and len({f["name"] for f in p["facades"]}) == 3
    for f in p["facades"]:
        assert all(s["text"] == f["name"] for s in f["signs"])
        assert all(f["u0"] <= o["u"] < o["u"] + o["w"] <= f["u1"] for o in f["openings"])
    f = next(f for f in cohort[1]["garage-and-service"]["facades"] if f["role"] == "service")
    assert not f["signs"] and len(f["openings"]) == 1 and f["openings"][0]["kind"] == "loading"


def test_complete_observed_sign_and_opening_ledger_is_retained(cohort):
    row = next(r for r in cohort[0] if r["id"] == "complete-observed-front")
    face = cohort[1][row["id"]]["facades"][0]
    assert len(face["signs"]) == 1 and len(face["openings"]) == 2
    assert face["signs"][0]["source_record"] == row["frontages"][0]["signs"][0]


def test_wide_grocery_clusters_glazing_and_merges_overlapping_entrance_zones(cohort):
    row = copy.deepcopy(next(r for r in cohort[0] if r["id"] == "chain-safeway"))
    row["frontages"][0]["openings"] = [
        dict(id=f"door-{i}", kind="door", u=u, w=2.4, v=0, h=2.35, measured=True)
        for i, u in enumerate([8, 11])
    ]
    for zones in (None, [dict(u=0, w=25), dict(u=18, w=22)]):
        if zones:
            row["frontages"][0]["glazing_zones"] = zones
        p = infer_exterior(ExteriorInput.from_json(row))
        assert p["validation"]["passed"], p["validation"]
        if zones is None:
            windows = [o for o in p["facades"][0]["openings"] if o["component_kind"] == "window"]
            assert max(o["u"] + o["w"] for o in windows) < 23
            assert any(o.get("role") == "entry_transom" for o in windows)


def test_rotated_and_reversed_outlines_keep_normals_outward_and_observations_stable(cohort):
    for angle, reverse in [(23, False), (-47, True)]:
        row = copy.deepcopy(cohort[0][0])
        p = affinity.rotate(shape(row["footprint"]), angle, origin=(0, 0))
        if reverse:
            p = shape({"type": "Polygon", "coordinates": [list(p.exterior.coords)[::-1]]})
        row["footprint"] = mapping(p)
        result = infer_exterior(ExteriorInput.from_json(row))
        assert result["validation"]["passed"]
        f = result["facades"][0]
        q = LineString([f["a"], f["b"]]).interpolate(0.5, normalized=True)
        assert not p.covers(
            shape(
                {
                    "type": "Point",
                    "coordinates": [q.x + f["normal"][0] * 0.1, q.y + f["normal"][1] * 0.1],
                }
            )
        )


def mapped_way():
    lon, lat = -122.43, 37.79
    scale = 111320 * math.cos(math.radians(lat))
    return dict(
        kind="building",
        osm_id=1234,
        name="Subway",
        height_m=4.2,
        points=[
            [lon + x / scale, lat + y / 111320]
            for x, y in [(0, 0), (10, 0), (10, 14), (0, 14), (0, 0)]
        ],
        centroid=[lon, lat],
        shops=[dict(n="Subway", t="restaurant")],
    )


def test_kerbside_adapter_uses_actual_polygon_and_rejects_stale_or_conflicting_fits():
    way = mapped_way()
    old = copy.deepcopy(way)
    fit = dict(
        canonical_footprint=way["points"],
        height_m=4.2,
        a=way["points"][1],
        b=way["points"][0],
        review_status="reviewed_inferred_visual_parameters",
        openings=[dict(id="source-window", kind="window", u=1, w=2, v=0.5, h=2)],
    )
    p = infer_exterior(from_kerbside(way, fit=fit))
    assert way == old and p["canonical_points"] == way["points"]
    window = next(o for o in p["facades"][0]["openings"] if o.get("kerbside_source_record"))
    assert window["u"] == pytest.approx(7) and window["w"] == pytest.approx(2)
    assert window["kerbside_source_record"] == fit["openings"][0]
    fit["height_m"] += 1
    with pytest.raises(ValueError, match="stale"):
        from_kerbside(way, fit=fit)
    fit["height_m"] = 4.2
    fit["conflicts"] = ["new measurement disagrees"]
    with pytest.raises(ValueError, match="conflicts"):
        from_kerbside(way, fit=fit)


def test_paired_interior_protects_service_rooms_preserves_entry_and_exports_one_window_ledger(
    cohort,
):
    h = json.loads((ROOT / "docs/inferred-stores/retail-corner-snacks.json").read_text())
    entry = next(o for o in h["storeys"][0]["openings"] if o.get("entrance"))
    source_segment = shape(entry["source_segment"])
    ring = list(shape(h["storeys"][0]["footprint"]).exterior.coords)
    edge = next(
        i
        for i in range(len(ring) - 1)
        if LineString(ring[i : i + 2]).buffer(0.001).covers(source_segment)
    )
    row = dict(
        id="paired-store",
        footprint=h["storeys"][0]["footprint"],
        height_m=3.6,
        tenants=[dict(id="A", name="Paired Store", category="corner_store")],
        frontages=[dict(edge=edge, tenant_id="A")],
        interior=h,
    )
    p = infer_exterior(ExteriorInput.from_json(row))
    assert p["validation"]["passed"]
    doors = [o for o in p["facades"][0]["openings"] if o["component_kind"] == "door"]
    assert len(doors) == 1 and doors[0].get("paired_interior_record")
    assert doors[0]["u"] == pytest.approx(1.9) and doors[0]["w"] == pytest.approx(1.2)
    e = interior_envelope(p, {"balconies": [{"id": "preserve"}]})
    assert e["balconies"] == [{"id": "preserve"}]
    assert len(e["windows"]) == sum(
        o["component_kind"] == "window" for f in p["facades"] for o in f["openings"]
    )
    assert e["exterior_entrances"][0]["point"] == pytest.approx([2.5, 0])
    wrong = copy.deepcopy(row)
    wrong["frontages"][0]["edge"] = (edge + 1) % (len(ring) - 1)
    rejected = infer_exterior(ExteriorInput.from_json(wrong))
    assert not rejected["validation"]["passed"]
    assert not any(o["component_kind"] == "door" for o in rejected["facades"][0]["openings"])
    extra = copy.deepcopy(row)
    extra["frontages"].append(
        dict(edge=(edge + 2) % (len(ring) - 1), tenant_id="A", role="secondary")
    )
    paired = infer_exterior(ExteriorInput.from_json(extra))
    assert paired["validation"]["passed"]
    assert paired["facades"][1]["opaque_room_zones"]
    assert not any(o["component_kind"] == "window" for o in paired["facades"][1]["openings"])
    row["footprint"] = mapping(box(0, 0, 100, 100))
    with pytest.raises(ValueError, match="differs"):
        infer_exterior(ExteriorInput.from_json(row))


def test_conflicting_source_windows_are_reported_and_not_moved(cohort):
    row = copy.deepcopy(next(r for r in cohort[0] if r["id"] == "concave-observed"))
    row["frontages"][0]["openings"][1]["u"] = 1
    p = infer_exterior(ExteriorInput.from_json(row))
    assert not p["validation"]["passed"]
    assert p["facades"][0]["openings"][1]["u"] == 1
    assert (
        "facade openings overlap; preserve evidence and resolve conflict"
        in p["validation"]["errors"]
    )


def test_bundle_keeps_fixed_rejections_and_never_mutates_input_world(cohort, tmp_path):
    rows = copy.deepcopy(cohort[0][:2])
    rows[1]["footprint"] = mapping(box(0, 0, 0.5, 0.5))
    world = {"ways": [mapped_way()]}
    before = copy.deepcopy(world)
    result = build_bundle(tmp_path, inputs=rows, world=world, limit=1)
    assert world == before
    assert len(result["selected"]) == 3 and len(result["rejected"]) == 1
    assert result["rejected"][0]["id"] == rows[1]["id"]
    assert (tmp_path / "index.html").is_file() and (tmp_path / "renderer.mjs").is_file()
    assert (
        json.loads((tmp_path / "world.json").read_text())["storefront_exteriors"]["renderer"]
        == "renderer.mjs"
    )


def test_runtime_binding_rejects_stale_and_displaced_facades(tmp_path):
    way = mapped_way()
    p = infer_exterior(from_kerbside(way))
    path = tmp_path / "binding.json"
    path.write_text(json.dumps(dict(way=way, plan=p)))
    js = f"""
import fs from 'node:fs';import {{boundExterior}} from {json.dumps(RENDERER)};
const d=JSON.parse(fs.readFileSync(process.argv[1]));const collection={{buildings:{{1234:d.plan}}}};
if(!boundExterior(d.way,collection))throw Error('valid binding rejected');
for(const change of [p=>p.height_m++,p=>p.canonical_points[0][0]+=.01,
 p=>p.origin_lon_lat[0]+=.01,p=>p.facades[0].a[0]+=1,p=>p.facades[0].u1=1e6,
 p=>p.validation.passed=false]){{const p=structuredClone(d.plan);change(p);
 if(boundExterior(d.way,{{buildings:{{1234:p}}}}))throw Error('stale binding accepted');}}
console.log('bound');
"""
    assert (
        subprocess.check_output(
            ["node", "--input-type=module", "-e", js, str(path)], text=True
        ).strip()
        == "bound"
    )


def sign_case(doors, **frontage):
    return ExteriorInput.from_json(
        dict(
            id="entry-centered-sign",
            footprint=mapping(box(0, 0, 20, 12)),
            height_m=4,
            tenants=[dict(id="A", name="Neighborhood Store", category="shop", sign_type="fascia")],
            frontages=[
                dict(
                    edge=3,
                    tenant_id="A",
                    role="public",
                    openings=doors,
                    openings_complete=True,
                    **frontage,
                )
            ],
        )
    )


@pytest.mark.parametrize(
    "doors",
    [
        [dict(kind="door", u=15, w=1.2, v=0, h=2.35)],
        [
            dict(kind="door", u=2, w=1.1, v=0, h=2.35),
            dict(kind="door", u=12, w=2.4, v=0, h=2.35, leaf_count=2),
        ],
        [dict(kind="door", u=18.4, w=1, v=0, h=2.35)],
    ],
)
def test_default_sign_centers_on_entrance_span_and_shrinks_before_shifting(doors):
    p = infer_exterior(sign_case(doors))
    assert p["validation"]["passed"]
    s = p["facades"][0]["signs"][0]
    target = (min(d["u"] for d in doors) + max(d["u"] + d["w"] for d in doors)) / 2
    assert s["u"] + s["w"] / 2 == pytest.approx(target)
    assert 0 <= s["u"] < s["u"] + s["w"] <= 20


def test_default_sign_respects_protected_detail_and_preserves_source_sign_position():
    doors = [dict(kind="door", u=15, w=1.2, v=0, h=2.35)]
    protected = dict(u=14, w=3, v=3, h=0.8, kind="balcony")
    p = infer_exterior(sign_case(doors, protected_rectangles=[protected]))
    assert p["validation"]["passed"]
    s = p["facades"][0]["signs"][0]
    assert s["u"] + s["w"] <= protected["u"] or s["u"] >= protected["u"] + protected["w"]
    observed = dict(id="observed-sign", kind="fascia", u=0.3, w=3, v=3.1, h=0.5, measured=True)
    p = infer_exterior(sign_case(doors, signs=[observed], signs_complete=True))
    s = p["facades"][0]["signs"][0]
    assert p["validation"]["passed"] and s["u"] == 0.3 and s["source_record"] == observed


def test_sign_alignment_uses_customer_entries_not_upper_or_service_doors():
    doors = [
        dict(kind="door", u=15, w=1.2, v=0, h=2.35),
        dict(kind="door", u=2, w=1.2, v=4.2, h=2.35, role="balcony"),
        dict(kind="door", u=5, w=1.2, v=0, h=2.35, role="emergency_exit"),
    ]
    base = sign_case(doors)
    spec = ExteriorInput(
        base.id, base.footprint, 8, base.tenants, base.frontages, ground_height_m=4
    )
    p = infer_exterior(spec)
    s = p["facades"][0]["signs"][0]
    assert p["validation"]["passed"]
    assert s["u"] + s["w"] / 2 == pytest.approx(15.6)
