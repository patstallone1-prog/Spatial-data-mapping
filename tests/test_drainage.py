"""The cities' storm and sewer records read into one network (smc.infrastructure.drainage)."""

import pytest

from smc.infrastructure import drainage
from smc.infrastructure.drainage import FT, INCH, build_network, layers_for, to_swmm
from smc.official.city_fetch import Answer

SJ_BOX = {"west": -121.90, "south": 37.32, "east": -121.88, "north": 37.34}


def point(lon, lat, **props):
    return {"geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


def line(coords, **props):
    return {"geometry": {"type": "LineString", "coordinates": coords}, "properties": props}


SAN_JOSE = {
    "Storm Manholes": [point(-121.890, 37.330, FACILITYID="11", RIMELEV=100.0, INVERTELEV=90.0),
                       point(-121.889, 37.330, FACILITYID="12", RIMELEV=99.0, INVERTELEV=88.0)],
    # An inlet numbered like a manhole: each asset type is numbered on its own.
    "Storm Inlets": [point(-121.8885, 37.3301, FACILITYID="11")],
    "Storm Discharge Points": [point(-121.888, 37.330, FACILITYID="5", INVERTELEV=85.0)],
    "Storm Gravity Mains": [
        line([[-121.890, 37.330], [-121.889, 37.330]], FACILITYID="m1", UPID="11", UPTYPE="swManhole",
             DOWNID="12", DOWNTYPE="swManhole", UPELEV=90.0, DOWNELEV=88.0, DIAMETER=24, SLOPE=0.02,
             MATERIAL="RCP", INSTALLYEAR=1952),
        line([[-121.889, 37.330], [-121.888, 37.330]], FACILITYID="m2", UPID="12", UPTYPE="swManhole",
             DOWNID="5", DOWNTYPE="swDischargePoint", UPELEV=88.0, DOWNELEV=85.0, DIAMETER=30),
        # A main the city gives no ends or sizes for: snapped where it meets a node, a junction
        # made where it meets nothing, and not routable.
        line([[-121.8890, 37.33001], [-121.8890, 37.3320]], FACILITYID="m3", MATERIAL="UNK"),
    ],
    "Sanitary Trunk Lines": [
        line([[-121.895, 37.331], [-121.894, 37.331]], FACILITYID="t1", UPELEV=80.0, DOWNELEV=79.0, DIAMETER=36)],
}


def fake_fetch(answers):
    def fetch(record, bbox, say):
        return Answer(list(answers.get(record.title, [])))
    return fetch


def test_only_the_cities_that_reach_the_box_are_asked():
    titles = {ln.record.title for ln in layers_for(SJ_BOX)}
    assert "Storm Gravity Mains" in titles and "swInlet" not in titles
    sf = layers_for({"west": -122.43, "south": 37.75, "east": -122.40, "north": 37.77})
    assert [ln.city for ln in sf] == ["san-francisco"]


def test_san_joses_network_is_joined_by_its_own_ids_in_metres():
    net = build_network("sj", SJ_BOX, fetcher=fake_fetch(SAN_JOSE))
    nodes = {n["id"]: n for n in net["nodes"]}
    assert nodes["san-jose:manhole:11"]["rim_m"] == pytest.approx(100 * FT, abs=1e-3)
    assert nodes["san-jose:manhole:11"]["depth_m"] == pytest.approx(10 * FT, abs=1e-3)
    assert "san-jose:inlet:11" in nodes                      # not the manhole of the same number
    links = {ln["id"]: ln for ln in net["links"]}
    m1 = links["san-jose:gravity_main:m1"]
    assert (m1["up"], m1["down"]) == ("san-jose:manhole:11", "san-jose:manhole:12")
    assert m1["diameter_m"] == pytest.approx(24 * INCH, abs=1e-3)
    assert m1["up_invert_m"] == pytest.approx(90 * FT, abs=1e-3) and m1["routable"]
    assert links["san-jose:gravity_main:m2"]["down"] == "san-jose:outfall:5"
    m3 = links["san-jose:gravity_main:m3"]
    assert m3["up"] == "san-jose:manhole:12"                  # 1 m from the manhole: snapped
    assert m3["down"].startswith("junction:") and not m3["routable"] and "material" not in m3
    assert net["topology"] == {"by_reference": 4, "snapped": 1, "junctions": 3}
    assert net["counts"]["routable_links"] == 3
    assert any("lack an invert" in g for g in net["gaps"])


def test_the_storm_model_is_a_swmm_file_of_what_can_be_routed():
    net = build_network("sj", SJ_BOX, fetcher=fake_fetch(SAN_JOSE))
    inp = to_swmm(net)
    sections = {s.split("]")[0] for s in inp.split("[")[1:]}
    assert {"JUNCTIONS", "OUTFALLS", "CONDUITS", "XSECTIONS", "COORDINATES"} <= sections
    conduits = inp.split("[CONDUITS]")[1].split("[")[0].strip().splitlines()[1:]
    assert len(conduits) == 2                                  # m1, m2; not the trunk, not m3
    outfalls = inp.split("[OUTFALLS]")[1].split("[")[0].strip().splitlines()[1:]
    assert len(outfalls) == 1 and outfalls[0].endswith(f"{85 * FT:.3f} FREE")
    assert "CIRCULAR 0.610" in inp
    assert len(to_swmm(net, system="sanitary").split("[CONDUITS]")[1].split("[")[0].strip().splitlines()) == 2


def test_san_franciscos_catch_basins_are_entry_points_and_its_missing_mains_are_said():
    rows = {"Stormwater inlets, drains and catch basins": [
        point(-122.41, 37.76, puc_maximo_asset_id="N-1", drain_type="Catch Basin Drain", system_use_code="STORM"),
        point(-122.42, 37.761, puc_maximo_asset_id="N-2", drain_type="Catch Basin Drain", system_use_code="COMBINED")]}
    net = build_network("sf", {"west": -122.43, "south": 37.75, "east": -122.40, "north": 37.77},
                        fetcher=fake_fetch(rows))
    assert [n["system"] for n in net["nodes"]] == ["storm", "combined"]
    assert net["links"] == [] and any("not published (SFPUC)" in g for g in net["gaps"])


def test_a_refusal_is_recorded_not_raised():
    def refuse(record, bbox, say):
        return Answer([], refused="token required")
    net = build_network("sj", SJ_BOX, fetcher=refuse)
    assert all(s.get("refused") == "token required" for s in net["sources"])
    assert net["counts"]["nodes"] == 0


def test_every_layer_is_a_known_kind_and_role():
    for layer in drainage.LAYERS:
        assert layer.role in ("node", "link")
        assert layer.system in ("storm", "sanitary", "combined")
        assert layer.license
