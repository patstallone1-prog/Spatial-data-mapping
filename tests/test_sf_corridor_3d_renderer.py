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


def test_crosswalks_get_yellow_truncated_dome_warning_pads() -> None:
    source = _source()

    assert "function crossingLandingCorners(endpoint, intoCrossing, crossingWidth)" in source
    assert "function addCrossingLandingPads(points, crossingWidth, y)" in source
    assert "CROSSING_LANDING_DEPTH_M = 2.35" in source
    assert "CROSSING_LANDING_FLARE_M = 2.20" in source
    assert 'addMerged("crossing:landing", mesh, "walk");' in source
    assert "insideCarriageway(x, z, 0.0)" in source
    assert "addCrossingLandingPads(surfacePoints, widthMeters, roadTop + KERB + 0.002);" in source
    assert "function tactileWarningTexture()" in source
    assert "Truncated-dome warning tile" in source
    assert 'ctx.fillStyle = "#d8aa24";' in source
    assert "const TACTILE_PAD_DEPTH_M = 0.72;" in source
    assert "function tactilePadCorners(endpoint, intoCrossing, crossingWidth)" in source
    assert "insideCarriageway(cx, cz, 0.10)" in source
    assert 'mesh.userData.surface = "tactile_warning";' in source
    assert 'addMerged("crossing:tactile", mesh, "tactile_warning");' in source
    assert "polygonOffsetFactor: -10" in source
    assert "polygonOffsetUnits: -20" in source
    assert "addCrossingTactilePads(surfacePoints, widthMeters, roadTop + KERB + 0.018);" in source


def test_crosswalks_dedupe_same_direction_overlaps_only() -> None:
    source = _source()

    assert "function crossingRectanglePoints(points)" in source
    assert "const surfacePoints = isCrossing ? crossingRectanglePoints(renderPoints)" in source
    assert "const crossingDrawGrid = new Map();" in source
    assert "function shouldDrawCrossing(points, width)" in source
    assert "crossingBearingDifference(other.bearing, pose.bearing)" in source
    assert "if (isCrossing && !shouldDrawCrossing(surfacePoints, widthMeters)) continue;" in source


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
    assert "function addCrossingAreaSegment(points, width)" in source
    assert "function insideCrossingArea(x, z, slack = 0.08)" in source
    assert "addCrossingAreaSegment(way.points, way.crossing_m || 3.7)" in source
    assert "insideCrossingArea(x, z, 0.10)" in source
    assert "function addPropertyLinePavementUnderlay(renderPoints, side, inner, walk, color, opacity)" in source
    assert "PROPERTY_LINE_PAVEMENT_Y = 0.012" in source
    assert '"walk_underlay"' in source
    assert "addPropertyLinePavementUnderlay(renderPoints, side, inner, walk, color, opacity);" in source
    assert "addKerbsidePavement(renderPoints, side, inner, walk" in source
    assert "WALK_FALLBACK_WIDTHS_M" in source
    # And `sidewalk=no` is believed only where a footway is really mapped in its place.
    assert "function sideBlockedByCarriageway(renderPoints, side, inner)" in source
    assert "drawing sidewalk tiles there makes the middle of the road look paved" in source
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
    assert "def front_setback(ring: list)" in ground
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
    assert "function addIntersectionRoadPads(ways, intersections, roadTop)" in source
    assert "addIntersectionRoadPads(DATA.ways, DATA.intersections, ROAD_TOP_M);" in source
    assert "node.half * 2.2 + 8.0" in source
    assert 'addMerged("road:junction", mesh, "road");' in source
    assert "const renderPoints = densifyWay(way.points);" in source
    # The ribbon is merged by material rather than added on its own: 53,383 street meshes
    # were 53,383 draw calls a frame. Same geometry, one call per surface class.
    assert "addMerged(`ribbon:${surfaceKind}" in source
    assert "ribbon(surfacePoints, widthMeters" in source
    # Painted with a width rather than drawn as a one-pixel line; the dash pattern is measured
    # in metres along the way, so a broken lane line stays 3.05 m of paint at any zoom.
    assert "const markingPoints = trimWayEnds(renderPoints, markCutStart, markCutEnd);" in source
    assert "paintedLine(offsetWay(markingPoints, offset), MARK_W" in source
    assert "function addLaneTransitionMarkings(way, renderPoints, roadWidth, roadTop)" in source
    assert "const LANE_TRANSITION_MAX_SHIFT_M = 3.4;" in source
    assert "function laneTransitionCandidate(way, here, other)" in source
    assert "way.name && other.name && way.name !== other.name" in source
    assert "here.oneway !== otherProfile.oneway || here.opposing !== otherProfile.opposing" in source
    assert 'if (mark.kind === "centre") continue;' in source
    assert "transitionPaintPoints(" in source
    assert 'addMerged(`marking:transition:${mark.kind}`, taper, "marking");' in source


def test_narrow_pavement_uses_long_tiles_without_widening_geometry() -> None:
    source = _source()

    assert 'const NARROW_SIDEWALK = sidewalkTexture("narrow");' in source
    assert 'if (surface === "walk_narrow") return [NARROW_SLAB_M, width];' in source
    assert 'if (surface === "walk_narrow") return NARROW_SIDEWALK;' in source
    assert 'widthMeters <= NARROW_WALK_M ? "walk_narrow" : "walk"' in source
    assert "addPavementRibbon(surfacePoints, widthMeters" in source


def test_bike_lanes_follow_osm_cycleway_tags() -> None:
    """Which sides carry a lane is read from the tags, and only the tags.

    What the lane then *does* -- whether it survives an OSM way split, where its lines go, where
    the green stops -- is not a question about the source text and is asked of the running rules
    in tests/test_corridor_geometry_rules.py instead. The assertion that used to live here was
    the literal of one merge call, and it broke the moment the call was fixed.
    """
    source = _source()

    assert "function cyclewaySides(way)" in source
    assert "way.cycleway_left" in source
    assert "way.cycleway_right" in source
    assert "way.cycleway_both" in source
    assert "function addBikeLaneMarkings(way, renderPoints, roadWidth, roadTop)" in source
    assert "const BIKE_EDGE_W_M = 0.18;" in source
    assert "function bikeCrossingBreakAt(x, z, bearing, slack = 0.0, ownWay = null)" in source
    assert "labels.push(bikeCrossingBreakAt(x, -y, bearing, 0.2, ownWay)" in source
    # Both edges come off the lane's own centre, so they hug it however wide the street is,
    # and neither is conditional on the green.
    assert "offsetWay(run.points, side * (BIKE_LANE_M / 2))" in source
    assert "offsetWay(run.points, -side * (BIKE_LANE_M / 2))" in source
    assert "function crosswiseCarriagewayAt(x, z, bearing, slack = 0.0, ownWay = null)" in source
    assert "if (ownWay && source === ownWay) continue;" in source
    assert "bikeLaneZones(lane, way)" in source


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


def test_grass_texture_has_cached_realistic_variants() -> None:
    source = _source()

    assert "const GRASS_TEXTURES = new Map();" in source
    assert 'function grassTexture(kind = "yard", variant = 0)' in source
    assert "const key = `${kind}:${variant}`;" in source
    assert "if (GRASS_TEXTURES.has(key)) return GRASS_TEXTURES.get(key);" in source
    assert "const size = 384;" in source
    assert "const parkPalettes = [" in source
    assert "const yardPalettes = [" in source
    assert "straw/dirt flecks" in source
    assert "Low, soft mowing direction" in source
    assert "function grassVariantForRing(ring, count)" in source
    assert "const parkVariants = 4;" in source
    assert "const yardVariants = 5;" in source
    assert 'map: grassTexture("park", variant)' in source
    assert 'map: grassTexture("yard", variant)' in source


def test_named_buildings_get_plaque_signage_without_duplicate_shop_names() -> None:
    source = _source()

    assert "function cleanName(text)" in source
    assert "function buildingNameTrade(feature)" in source
    assert "function addBuildingNamePlaque(group, feature, seed, height, tint)" in source
    assert "if (shops.some((shop) => cleanName(shop.n) === clean)) return;" in source
    assert "const slot = signSlot(name, trade);" in source
    assert 'const sink = awningSink("board");' in source
    assert "addSignFace(slot.atlas" in source
    assert "addBuildingNamePlaque(group, feature, seed, height, tint);" in source


def test_avatar_is_a_humanoid_walker_not_the_old_marker_sphere() -> None:
    source = _source()

    assert 'the walker is you' in source
    assert "GLTFLoader" in source
    assert "const AVATAR_HEIGHT = 2.13;" in source
    assert "https://threejs.org/examples/models/gltf/Soldier.glb" in source
    assert "function buildCharacterAvatar()" in source
    assert 'rig.name = "walking-character-avatar";' in source
    assert 'model.name = "imported-realistic-demo-character";' in source
    assert 'avatarMixer = new THREE.AnimationMixer(model);' in source
    assert 'setAvatarAction(moving ? "Run" : "Idle");' in source
    assert 'shadow.name = "contact-shadow";' in source
    assert 'addAvatarBox(rig, "left-eye"' in source
    assert 'addAvatarBox(rig, "left-lapel"' in source
    assert 'addAvatarBox(rig, "left-strap"' in source
    assert "addAvatarLimb(rig, \"left-leg\"" in source
    assert "addAvatarLimb(rig, \"right-arm\"" in source
    assert "function animateAvatar(distance, direction, moving)" in source
    assert "avatar.rotation.y = Math.atan2(direction.x, direction.z);" in source
    assert "avatar.userData.walkPhase += distance * 4.8;" in source
    assert "avatar.rotateOnWorldAxis(axis, move.length() / AVATAR_RADIUS)" not in source


def test_tree_scale_is_capped_below_multistory_buildings() -> None:
    source = _source()

    assert 'const maxScale = kind === "palm" ? 5.6' in source
    assert 'kind === "columnar" ? 6.2' in source
    assert 'kind === "conifer" ? 7.0 : 7.4' in source
    assert "const scale = Math.max(2.2, Math.min(maxScale, tree.d * 0.34));" in source
    assert "Math.min(16.0, tree.d * 0.42)" not in source


def test_a_boundary_is_fenced_only_where_it_is_a_fence() -> None:
    """A side property line is one edge in the survey and three things on the ground.

    Nearest the street it is open front garden. Where the two houses stand against it, it is the
    neighbour's wall. Behind them it is a fence. Deciding the edge whole -- a footprint within
    0.8 m at two of three sample points and the entire boundary was called a wall -- threw the
    fence away with the wall, and on the standard lot in this city the house covers the front two
    thirds of the boundary, so that is the usual case rather than the odd one. Whole block
    interiors came out as a single unbroken lawn because of it.
    """
    ground = _ground_source()

    # The three tests are asked of each point along the boundary, in one walk.
    assert "def against_a_wall(x: float, y: float) -> bool:" in ground
    assert "def behind_the_house(x: float, y: float) -> bool:" in ground
    assert "for c in range(steps + 1):" in ground
    assert "if against_a_wall(x, y):" in ground
    assert "elif not behind_the_house(x, y):" in ground
    # Neither may drop the whole edge any more.
    assert 'counts["wall"] += 1\n                continue' not in ground
    # A front garden is grass and nothing else: the front-facing edge is still dropped whole,
    # and the side boundaries are cut back to the front of the house.
    assert "MIN_FRONT_LAWN_DEPTH_M)" in ground
    assert "MIN_FENCE_RUN_M" in ground
    # And the lots whose remainder is small enough to be called a lawn still contribute their
    # rear boundaries -- that is the ordinary San Francisco lot, not an edge case.
    assert ground.count("kept_rings.append((blklot, ring, front))") == 2


def test_a_parcel_standing_on_a_park_is_the_park() -> None:
    """Joe DiMaggio Playground arrived as an 11,568 square metre "shallow frontage"."""
    ground = _ground_source()

    assert "MAX_PARCEL_ON_GREEN" in ground
    assert "def share_covered(lattice: Lattice, ring: list) -> float:" in ground
    assert "green = Lattice(bbox)" in ground
    assert "green.stamp_polygon(park[\"p\"])" in ground
    assert "if share_covered(green, ring) > MAX_PARCEL_ON_GREEN:" in ground
