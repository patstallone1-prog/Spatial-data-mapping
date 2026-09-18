import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"
GROUND_SOURCE = ROOT / "scripts" / "build_ground_cover.py"
PAGE_DATA = ROOT / "docs" / "sf-corridor-3d.json"


def _source() -> str:
    return SOURCE.read_text(encoding="utf-8")


def _ground_source() -> str:
    return GROUND_SOURCE.read_text(encoding="utf-8")


def test_osm_dividers_require_explicit_physical_geometry() -> None:
    namespace = runpy.run_path(str(SOURCE))
    query = namespace["overpass_query"](namespace["SF_CORRIDOR"].bbox)
    classify = namespace["physical_divider_feature"]
    triangle = [[-122.42, 37.79], [-122.41998, 37.79004],
                [-122.41996, 37.79], [-122.42, 37.79]]
    skinny = [[-122.42, 37.79], [-122.419, 37.79], [-122.419, 37.79001],
              [-122.42, 37.79001], [-122.42, 37.79]]

    assert 'way["traffic_calming"="island"]' in query
    assert 'way["barrier"="kerb"]["kerb"="raised"]' in query
    assert 'way["separation:left"]' not in query
    assert classify({"traffic_calming": "island", "surface": "concrete"}, triangle, 7) == {
        "kind": "divider", "name": None, "points": triangle,
        "divider_source": "traffic_calming_island", "divider_surface": "concrete",
        "osm_id": 7,
    }
    assert classify({"barrier": "kerb", "kerb": "raised"}, skinny, 8) is not None
    assert classify({"barrier": "kerb", "kerb": "raised"}, skinny[:-1], 9) is None
    assert classify({"divider": "solid_line", "surface": "paint"}, triangle, 10) is None


def test_divider_block_tile_handles_strips_and_tapered_osm_rings() -> None:
    source = _source()
    assert "function dividerBlockTexture()" in source
    assert "const DIVIDER_TILE_M = 1.2;" in source
    assert "function dividerBlockMesh(feature, roadTop)" in source
    assert "new THREE.ExtrudeGeometry(shape" in source
    assert "bevelSize: 0.035" in source
    assert 'mesh.userData.surface = "divider_block";' in source
    assert 'addMerged("divider:block", divider, "divider_block");' in source
    assert "feature.divider_width_m" in source
    assert "dividerFootprintIsRoadborne(way)" in source


def test_deployed_payload_contains_only_explicit_physical_dividers() -> None:
    payload = json.loads(PAGE_DATA.read_text(encoding="utf-8"))
    dividers = [way for way in payload["ways"] if way.get("kind") == "divider"]
    assert len(dividers) == 21
    assert {way["divider_source"] for way in dividers} == {
        "traffic_calming_island", "raised_kerb",
    }
    assert all(way["points"][0] == way["points"][-1] for way in dividers)


def test_continental_crosswalk_bars_repeat_along_walking_direction() -> None:
    source = _source()

    assert 'if (surface === "crossing") return [CROSSING_PERIOD_M, width];' in source
    assert "ctx.fillRect(1, 0, size * 0.5 - 2, size);" in source
    assert "function crossingStripePhase(length)" in source
    assert 'const phaseU = surface === "crossing"' in source
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
    assert "addCrossingLandingPads(surfacePoints, widthMeters, roadTop + KERB + 0.002);" not in source
    assert "function tactileWarningTexture()" in source
    assert "Truncated-dome warning tile" in source
    assert 'ctx.fillStyle = "#d8aa24";' in source
    assert "const TACTILE_PAD_DEPTH_M = 0.91;" in source
    assert "const TACTILE_PAD_MIN_W_M = 1.22;" in source
    assert "const TACTILE_PAD_MAX_W_M = 1.52;" in source
    assert "const TACTILE_TEXTURE_TILE_M = 0.48;" in source
    assert "function tactilePadsOverlap(a, b)" in source
    assert "tactileWarningPads.some((corners) => tactilePadsOverlap(corners, pad.corners))" in source
    # And the pad is the front of a ramp, not a yellow stripe on its own.
    assert "const CURB_RAMP_DEPTH_M" in source
    assert 'addMerged("crossing:ramp", ramp, "curb_ramp");' in source
    assert "function tactilePadCorners(endpoint, intoCrossing, crossingWidth)" in source
    assert "insideCarriageway(cx, cz, 0.10)" in source
    assert 'mesh.userData.surface = "tactile_warning";' in source
    assert 'addMerged("crossing:tactile", mesh, "tactile_warning");' in source
    assert "function addCrossingAsphaltBackstop(points, crossingWidth, roadTop)" in source
    assert 'addMerged("road:crossing-backstop"' in source
    assert "polygonOffsetFactor: -10" in source
    assert "polygonOffsetUnits: -20" in source
    assert "addCrossingTactilePads(surfacePoints, widthMeters, roadTop + KERB + 0.018);" in source


def test_official_signs_and_curb_zone_bands_render_from_geometry_based_sidecar() -> None:
    source = _source()

    assert "const official = furniture.geometry_based || {};" in source
    assert "const officialStops = officialSigns.filter((s) => s.sign_kind === \"stop\");" in source
    # Every sign is a plate saying what the inventory says it says, in the colours of its
    # class, standing in front of its post; a stop sign is a red octagon with STOP on it.
    assert "function addOfficialSignPlates(records)" in source
    assert "const plates = addOfficialSignPlates(officialSigns);" in source
    assert 'stop:        { bg: "#b52127", fg: "#ffffff", shape: "octagon"' in source
    assert "const cx = post.anchor.x + nx * PLATE_STANDOFF_M;" in source
    assert "side: THREE.FrontSide" in source
    # The inventory's shorthand is read out on the plate.
    assert '.replace(/\\bNPRK\\b/g, "NO PARKING")' in source
    assert "function addOfficialCurbZoneBands(records)" in source
    # The paint is vertex colour on the kerb tile, not a band laid over it.
    assert 'o.userData.surface === "kerb"' in source
    assert "col.setXYZ(i, best[4], best[5], best[6]);" in source
    # No separate band surface any more: the kerb tile carries the colour.
    assert "official_curb_zone:${bucket.colorName}" not in source
    # The paint inventory first, then the policy zones that are paint by definition.
    assert 'curb_zone_bands: addOfficialCurbZoneBands((official.color_curbs || []).concat(official.curb_zones || []))' in source
    assert "function colorCurbRecordLines(record)" in source


def test_crosswalks_dedupe_same_direction_overlaps_only() -> None:
    source = _source()

    assert "function crossingRectanglePoints(points)" in source
    assert "const surfacePoints = isCrossing ? crossingRectanglePoints(renderPoints)" in source
    assert "const crossingDrawGrid = new Map();" in source
    assert "function shouldDrawCrossing(points, width, tag = null)" in source
    assert "crossingBearingDifference(other.bearing, pose.bearing)" in source
    assert "if (isCrossing && !shouldDrawCrossing(surfacePoints, widthMeters)) continue;" in source


def test_sidewalk_ribbons_are_clipped_against_carriageways() -> None:
    source = _source()

    assert "function pavementRunsOutsideCarriageway(points, width, discardDetached = false)" in source
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
    assert "addCrossingAreaSegment" not in source
    assert "insideCrossingArea" not in source
    assert "function addPropertyLinePavementUnderlay(renderPoints, side, inner, walk, color, opacity)" in source
    assert "PROPERTY_LINE_PAVEMENT_Y = 0.012" in source
    assert '"walk_underlay"' in source
    assert "addPropertyLinePavementUnderlay(renderPoints, side, inner, walk, color, opacity);" in source
    assert "addKerbsidePavement(renderPoints, side, inner, walk" in source
    assert "WALK_FALLBACK_WIDTHS_M" in source
    # And `sidewalk=no` is believed only where a footway is really mapped in its place.
    assert "function kerbsideBlockedAt(before, here, after, side, inner)" in source
    assert "function sideBlockedByCarriageway" not in source
    assert "function walkSidesToDraw(way, renderPoints, inner)" in source
    assert "mappedWalkNear(x, -y)" in source


def test_alley_mouth_crossings_bridge_sidewalk_cuts() -> None:
    source = _source()

    assert "def alley_mouth_crossings(ways:" in source
    assert 'way.get("service") != "alley"' in source
    assert '"alley_mouth": True' in source
    assert 'const widthMeters = isCrossing ? (way.crossing_m || 3.7)' in source
    assert "const surfaceKind = isCrossing ? crossingMarkingKind(way)" in source


def test_a_way_without_a_highway_tag_is_not_a_street() -> None:
    """The amenity/shop/tourism ways are fetched for what they say a place is, not as roads.

    Left to the classifier's ``else``, 867 of them were streets: 659 nameless parking spaces
    drawn as five metre carriageways two and a half metres apart across the Marina Green car
    park, and plazas, school grounds and bicycle racks with a centreline down each.
    """
    source = _source()
    namespace = runpy.run_path(str(SOURCE))
    body = source.split("def fetch_osm(", 1)[1].split("\ndef ", 1)[0]
    assert 'if not highway and tags.get("footway") not in ("sidewalk", "crossing"):' in body
    assert '"kind": "poi", "name": tags.get("name"),' in body

    cached = [
        {"kind": "street", "name": "Ghirardelli Square", "highway": None,
         "points": [[-122.4237, 37.8061], [-122.4223, 37.8063], [-122.4237, 37.8061]]},
        {"kind": "street", "name": "Beach Street", "highway": "residential",
         "points": [[-122.4237, 37.8061], [-122.4223, 37.8063]]},
        {"kind": "street", "name": None, "highway": "steps",
         "points": [[-122.4237, 37.8061], [-122.4223, 37.8063]]},
    ]
    kinds = [w["kind"] for w in namespace["reclassify"](cached)]
    assert kinds == ["street", "path"]


def test_parking_aisles_on_a_mapped_lot_are_the_lot() -> None:
    """An aisle drawn over a lot is the lot's surface, not an eight metre street on top of it."""
    namespace = runpy.run_path(str(SOURCE))
    fold = namespace["fold_parking_aisles_into_lots"]
    lot = {"kind": "parking_lot", "points": [[-122.44, 37.80], [-122.439, 37.80],
                                             [-122.439, 37.8006], [-122.44, 37.8006],
                                             [-122.44, 37.80]]}
    inside = {"kind": "street", "service": "parking_aisle",
              "points": [[-122.4398, 37.8002], [-122.4392, 37.8002]]}
    outside = {"kind": "street", "service": "parking_aisle",
               "points": [[-122.4398, 37.8012], [-122.4392, 37.8012]]}
    driveway = {"kind": "street", "service": "driveway",
                "points": [[-122.4398, 37.8003], [-122.4392, 37.8003]]}
    ways = [lot, inside, outside, driveway]

    assert fold(ways) == 1
    assert inside["kind"] == "parking_aisle"
    assert outside["kind"] == "street"
    assert driveway["kind"] == "street", "only aisles fold; a driveway over a lot is a driveway"
    assert '"service",' in _source().split("PAGE_FIELDS = {", 1)[1].split("}", 1)[0]


def test_crossing_style_provenance_survives_payload_slimming() -> None:
    page_fields = _source().split("PAGE_FIELDS = {", 1)[1].split("}", 1)[0]
    for field in (
        "crossing_type",
        "crossing_markings",
        "crossing_style_group",
        "resolved_crossing_marking",
        "marking_provenance",
        "marking_confidence",
    ):
        assert f'"{field}"' in page_fields


def test_full_detail_shards_restore_every_field_omitted_from_rendering(
    tmp_path: Path,
) -> None:
    namespace = runpy.run_path(str(SOURCE))
    payload = {
        "bbox": {"west": -122.45, "south": 37.78, "east": -122.39, "north": 37.81},
        "facades": {"walls": [{"c": "c1", "t": "wall.jpg"}]},
        "ways": [
            {
                "kind": "building", "osm_id": 10, "name": "West",
                "points": [[-122.44, 37.79], [-122.439, 37.79]],
                "address": {"formatted": "10 West St", "city": "San Francisco"},
                "datasf_building_height": {"height_m": 12.34, "height_method": "lidar_median"},
                "building_id": "osm:way:10",
            },
            {
                "kind": "street", "osm_id": 20, "name": "East",
                "points": [[-122.40, 37.80], [-122.399, 37.80]],
                "road_m": 11.2, "cnn": 1234, "cnn_name": "East Street",
            },
        ],
    }
    full = json.loads(json.dumps(payload))
    manifest = namespace["write_detail_shards"](full, tmp_path)
    namespace["slim_payload"](payload)

    assert len(payload["ways"]) == len(full["ways"]) == 2
    assert payload["ways"][0]["points"] == full["ways"][0]["points"]
    assert payload["ways"][1]["road_m"] == full["ways"][1]["road_m"]
    assert "datasf_building_height" not in payload["ways"][0]
    assert payload["ways"][0]["address"] == {"formatted": "10 West St"}

    west = json.loads((tmp_path / "sf-corridor-detail-west.json").read_text())
    east = json.loads((tmp_path / "sf-corridor-detail-east.json").read_text())
    assert west["features"] == [{
        "key": "way:0",
        "fields": {
            "datasf_building_height": {"height_m": 12.34, "height_method": "lidar_median"},
            "building_id": "osm:way:10",
            "address": {"city": "San Francisco"},
        },
    }]
    assert east["features"] == [{
        "key": "way:1",
        "fields": {"cnn": 1234, "cnn_name": "East Street"},
    }]
    assert manifest["detail_features"] == 2
    assert manifest["accuracy"]["geometry_changed_by_slimming"] is False
    assert "facades/c1/wall.jpg" in manifest["offline_assets"]


def test_browser_loads_the_nearby_full_detail_shard_on_demand() -> None:
    source = _source()
    assert 'fetch("sf-corridor-detail-manifest.json", { cache: "no-cache" })' in source
    assert 'records = fetch(shard.file, { cache: "force-cache" })' in source
    assert "async function fullDetailFeature(feature)" in source
    assert "full._detailShard = shard.id;" in source
    assert "const summary = await featureSummary(feature);" in source


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
    # Measured is measured: the kerb envelope read along the way as much as the city's own
    # kerb-to-kerb record. The lane cap once took Vallejo from its measured 11.6 m to 8.1.
    assert 'const measured = way._spans !== undefined || MEASURED_ROAD_SOURCES.has(way.road_source);' in source
    assert 'const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half"]);' in source
    assert "const sourceCap = measured ? MAX_RENDER_ROAD_M : MAX_INFERRED_ROAD_M;" in source
    # The lane cap is for inferred widths; a width measured between the kerbs keeps it.
    assert "const laneCap = lanes && !measured ?" in source
    # And nothing clamps a way drawn between the city's kerbs, nor a street on another level.
    assert "if (way._spans !== undefined) continue;" in source
    assert "function sameLevel(a, b)" in source
    assert "const half = renderedRoadWidth(way) / 2;" in source
    assert "const road = widthMeters;" in source


def test_renderer_densifies_curved_road_markings() -> None:
    source = _source()

    assert "function densifyWay(points, maxSpan = 5.0)" in source
    assert "function addIntersectionRoadPads(" not in source
    assert "function addCarriagewayDisk(x, z, radius)" not in source
    assert "addCarriagewayDisk(x, -y, radius);" not in source
    assert "addIntersectionRoadPads(DATA.ways, DATA.intersections, ROAD_TOP_M);" not in source
    assert "const renderPoints = densifyWay(way.points);" in source
    # The ribbon is merged by material rather than added on its own: 53,383 street meshes
    # were 53,383 draw calls a frame. Same geometry, one call per surface class.
    assert "addMerged(`ribbon:${surfaceKind}" in source
    assert "const paintRuns = (isCrossing ? crossingPaintLegs(surfacePoints) : [surfacePoints])" in source
    assert ".map((run) => isCrossing ? trimWay(run, 0.48) : run)" in source
    assert "if (!isCrossing || surfaceKind)" in source
    assert "ribbon(paintRun, widths" in source
    # A divided half is drawn as wide as the city's two kerbs say at each point along it.
    assert "alongDistances(paintRun).map((along) => halfWidthAt(way, along) * 2) : widthMeters" in source
    # Painted with a width rather than drawn as a one-pixel line; the dash pattern is measured
    # in metres along the way, so a broken lane line stays 3.05 m of paint at any zoom.
    assert "const markingPoints = trimWayEnds(renderPoints, markCutStart, markCutEnd);" in source
    assert "paintedLine(offsetWay(run, mark.offset), MARK_W" in source
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
    # The awning carries no placeholder words: a sign says the business's name or nothing.
    assert '"CAFE"' not in source and '"SHOP"' not in source
    assert "def attach_named_places(ways" in source
    assert '"s": "overture_places"' in source
    assert "CDLA-Permissive-2.0" in source
    assert "function addGroundFacadeDetail(group, feature, seed, height, tint)" in source
    assert "if (hasStorefront(feature)) {" in source
    assert "addGroundFacadeDetail(group, feature, seed, height, tint);" in source


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
    assert "const [DATA, OFFICIAL_GEOMETRY, DETAIL_MANIFEST] = await Promise.all([" in source
    assert 'fetch("sf-corridor-official.json", { cache: "no-cache" })' in source
    assert 'registerLazyLayer("official", () => {' in source
    assert 'registerLazyLayer("chunks", () => {' in source
    assert 'registerLazyLayer("furniture", async () => {' in source
    assert 'fetch("sf-corridor-furniture.json", { cache: "no-cache" })' in source
    assert '<button data-layer="furniture" aria-pressed="false">Street furniture</button>' in source
    assert 'furniture:blank_ad' in source
    assert "Official geometry:" in source
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
    """Every pixel its own green, a few per hundred a brown, blades over that, and nothing in
    the tile larger than a blade: a patch or a mowing line is a feature, and a feature every
    four metres is a grid. A dozen kinds of grass, one per lawn polygon."""
    source = _source()

    assert "const GRASS_TEXTURES = new Map();" in source
    assert 'function grassTexture(kind = "yard", variant = 0)' in source
    assert "if (GRASS_TEXTURES.has(key)) return GRASS_TEXTURES.get(key);" in source
    assert "const GRASS_KINDS = [" in source
    assert source.count('{ name: "') >= 12
    assert "const GRASS_VARIANTS = GRASS_KINDS.length;" in source
    assert "ctx.createImageData(size, size)" in source
    assert "if (r1 < spec.brown) {" in source
    assert "mowStep" not in source and "parkPalettes" not in source
    assert "texture.repeat.set(1, 1);\n  texture.anisotropy = 8;\n  texture.colorSpace = THREE.SRGBColorSpace;\n  GRASS_TEXTURES.set(key, texture);" in source
    assert "function grassVariantForRing(ring, count)" in source
    assert "const parkVariants = GRASS_VARIANTS;" in source
    assert "const yardVariants = GRASS_VARIANTS;" in source


def test_named_buildings_get_plaque_signage_without_duplicate_shop_names() -> None:
    source = _source()

    assert "function cleanName(text)" in source
    assert "function buildingNameTrade(feature)" in source
    assert "function addBuildingNamePlaque(group, feature, seed, height, tint)" in source
    assert "if (shops.some((shop) => cleanName(shop.n) === clean)) return;" in source
    assert "const slot = signSlot(name, trade, inkFor(colour));" in source
    assert 'const sink = awningSink("board");' in source
    assert "addSignFace(slot.atlas" in source
    assert "addBuildingNamePlaque(group, feature, seed, height, tint);" in source


def test_avatar_is_a_humanoid_walker_not_the_old_marker_sphere() -> None:
    source = _source()

    assert 'the walker is you' in source
    assert "GLTFLoader" in source
    assert "const AVATAR_HEIGHT = 2.1336;" in source   # seven feet, to the millimetre
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


def test_place_categories_become_trades_and_non_shops_are_left_out() -> None:
    namespace = runpy.run_path(str(SOURCE))
    trade = namespace["place_trade"]
    assert trade("coffee_shop") == "cafe"
    assert trade("pizza_restaurant") == "pizza"
    assert trade("hair_salon") == "salon"
    assert trade("clothing_store") == "clothing"
    assert trade("bank") == "bank"
    assert trade("hotel") == "hotel"
    assert trade("toy_store") == "shop"
    assert trade("parking") is None
    assert trade("real_estate_agent") is None
    assert trade("apartment_building") is None
    assert trade("") is None

    attach = namespace["attach_named_places"]
    ways = [
        {"kind": "building", "overture_places": [
            {"name": "Golden Boy Pizza", "category": "pizza_restaurant"},
            {"name": "Some Parking", "category": "parking"},
        ]},
        {"kind": "building", "shops": [{"n": "Kayo Books", "t": "books"}],
         "overture_places": [{"name": "Other", "category": "cafe"}]},
        {"kind": "building", "google_places": [
            {"name": "Far Cafe", "primary_type": "cafe", "distance_m": 40, "match_reasons": []},
            {"name": "Near Cafe", "primary_type": "cafe", "distance_m": 5, "match_reasons": []},
        ]},
    ]
    counts = attach(ways)
    assert ways[0]["shops"] == [{"n": "Golden Boy Pizza", "t": "pizza", "s": "overture_places"}]
    assert ways[1]["shops"] == [{"n": "Kayo Books", "t": "books"}], "OSM's names come first"
    assert ways[2]["shops"] == [{"n": "Near Cafe", "t": "cafe", "s": "google_places"}]
    assert counts == {"overture_places": 1, "google_places": 1, "buildings_named": 2}


def _crossing(lon: float, lat: float, **fields: object) -> dict:
    return {
        "kind": "crossing",
        "points": [[lon - 0.00002, lat], [lon + 0.00002, lat]],
        **fields,
    }


def test_missing_crossing_styles_are_consistent_per_intersection() -> None:
    namespace = runpy.run_path(str(SOURCE))
    resolve = namespace["resolve_crossing_marking_styles"]
    lon, lat = -122.420000, 37.790000
    ways = [_crossing(lon + dx, lat + dy) for dx, dy in (
        (0, 0.00001), (0, -0.00001), (0.00001, 0), (-0.00001, 0),
    )]
    resolve(ways, [{"lon": lon, "lat": lat}])
    assert {way["resolved_crossing_marking"] for way in ways} == {"continental"}
    assert {way["crossing_style_group"] for way in ways} == {
        "intersection:-122.420000:37.790000"
    }


def test_deterministic_intersection_defaults_include_both_marking_types() -> None:
    namespace = runpy.run_path(str(SOURCE))
    resolve = namespace["resolve_crossing_marking_styles"]
    intersections = [
        {"lon": -122.420000, "lat": 37.790000},
        {"lon": -122.419000, "lat": 37.790000},
    ]
    ways = [_crossing(item["lon"], item["lat"]) for item in intersections]
    resolve(ways, intersections)
    assert {way["resolved_crossing_marking"] for way in ways} == {
        "continental", "parallel"
    }


def test_source_confirmed_marking_propagates_to_unknown_siblings() -> None:
    namespace = runpy.run_path(str(SOURCE))
    resolve = namespace["resolve_crossing_marking_styles"]
    lon, lat = -122.420000, 37.790000
    confirmed = _crossing(
        lon, lat, continental=True, continental_source="sfmta_inventory"
    )
    sibling = _crossing(lon, lat + 0.00001)
    resolve([confirmed, sibling], [{"lon": lon, "lat": lat}])
    assert confirmed["resolved_crossing_marking"] == "continental"
    assert sibling["resolved_crossing_marking"] == "continental"
    assert sibling["marking_provenance"] == "intersection_source_propagation"


def test_explicit_unmarked_crossing_stays_unpainted() -> None:
    namespace = runpy.run_path(str(SOURCE))
    resolve = namespace["resolve_crossing_marking_styles"]
    lon, lat = -122.420000, 37.790000
    crossing = _crossing(lon, lat, crossing_markings="no")
    resolve([crossing], [{"lon": lon, "lat": lat}])
    assert crossing["resolved_crossing_marking"] == "unmarked"
    source = _source()
    assert 'resolved === "unmarked") return null;' in source
    assert "if (!isCrossing || surfaceKind)" in source


def test_a_tunnel_is_what_the_lidar_says_it_is_and_its_mouths_are_where_the_hill_starts() -> None:
    """Seventy-five ways are tagged tunnel=yes. The lidar profile along each says which are
    bores through a hill (Broadway, Stockton), which pass under a building (1st Street beneath
    the transit centre) and which are ramps going underground; and it puts each mouth where
    the ground first stands over the road, not where OpenStreetMap ended the way."""
    namespace = runpy.run_path(str(SOURCE))
    classify = namespace["classify_tunnels"]
    long = [[-122.41, 37.79], [-122.404, 37.79]]          # ~530 m
    ways = [
        {"kind": "street", "name": "Stockton Tunnel", "highway": "tertiary", "tunnel": True,
         "points": [[-122.407148, 37.790283], [-122.407648, 37.792749]]},
        {"kind": "street", "name": "Broadway", "highway": "primary", "tunnel": True,
         "points": [[-122.411287, 37.797265], [-122.417852, 37.796413]]},
        {"kind": "street", "name": "1st Street", "highway": "secondary", "tunnel": True,
         "points": [[-122.397043, 37.789352], [-122.396607, 37.789004]]},
        {"kind": "street", "name": None, "highway": "busway", "tunnel": True, "points": long},
        {"kind": "street", "name": None, "highway": "service", "tunnel": True, "points": long},
        {"kind": "street", "name": "Fremont Street", "highway": "secondary", "tunnel": True,
         "points": [[-122.3960, 37.7900], [-122.3961, 37.7901]]},   # 14 m: a ramp's piece
        {"kind": "street", "name": "Mason Street", "highway": "residential", "points": long},
    ]
    counts = classify(ways)
    kinds = [w.get("tunnel_kind") for w in ways]
    assert kinds == ["road", "road", "underpass", "underground", "underground", "underground", None], kinds
    assert counts["underground ramp"] == 3 and counts["underpass beneath a building"] == 1
    # Stockton: both mouths within a few metres of the nodes, 276 m of hill between them.
    stockton = ways[0]
    assert 270 < stockton["tunnel_length_m"] < 280, stockton["tunnel_length_m"]
    assert set(stockton["tunnel_mouths"]) == {"start", "end"}
    portal = stockton["tunnel_portal"]
    assert 7.0 < portal["start"] < 9.5 and 7.0 < portal["end"] < 9.5, portal
    assert len(stockton["tunnel_cover"]) > 50 and all(c > 5 for _, c in stockton["tunnel_cover"])
    # Broadway: the east mouth is inside the way, past the open approach at Mason.
    broadway = ways[1]
    assert 540 < broadway["tunnel_length_m"] < 570, broadway["tunnel_length_m"]
    assert broadway["tunnel_mouths"]["start"][0] < -122.4113, broadway["tunnel_mouths"]
    source = _source()
    # One headwall design at both ends; the hill behind it is what the lidar measured.
    assert "const H = TUNNEL_CROWN_M + TUNNEL_SHELL_M + TUNNEL_PARAPET_M;" in source
    assert "const cover = Math.max(H, measured[label] || 0);" in source
    # The portal is as wide as the city's kerbs on the approach; over sixteen metres, two bores.
    assert "function tunnelApproachWidth(mouth, outward)" in source
    assert "const bores = width > TUNNEL_TWIN_MIN_M ? 2 : 1;" in source
    # The dark wall is seen from both sides, and the bore stops short of the surface network.
    assert "const dark = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 1.0, metalness: 0.0,\n                                                side: THREE.DoubleSide });" in source
    assert "function tunnelClearRun(way, mouth, inward)" in source
    # An underpass is a street to everything else.
    assert 'function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }' in source
    # Buildings, trees and posts on the hill over a mouth stand on the hill.
    assert "const hillLift = tunnelCoverIndex.length ? tunnelCoverAt(liftX, -liftY) : 0;" in source
    if PAGE_DATA.exists():
        deployed = json.loads(PAGE_DATA.read_text(encoding="utf-8"))
        by_kind = {}
        for way in deployed["ways"]:
            if way.get("tunnel_kind"):
                by_kind.setdefault(way["tunnel_kind"], set()).add(way.get("name"))
        assert by_kind["road"] == {"Broadway", "Stockton Tunnel"}, by_kind
        assert by_kind["underpass"] == {"1st Street"}, by_kind


def test_stone_walls_are_cooler_and_darker_than_sidewalk_concrete() -> None:
    source = _source()
    stone = source.split("function stoneWallTexture()", 1)[1].split("function brickWallTexture()", 1)[0]
    sidewalk = source.split("function sidewalkTexture(", 1)[1].split("function bikeTexture()", 1)[0]
    assert 'ctx.fillStyle = "#454b4f";' in stone
    assert 'ctx.fillStyle = `rgb(${tone - 5},${tone},${tone + 5})`;' in stone
    assert 'ctx.fillStyle = "#696d65";' in sidewalk


def test_the_pavement_is_let_down_at_every_driveway_and_paint_ends_hard() -> None:
    """A driveway is the pavement itself dropped to the gutter across the door, made on the
    merged pavement's own vertices at the kerb this model draws; the apron slab that used to
    draw the ramp drew it inside the solid pavement. And a road marking ends where it ends:
    no half-transparent sprinkle along a bar's edge, and the alpha cut at the half."""
    source = _source()
    assert "function dropKerbsAtDriveways(ways)" in source
    assert "const kerbVerticesDropped = dropKerbsAtDriveways(DATA.ways);" in source
    assert "const kerb = nearestKerbAt(drop.x, drop.z, 4.0);" in source
    assert 'addMerged("apron", apron, "apron")' not in source
    assert "Softened edges" not in source
    assert "alphaTest: painted ? 0.5 : 0," in source
    assert "texture.magFilter = THREE.NearestFilter;" in source


def test_storefronts_are_drawn_for_their_trade_on_a_ground_storey_of_their_own() -> None:
    """A bank, a laundromat and a taqueria used to be the same cafe at three widths. Each trade
    has its own front now, in bays the signs share, on a ground storey painted a colour chosen
    to go with the building, and a standalone shop is built differently from one under flats."""
    source = _source()
    assert "function addStorefronts(group, feature, seed, height, tint)" in source
    assert "function storefrontTexture(trade, variant, frameHex, standalone)" in source
    for trade in ("restaurant", "cafe", "bar", "grocery", "clothing", "books", "salon",
                  "pharmacy", "bank", "laundry", "hardware", "florist", "hotel"):
        assert f'case "{trade}":' in source, trade
    assert "const STOREFRONT_PALETTES = {" in source
    assert "const harmonious = neutral || apart <= 40 || Math.abs(apart - 180) <= 25;" in source
    assert "const contrast = Math.abs(h.l - hsl.l) >= 0.16;" in source
    assert "const standalone = height <= STOREFRONT_STANDALONE_MAX_M;" in source
    # The bays the fronts are drawn in are the bays the signs go over.
    assert source.count("shopBays(feature, wall)") >= 2
    # Ink that reads on the board it is on.
    assert 'signSlot(shop.n, trade, inkFor(colour))' in source
    # The old one-picture-for-everything is gone, and so are its words.
    assert 'if (archetype === "retail" || archetype === "restaurant") {' not in source
    assert '"CAFE"' not in source and '"SHOP"' not in source


def test_a_lots_entrance_is_an_access_road_and_its_inside_part_is_lot() -> None:
    """A nameless service way with no service tag is the way into a car park. It used to be
    matched to the street it leaves and inherit that street's right of way: the entrance to
    the Walgreens lot off Broadway was an 11.85 m carriageway with footways, nine metres into
    the lot. It is an access road now -- two cars wide, no footways, no street record -- and
    the part of it on the lot is lot."""
    namespace = runpy.run_path(str(SOURCE))
    fold = namespace["fold_parking_aisles_into_lots"]
    lot = {"kind": "parking_lot", "points": [[-122.44, 37.80], [-122.439, 37.80],
                                             [-122.439, 37.8006], [-122.44, 37.8006],
                                             [-122.44, 37.80]]}
    entrance = {"kind": "street", "service": "access",
                "points": [[-122.4398, 37.8002], [-122.4392, 37.8002]]}
    assert fold([lot, entrance]) == 1
    assert entrance["kind"] == "parking_aisle"
    source = _source()
    assert 'if way.get("highway") == "service" and not way.get("service") and not way.get("name"):' in source
    assert 'way["service"] = "access"' in source
    assert 'access: 5.0 };' in source


def test_car_park_stalls_are_angled_rows_off_the_frontage_in_pairs_of_lines() -> None:
    """A lot is striped from the edge that faces the street: rows parallel to it, stalls at
    sixty degrees, each divided from the next by a pair of lines a hand apart."""
    source = _source()
    assert "function parkingLayout(ring, reach)" in source
    assert "const PARKING_STALL_ANGLE_DEG = 60;" in source
    assert "const PARKING_STRIPE_GAP_M = 0.22;" in source
    assert "for (const sign of [-1, +1]) {" in source
    assert "rows.push([m, m + R, +1], [depth - m - R, depth - m, -1]);" in source
    # Aisles folded into lots are not drawn as roads.
    assert 'if (way.kind === "parking_aisle") continue;' in source


def test_a_derived_pavement_meets_the_mapped_footway_at_the_footways_height() -> None:
    """Where OpenStreetMap maps the footway a few metres off the kerb line, the derived pavement
    is the strip between the two at the footway's height, not a second slab beside it."""
    source = _source()
    assert "function mappedWalkBeyondKerb(x, z, nx, nz, inner)" in source
    assert "mappedWalkBeyondKerb(sx, -sy, -side * nx, -side * nz, kerbAt[i])" in source
    assert 'return `gap:${Math.round(gap / 0.25)}:${met.thickness.toFixed(3)}`;' in source
    assert "y = met.y - 0.01;" in source


def test_a_divided_road_is_two_halves_between_the_citys_kerbs_with_a_median() -> None:
    """Each half of a divided road runs from the outer kerb to the median island's kerb, vertex
    by vertex, and the strip between the halves is asphalt with the raised median on it."""
    source = _source()
    assert "function isDividedHalf(way)" in source
    # One kerb envelope for every way: a divided half reads its outer kerb and the island's.
    assert "function recentreOnKerbEnvelope(way)" in source
    assert "function envelopeEdgesAt(x, z, nx, nz, way, reach)" in source
    assert "officialIslandCurbGrid);" in source.split("function envelopeEdgesAt", 1)[1].split("\n}\n", 1)[0]
    assert "function halfWidthAt(way, along)" in source
    assert "function addDividedMedians()" in source
    assert 'addMerged("median", mesh, "median");' in source
    # A short piece moves with the street it is part of.
    assert "function inheritRecentring(ways)" in source


def test_kerbs_follow_the_city_at_bulb_outs_and_crossings_reach_them() -> None:
    """Polk's kerb steps three metres into the road at Broadway. The crossing already ended on
    the city's line; now the pavement, its corner and the crossing's reach all do."""
    source = _source()
    assert "function indexBulbOuts(ways)" in source
    assert "function legBulb(leg, side)" in source
    assert "function legInner(leg, side)" in source
    assert "frame.meet(legInner(A, side), legInner(B, -side))" in source
    assert "function addBulbOuts(spine, innerAt, kerbAt, side, color, opacity, y, thickness)" in source
    assert "officialCurbCrossingSpan(best.x, best.z, ux, uz, best.half, wayLength(points))" in source
    # A short way between two junctions has the room of the street it carries on into.
    assert "function streetCarryOn(leg)" in source


def test_a_bike_lane_eases_sideways_to_meet_the_lane_it_joins() -> None:
    source = _source()
    assert "const BIKE_BLEND_M = 12.0;" in source
    assert "function bikeLaneJoinTarget(x, z)" in source
    assert "function blendLaneEnd(points, target, atStart)" in source
    assert "if (joinStart) lane = blendLaneEnd(lane, joinStart, true);" in source
    assert "const ease = t * t * (3 - 2 * t);" in source


def test_the_walker_is_measured_as_it_stands_and_has_a_first_person_view() -> None:
    """Box3.setFromObject read the skinned figure's unposed geometry, a fifth of its height, so
    the walker fitted to seven feet stood ten metres tall. It is measured skinned now, and a
    First person button puts the camera at its eyes."""
    source = _source()
    assert "function skinnedBounds(object)" in source
    assert "node.computeBoundingBox();" in source
    assert "const size = skinnedBounds(model).getSize(new THREE.Vector3());" in source
    assert '<button id="firstperson" aria-pressed="false"' in source
    assert "function setFirstPerson(on)" in source
    assert "eye.y = AVATAR_EYE_Y;" in source
    assert "camera.near = on ? 0.12 : 0.5;" in source


def test_the_roadway_between_the_citys_kerbs_is_filled_where_nothing_else_covers_it() -> None:
    """A street is drawn as a ribbon of one width on OpenStreetMap's centreline and the city's
    kerbs are where they are; between the two the ground showed as a black strip down the
    middle of the street. What no carriageway, pavement or median covers is filled: asphalt,
    a raised island where island kerbs bound the strip, a line where two carriageways meet."""
    source = _source()
    assert "function fillRoadwayToKerbs()" in source
    assert "function roadwayCovered(x, z)" in source
    assert "const roadFillGrid = new Set();" in source
    assert "island: width >= ROAD_FILL_ISLAND_MIN_M && kerbed(t0) && kerbed(t1), line: null };" in source
    assert "run.line = { sink: opposing ? lines.yellow : lines.white, points: offsets.map((off) => at(mid + off, 0)) };" in source
    assert "const roadwayFilled = fillRoadwayToKerbs();" in source
    # Medians stamp their strip so the fill never doubles them.
    assert "stampFill(a[0], a[1], b[0], b[1]);" in source


def test_the_pavement_stops_at_the_building_line() -> None:
    """A third of the corridor's kerb stations put the surveyed pavement through the facade or
    left a strip of bare ground before it. The pavement is held to the building line: never
    into a building, and out to the facade where its width was only a share of the right of
    way; and a way with no kerb to draw between is no wider than the houses allow."""
    source = _source()
    assert "function rayFootprintDistance(x, z, dx, dz, reach)" in source
    assert "const facade = rayFootprintDistance(sx, -sy, -side * nx, -side * nz," in source
    assert "if (room < walk - 0.6) target = Math.max(MIN_RENDER_WALK_M * 0.55, room);" in source
    assert "else if (!surveyed && facade - kerbAt[i] > walk + 1.0) {" in source
    assert "function roomBetweenFacades(way)" in source
    assert "way.road_facade_clamped = true;" in source


def test_strips_follow_the_kerbs_and_bends_are_curves() -> None:
    """The strips between kerbs -- asphalt, islands, the line where two carriageways meet --
    were one rectangle per station, squared to the tangent, and fanned open round every bend.
    They run station to station now; and a bend inside a way is drawn as an arc."""
    source = _source()
    assert "const drawStrip = (prev, cur) => {" in source
    assert "const partner = previous.find((p) => !matched.has(p) && p.island === run.island" in source
    assert "function filletBends(points)" in source
    assert "const bendsFilleted = filletStreetBends(DATA.ways);" in source


def test_a_parking_lane_is_a_block_face_the_city_lets_cars_park_on(tmp_path: Path, monkeypatch) -> None:
    """Which kerb the parked cars stand along comes from SFMTA's parking block faces, matched
    to the nearest street of the same name and the side of travel its midpoint falls on. A
    face on the far side of the block, a face of another street, and a face too short a share
    of the way to be a lane all leave the way alone. Lane lines are laid over the travel lanes
    the parking leaves (travelSpan in the page)."""
    namespace = runpy.run_path(str(SOURCE))
    annotate = namespace["annotate_parking_lanes"]
    # Polk runs north; east of the centreline is right of travel (-1), west is left (+1).
    polk = {"kind": "street", "name": "Polk Street",
            "points": [[-122.4210, 37.7950], [-122.4210, 37.7960]]}
    larkin = {"kind": "street", "name": "Larkin Street",
              "points": [[-122.4190, 37.7950], [-122.4190, 37.7960]]}
    ways = [polk, larkin, {"kind": "street", "points": polk["points"]}]
    east = [[-122.42092, 37.79505], [-122.42092, 37.79595]]          # 100 m along the east kerb
    west_short = [[-122.42108, 37.79505], [-122.42108, 37.79525]]    # 22 m along the west kerb
    zones = {"zones": [
        {"street": "POLK ST", "p": east},
        {"street": "POLK STREET", "p": west_short},
        {"street": "LARKIN ST", "p": [[-122.41892, 37.79505], [-122.41892, 37.79595]]},
        {"street": "HYDE ST", "p": east},
    ]}
    zone_file = tmp_path / "parking_zones.json"
    zone_file.write_text(json.dumps(zones), encoding="utf-8")
    monkeypatch.setitem(namespace, "PARKING_ZONES", zone_file)
    annotate.__globals__["PARKING_ZONES"] = zone_file

    counts = annotate(ways)

    assert polk["parking_sides"] == [-1], polk
    assert larkin["parking_sides"] == [-1], larkin
    assert "parking_sides" not in ways[2], "a nameless way cannot be matched to a block face"
    assert counts["block faces matched"] == 3
    assert counts["block faces with no street of that name"] == 1
    # The side reaches the page, and the page lays its paint over what the parking leaves.
    assert '"parking_sides",' in _source().split("PAGE_FIELDS = {", 1)[1].split("}", 1)[0]
    assert "function travelSpan(way, roadWidth)" in _source()
    assert "const [left, right] = travelSpan(way, road);" in _source()
