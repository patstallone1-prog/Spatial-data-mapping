"""The Bay's bridges built to their designs and grounded at both ends; transit ingested; every
stop drawn as what physically stands there; station entrances as stairs down to a wall."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def _ingest():
    spec = importlib.util.spec_from_file_location("ingest_transit", ROOT / "scripts/ingest_transit.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_stop_is_classified_by_what_physically_stands_there() -> None:
    ingest = _ingest()
    base = {"agency": "sfmta", "routes": ["1"], "modes": ["bus"]}
    assert ingest.classify({**base, "type": "FL"}, False) == ("pole", "sfmta_stop_type")
    assert ingest.classify({**base, "type": "BZ"}, False)[0] == "bench"
    assert ingest.classify({**base, "type": "BZ", "routes": ["1", "12"]}, False)[0] == "shelter"
    assert ingest.classify({**base, "type": "SI", "modes": ["tram"]}, False)[0] == "shelter"
    # A shelter OpenStreetMap has mapped is a shelter whatever the stop's type.
    assert ingest.classify({**base, "type": "FL"}, True) == ("shelter", "osm")
    assert ingest.classify({**base, "type": ""}, False) == ("pole", "nothing_published")


def test_every_region_has_its_stops_and_the_schedules_are_kept() -> None:
    ingest = _ingest()
    assert {"sfmta", "bart", "caltrain", "vta", "actransit", "samtrans", "goldengate"} <= set(ingest.FEEDS)
    stops = json.loads((ROOT / "docs/transit-stops.json").read_text())
    assert stops["schema"] == "kerbside.transit_stops/1"
    assert len(stops["stops"]) > 500
    kinds = {s["physical"] for s in stops["stops"]}
    assert kinds == {"shelter", "bench", "pole"}
    assert any(s["painted"] for s in stops["stops"]) and stops["entrances"]
    # The database itself stays out of the repository.
    assert "data/transit/" in (ROOT / ".gitignore").read_text()


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_stops_are_drawn_built_and_painted_and_entrances_go_down() -> None:
    js = _page_js()
    stops = _extract("addTransitStops", js)
    assert 'instanceParts(SHELTER_PARTS, shelters, "furniture:shelter")' in stops
    assert 'instanceParts(BENCH_PARTS, benches, "furniture:bench")' in stops
    assert "busStopText()" in stops and "insideJunctionBox(px, pz)" in stops
    text = _extract("busStopText", js)
    assert '"STOP"' in text and '"BUS"' in text
    # The agencies' stops replace OpenStreetMap's where a region has them.
    assert 'fetch(asset("transit-stops.json")' in js
    entrances = _extract("addStationEntrances", js)
    assert "stationMaterials.dark" in entrances and "standingSurfaces.add(surface)" in entrances
    assert "stationWalls.push" in entrances
    portal = _extract("portalMaterialFor", js)
    assert "gl_FragDepth = 1.0" in portal and "THREE.EqualStencilFunc" in portal


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_great_bridges_are_built_to_their_designs_and_meet_the_ground() -> None:
    js = _page_js()
    paint = _extract("bridgePaint", js)
    assert "goldenGate: 0xc0362c" in paint and "walkRed:" in paint
    build = _extract("buildBayBridges", js)
    for part in ('named.has("golden_gate")', 'named.has("bay_west")', 'named.has("bay_east")', 'named.has("richmond")'):
        assert part in build
    # The towers in their setbacks, the cables, the suspenders, red walkways behind orange rails.
    assert "towerTop = water + 227" in build and "cable(pts3, 0.46, orange)" in build
    assert "walkColor: BRIDGE_PAINT.walkRed, railColor: BRIDGE_PAINT.goldenGate" in build
    # Every end on the ground: a headland at the deck's level, or a viaduct down to the ground.
    assert "headland(" in build and "ramp(line[0], line[1], h[0], spec)" in build
    assert "earthDrop(p.getX(i), p.getZ(i))" in build
    design = _extract("bridgeDesign", js)
    assert '"golden_gate"' in design and '"bay"' in design and '"trestle"' in design


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_region_bridge_is_carried_between_its_abutments() -> None:
    js = _page_js()
    assert "WAY_LIFT = centralDeck || BRIDGE_LIFTS.get(way) ||" in js
    assert "counts.get(keyOf(x, z)) === 1" in js            # an end no other bridge way shares
    assert 'userData = { surface: "bridge_parapet"' in js


def test_a_busway_is_its_own_lanes_down_the_middle() -> None:
    spec = importlib.util.spec_from_file_location("builder", ROOT / "scripts/build_sf_corridor_3d.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)

    class Frame:
        def to_xy(self, lon, lat):
            return lon * 88000.0, lat * 111320.0

    # Two one-lane busways side by side are each a lane, not a street's width.
    ways = [{"busway": True, "points": [[-122.4232, 37.7940], [-122.4232, 37.7950]]},
            {"busway": True, "points": [[-122.42324, 37.7940], [-122.42324, 37.7950]]}]
    builder.busway_widths(ways, Frame())
    assert all(way["road_m"] < 4.0 for way in ways)
    corridor = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    busways = [w for w in corridor["ways"] if w.get("busway")]
    assert busways and all(w["road_m"] <= 7.2 and not w.get("osm_walk_sides") for w in busways)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_busway_is_painted_and_its_stations_are_islands() -> None:
    js = _page_js()
    # The kerbs either side of the avenue never widen a busway to the avenue.
    assert "if (way.busway) return false;" in _extract("recentreOnKerbEnvelope", js)
    # Red between junctions, so the crosswalks run across it.
    assert 'if (insideJunctionBox(x, -y)) paintRun(); else run.push(point);' in js
    assert 'addMerged("busway:fill", fill, "busway")' in js
    canopy = _extract("isTransitCanopy", js)
    assert 'tags.shelter_type === "public_transport"' in canopy and "nearBusway(x, -y, 9)" in canopy
    assert "TRANSIT_CANOPIES.push(way);" in js
    islands = _extract("addTransitIslands", js)
    assert "TRANSIT_ISLAND_SPOTS.push(...islands)" in islands


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_crossing_mapped_across_a_divided_avenue_is_painted_kerb_to_kerb() -> None:
    js = _page_js()
    across = _extract("acrossTheWholeRoad", js)
    # Straight across, cast to the kerbs at the mapped line's two ends, not the median's.
    assert "CROSSING_STRAIGHT_M" in across and "near(length) ?? length" in across
    assert "more = insideCarriageway(ax + ux * t, az + uz * t, 0.0);" in across
    span = _extract("crossingRoadSpanPoints", js)
    assert "endCrossingOnDrawnKerb(acrossTheWholeRoad(curbSpan, points))" in span
    assert "acrossTheWholeRoad(fallback, points)" in span
    # Island stops are laid along the busway, beside its lane, out of the junction.
    stops = _extract("addTransitStops", js)
    assert "nearestBuswayAt(x, z, 14)" in stops and "insideJunctionBox(cx + lane.ux * a, cz + lane.uz * a)" in stops
