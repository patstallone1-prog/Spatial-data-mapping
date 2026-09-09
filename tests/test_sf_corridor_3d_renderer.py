from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"
GROUND_SOURCE = ROOT / "scripts" / "build_ground_cover.py"


def _source() -> str:
    return SOURCE.read_text(encoding="utf-8")


def _ground_source() -> str:
    return GROUND_SOURCE.read_text(encoding="utf-8")


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
    # What the guard may not do is widen the carriageway before testing it -- see
    # tests/test_corridor_geometry_rules.py, which runs this rule instead of reading it. The
    # literal that used to be asserted here was the bug: it inflated the road by up to 1.15 m
    # and deleted 63 of the 201 km of mapped footway in the corridor.
    assert "const innerEdge = insideCarriageway(x + nx * edge, z + nz * edge, 0.30);" in source
    assert "(innerEdge && outerEdge)" in source
    assert "function trimWalkwayForCorners(points, width)" in source
    assert "addPavementRibbon(surfacePoints, widthMeters" in source
    # The kerbside footway is laid by addKerbsidePavement now, which pins the inner edge to the
    # kerb and narrows the strip until it fits rather than dropping it. Dropping it left 13% of
    # the street network with bare ground between the kerb and the buildings.
    assert "function addKerbsidePavement(" in source
    assert "addKerbsidePavement(renderPoints, side, inner, walk" in source
    assert "WALK_FALLBACK_WIDTHS_M" in source
    # And `sidewalk=no` is believed only where a footway is really mapped in its place.
    assert "function walkSidesToDraw(way, renderPoints, inner)" in source
    assert "mappedWalkNear(x, -y)" in source


def test_alley_mouth_crossings_bridge_sidewalk_cuts() -> None:
    source = _source()

    assert "def alley_mouth_crossings(ways:" in source
    assert 'way.get("service") != "alley"' in source
    assert '"alley_mouth": True' in source
    assert 'const widthMeters = isCrossing ? (way.crossing_m || 3.7)' in source
    assert '((way.continental || way.alley_mouth) ? "crossing" : "crossing_edges")' in source


def test_ground_cover_classifies_small_frontage_and_backyard_remainders() -> None:
    source = _source()
    ground = _ground_source()

    assert "MIN_FRONT_LAWN_DEPTH_M = 2.4" in ground
    assert "MIN_BACKYARD_CELLS = 28" in ground
    assert "def front_setback_depth(ring: list)" in ground
    assert '"front_walks": front_walks' in ground
    assert '"service_yards": service_yards' in ground
    assert '"backyards": backyards' in ground
    assert "inside & ~window" in ground
    assert "const grassRings = classifiedGround" in source
    assert "const frontWalkGeom = ringGeometry((ground.front_walks || [])" in source
    assert "const serviceGeom = ringGeometry((ground.service_yards || [])" in source


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
    # The ribbon is merged by material rather than added on its own: 53,383 street meshes
    # were 53,383 draw calls a frame. Same geometry, one call per surface class.
    assert "addMerged(`ribbon:${surfaceKind}" in source
    assert "ribbon(surfacePoints, widthMeters" in source
    # Painted with a width rather than drawn as a one-pixel line; the dash pattern is measured
    # in metres along the way, so a broken lane line stays 3.05 m of paint at any zoom.
    assert "paintedLine(offsetWay(renderPoints, offset), MARK_W" in source


def test_narrow_pavement_uses_long_tiles_without_widening_geometry() -> None:
    source = _source()

    assert 'const NARROW_SIDEWALK = sidewalkTexture("narrow");' in source
    assert 'if (surface === "walk_narrow") return [NARROW_SLAB_M, width];' in source
    assert 'if (surface === "walk_narrow") return NARROW_SIDEWALK;' in source
    assert 'widthMeters <= NARROW_WALK_M ? "walk_narrow" : "walk"' in source
    assert "addPavementRibbon(surfacePoints, widthMeters" in source


def test_bike_lanes_follow_osm_cycleway_tags_and_keep_edge_lines() -> None:
    source = _source()

    assert "function cyclewaySides(way)" in source
    assert "way.cycleway_left" in source
    assert "way.cycleway_right" in source
    assert "way.cycleway_both" in source
    assert "function addBikeLaneMarkings(way, renderPoints, roadWidth, roadTop)" in source
    assert "const BIKE_EDGE_W_M = 0.18;" in source
    assert "ribbon(offsetWay(lanePoints, laneCentre), BIKE_LANE_M, 0xffffff, 1.0" in source
    assert "paintedLine(offsetWay(linePoints, outerOffset), BIKE_EDGE_W_M" in source
    assert "paintedLine(offsetWay(linePoints, innerOffset), BIKE_EDGE_W_M" in source


def test_beaches_and_extended_bay_water_are_rendered() -> None:
    source = _source()

    assert 'way["natural"="beach"]' in source
    assert 'relation["natural"="beach"]' in source
    # The band reaches the bay disc rather than stopping at a fixed distance, and which side of
    # the coastline is wet is checked against the buildings rather than taken on convention:
    # every one of this corridor's seven coastlines needed drawing to starboard, and the ones
    # taken on trust put 1.4 km of water over North Beach.
    # Two kilometres: far enough to reach past the corridor from any shoreline in it, and no
    # further. At nine the band ran clear across the city and, sitting above the land plane
    # though below the roadway, showed through every gap as blue patches on the kerb ramps.
    assert "COASTAL_BAND_M = 2000.0" in source
    assert "MAX_BUILDINGS_INSIDE" in source
    assert "def covers_the_city(" in source
    assert "MAX_BUILDINGS_PER_KM2" in source
    # Water and beaches sit above the plane they used to be buried under.
    assert "const WATER_Y" in source and "const BEACH_Y" in source
    assert "mesh.position.y = WATER_Y;" in source
    assert "mesh.position.y = BEACH_Y;" in source
    assert '"kind": "beach"' in source
    assert "function sandTexture()" in source
    assert "const SAND = sandTexture();" in source
    assert 'way.kind === "beach"' in source


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


def test_facade_renderer_adds_roof_material_detail() -> None:
    source = _source()

    assert "function roofTexture(seed, base, archetype)" in source
    assert "roofTextureFor(tint, seed, feature.archetype)" in source
    # The surface, and only the surface. Roof furniture used to be painted into this texture,
    # which repeats 2.5 times across every roof -- so one solar array became six copies of
    # itself at arbitrary size, clipped at the tile edges. What stands on a roof is geometry
    # now; see test_corridor_geometry_rules for the rules it is placed by.
    assert "Solar modules" not in source
    assert "function addRoofFurniture(group, feature, seed, height, areaM2)" in source
    assert "addRoofFurniture(group, feature, seed, height, areaM2);" in source


def test_facade_renderer_adds_south_facing_window_detail() -> None:
    source = _source()

    assert "function footprintWalls(points)" in source
    assert "function southWindowTexture(seed)" in source
    assert "wall.nz > 0.38" in source
    assert "addSouthFacadeDetail(group, feature, seed, height)" in source
    assert "function balconyPart(group, wall, y, seed)" in source


def test_facade_renderer_adds_ground_floor_identity() -> None:
    source = _source()

    assert "function entryTexture(seed, archetype)" in source
    assert 'ctx.fillText(archetype === "restaurant" ? "CAFE" : "SHOP", 64, 34);' in source
    assert "function addGroundFacadeDetail(group, feature, seed, height)" in source
    assert 'feature.archetype === "retail" || feature.archetype === "restaurant"' in source
    assert "addGroundFacadeDetail(group, feature, seed, height)" in source


def test_gas_station_renderer_has_pumps_and_price_sign() -> None:
    source = _source()

    assert "function gasPriceTexture(seed)" in source
    assert 'ctx.fillText("GAS", 48, 24);' in source
    assert "function pumpIsland(group, x, z, brand)" in source
    assert "pumpIsland(group, metrics.x + sx * canopyW, metrics.z, brand);" in source
    assert "4.56, metrics.z + sz * canopyD" in source
    assert "metrics.x + metrics.width * 0.18" in source
    assert "planePart(group, signX, 1.0, signZ - 0.13" in source
    assert "Business: ${place.primary_type.replaceAll" in source


def test_renderer_defers_optional_survey_layers_until_opened() -> None:
    source = _source()

    assert "const lazyLayerBuilders = new Map();" in source
    assert "function registerLazyLayer(layer, builder)" in source
    assert "function ensureLazyLayer(layer)" in source
    assert 'registerLazyLayer("official", async () => {' in source
    assert 'registerLazyLayer("chunks", () => {' in source
    assert 'registerLazyLayer("coverage", () => {' in source
    assert 'registerLazyLayer("observations", () => {' in source
    assert 'registerLazyLayer("sequences", () => {' in source
    assert "if (opening) ensureLazyLayer(layer);" in source


def test_facade_textures_are_prioritized_and_frame_budgeted() -> None:
    source = _source()

    assert "const FACADE_TEXTURE_CONCURRENCY = 3;" in source
    assert "const FACADE_TEXTURE_YIELD_EVERY = 8;" in source
    assert "function facadeLoadPriority(panel)" in source
    assert "facadePanels.slice().sort((a, b) => facadeLoadPriority(a) - facadeLoadPriority(b))" in source
    assert "await loadFacadeTexture(queue.shift());" in source
    assert "if (loaded % FACADE_TEXTURE_YIELD_EVERY === 0) await nextFrame();" in source
    assert "Array.from(" in source
    assert "Promise.all([worker(), worker(), worker(), worker()])" not in source
