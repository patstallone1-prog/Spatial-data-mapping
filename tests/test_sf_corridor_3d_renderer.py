from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"


def _source() -> str:
    return SOURCE.read_text(encoding="utf-8")


def test_continental_crosswalk_bars_repeat_along_walking_direction() -> None:
    source = _source()

    assert 'if (surface === "crossing") return [CROSSING_PERIOD_M, width];' in source
    assert "ctx.fillRect(1, 0, size * 0.5 - 2, size);" in source
    assert 'if (surface === "crossing") return [1e6, CROSSING_PERIOD_M];' not in source
    assert "ctx.fillRect(0, 1, size, size * 0.5 - 2);" not in source


def test_sidewalk_ribbons_are_clipped_against_carriageways() -> None:
    source = _source()

    assert "function pavementRunsOutsideCarriageway(points, width)" in source
    assert "distanceToSegmentSquared(x, z, ax, az, bx, bz)" in source
    assert "const edge = Math.max(0.2, width / 2 - 0.12);" in source
    assert "insideCarriageway(x + nx * edge, z + nz * edge, 0.12)" in source
    assert "addPavementRibbon(renderPoints, widthMeters" in source
    assert "trimWay(offsetWay(renderPoints, side * (inner + walk / 2))" in source


def test_renderer_clamps_wide_right_of_way_fallbacks() -> None:
    source = _source()

    assert "function renderedRoadWidth(way)" in source
    assert 'const sourceCap = way.road_source === "curb_geometry" ? MAX_RENDER_ROAD_M : MAX_INFERRED_ROAD_M;' in source
    assert "const half = renderedRoadWidth(way) / 2;" in source
    assert "const road = widthMeters;" in source


def test_renderer_densifies_curved_road_markings() -> None:
    source = _source()

    assert "function densifyWay(points, maxSpan = 5.0)" in source
    assert "const renderPoints = densifyWay(way.points);" in source
    assert "groups.streets.add(ribbon(renderPoints, widthMeters" in source
    assert "dashedLine(offsetWay(renderPoints, offset)" in source


def test_lane_centerline_respects_both_official_and_osm_oneway_flags() -> None:
    source = _source()

    assert "const oneway = Boolean(way.oneway || way.osm_oneway);" in source
    assert "const opposing = !oneway" in source
    assert "if (!isSidewalk && !isCrossing && !isPath && !way.oneway)" not in source


def test_building_enrichment_drives_place_archetypes_and_click_info() -> None:
    source = _source()
    assert "const archetype = placeArchetypeMesh(feature, seed);" in source
    assert 'feature.archetype === "gas_station"' in source
    assert 'feature.archetype === "park" || feature.archetype === "mini_golf"' in source
    assert 'feature.archetype === "parking"' in source
    assert "function featureSummary(feature)" in source
    assert "feature.address || {}" in source
    assert "Business: ${place.primary_type.replaceAll" in source
