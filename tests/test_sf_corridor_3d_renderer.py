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


def test_osm_kerb_nodes_are_normalized_without_inventing_ramps() -> None:
    namespace = runpy.run_path(str(SOURCE))
    query = namespace["overpass_query"](namespace["SF_CORRIDOR"].bbox)
    assert 'node["kerb"]' in query
    normalize = namespace["normalize_osm_kerb_node"]
    node = {"type": "node", "id": 42, "lon": -122.41, "lat": 37.79,
            "tags": {"kerb": "lowered", "tactile_paving": "yes"}}
    ramp = normalize(node)
    assert ramp["accessible_lip"] is True
    assert ramp["source"] == "osm_kerb_node"
    assert ramp["osm_id"] == 42
    assert normalize({**node, "tags": {"kerb": "raised"}})["accessible_lip"] is False
    assert normalize({**node, "tags": {"barrier": "kerb"}}) is None


def test_walker_moves_only_with_arrows_and_keeps_metric_speed_at_any_zoom() -> None:
    source = _source()
    assert "const STREET_SPEED = 8.94;" in source
    assert "const FIRST_PERSON_SPEED = 5.36;" in source
    assert "const scaled = state.firstPerson ? FIRST_PERSON_SPEED : STREET_SPEED;" in source
    assert "SPEED_REFERENCE_DIST" not in source
    assert "if (!held.size || dragging)" in source
    pointer = source.split('canvas.addEventListener("pointerup", async (e) => {', 1)[1]
    pointer = pointer.split("// The address, where the building is.", 1)[0]
    assert "goTo(groundAt(" not in pointer
    context = source.split('canvas.addEventListener("contextmenu", (e) => {', 1)[1]
    context = context.split('canvas.addEventListener("pointerdown", hideAddress);', 1)[0]
    assert "goTo(groundAt(" not in context


def test_built_region_navigation_loads_full_city_and_preserves_arrival() -> None:
    source = _source()
    assert 'location.assign(url.href);' in source
    assert 'sessionStorage.setItem("kerbside:region-arrival"' in source
    assert 'saved.path === location.pathname' in source
    assert 'window.kerbsideOpenFullRegionAt(lon, lat)' in source


def test_front_lawn_stops_at_house_line_without_erasing_backyard() -> None:
    namespace = runpy.run_path(str(GROUND_SOURCE))
    ring = [[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]
    identity = lambda x, y: (x, y)
    lawn, backyard = namespace["split_at_frontage"](
        ring, (0, 0), (10, 0), 4.0, identity, identity)
    area = namespace["ring_area_m2"]
    assert area(lawn, identity) == 40.0
    assert area(backyard, identity) == 160.0
    assert max(p[1] for p in lawn) == 4.0
    assert min(p[1] for p in backyard) == 4.0


def test_batched_building_is_not_treated_as_missing_ground() -> None:
    """A successfully queued roof/walls must not create a dark fallback footprint."""
    source = _source()
    building = source.split("function buildingMesh(feature) {", 1)[1].split(
        "// ---- photographed facades ----", 1
    )[0]
    assert 'addMerged(part.materialIndex === 0 ? "roof" : "wall"' in building
    assert "return group.children.length ? group : true;" in building
    assert "if (!building) {" in source
    assert "if (building && building.isObject3D) groups.mapped3d.add(building);" in source


def test_crossing_paint_tracks_overlapping_road_triangles() -> None:
    """The crossing mesh is dense enough to stay above independently joined road ribbons."""
    source = _source()
    assert 'above: { crossing: 0.06, crossing_edges: 0.06 }, grid: 0.5' in source
    assert "if (rule.grid) o.geometry = refineForTerrain(o.geometry, rule.grid, 0);" in source


def test_plaza_paving_follows_the_two_metre_lidar_grid() -> None:
    """Coarse plaza chords let terrain poke through as dark angular holes."""
    source = _source()
    assert "plaza: [2.0, 0, 2.0, true]" in source
    assert "o.geometry = refineForTerrain(o.geometry, limit, chord, minEdge, snapToTerrain);" in source
    assert "TERRAIN_FRAME.x0 + TERRAIN_FRAME.step_m / 2" in source


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


def test_deployed_payload_contains_only_explicit_physical_dividers() -> None:
    payload = json.loads(PAGE_DATA.read_text(encoding="utf-8"))
    dividers = [way for way in payload["ways"] if way.get("kind") == "divider"]
    assert len(dividers) == 21
    assert {way["divider_source"] for way in dividers} == {
        "traffic_calming_island", "raised_kerb",
    }
    assert all(way["points"][0] == way["points"][-1] for way in dividers)


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
    assert 'fetch(asset("sf-corridor-detail-manifest.json"), { cache: "no-cache" })' in source
    assert 'records = fetch(asset(shard.file), { cache: "force-cache" })' in source
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
    # A width read from the city's kerb profile or the lidar's along the way is measured too.
    assert ('const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", '
            '"divided_half", "tunnel_cut", "curb_profile", "lidar_profile"]);') in source
    assert "const sourceCap = measured ? MAX_RENDER_ROAD_M : MAX_INFERRED_ROAD_M;" in source
    # The lane cap is for inferred widths; a width measured between the kerbs keeps it.
    assert "const laneCap = lanes && !measured ?" in source
    # And nothing clamps a way drawn between the city's kerbs, nor a street on another level.
    assert "if (way._spans !== undefined) continue;" in source
    assert "function sameLevel(a, b)" in source
    assert "const half = renderedRoadWidth(way) / 2;" in source
    assert "const road = widthMeters;" in source


def test_renderer_defers_optional_survey_layers_until_opened() -> None:
    source = _source()

    assert "const lazyLayerBuilders = new Map();" in source
    assert "function registerLazyLayer(layer, builder)" in source
    assert "function ensureLazyLayer(layer)" in source
    assert "const [DATA, OFFICIAL_GEOMETRY, DETAIL_MANIFEST, TERRAIN, PERIMETER] = await Promise.all([" in source
    assert 'fetch(asset("sf-corridor-official.json"), { cache: "no-cache" })' in source
    assert 'registerLazyLayer("official", () => {' in source
    assert 'registerLazyLayer("chunks", () => {' in source
    assert 'registerLazyLayer("furniture", async () => {' in source
    assert 'fetch(asset("sf-corridor-furniture.json"), { cache: "no-cache" })' in source
    assert '<button data-layer="furniture" aria-pressed="false">Street furniture</button>' in source
    assert 'furniture:blank_ad' in source
    assert "Official geometry:" in source
    assert 'registerLazyLayer("coverage", () => {' in source
    assert 'registerLazyLayer("observations", () => {' in source
    assert 'registerLazyLayer("sequences", () => {' in source
    assert "if (opening) ensureLazyLayer(layer);" in source


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
    # The split-front-lawn branch also retains the surveyed ring for fencing.
    assert ground.count("kept_rings.append((blklot, ring, front))") == 3


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
    assert "portal.userData.coverM = measured[label] || null;" in source
    # The portal is as wide as the city's kerbs on the approach; over sixteen metres, two bores.
    assert "function tunnelApproachWidth(mouth, outward)" in source
    assert "const bores = width > TUNNEL_TWIN_MIN_M ? 2 : 1;" in source
    # No wall of dark and no sunk bore: the bore is swept the whole way between the mouths at
    # the level the lidar read for its road -- the ground less the measured cover -- with a
    # walkway along each wall and lights at the crown; the hill is the terrain itself.
    assert "tunnel_dark" not in source and "TUNNEL_SINK_M" not in source
    assert "function sweepAlongBore(stations, section, material, surface)" in source
    assert "function tunnelStations(centre, cover = null, roadZ = null)" in source
    assert "function approachRoadAt(x, z, outsideOnly = false)" in source and '"tunnel_road_z"' in source
    assert "function tunnelCoverAlong(cover, s)" in source
    assert '"tunnel_walk"' in source and '"tunnel_light"' in source
    assert "const TUNNEL_ROOF_UNDER_M = 0.4;" in source
    # An underpass is a street to everything else.
    assert 'function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }' in source
    # Buildings stand on the lowest ground under their footprint; trees and posts on the ground.
    assert "const hillLift = groundBaseFor(feature.points);" in source
    if PAGE_DATA.exists():
        deployed = json.loads(PAGE_DATA.read_text(encoding="utf-8"))
        by_kind = {}
        for way in deployed["ways"]:
            if way.get("tunnel_kind"):
                by_kind.setdefault(way["tunnel_kind"], set()).add(way.get("name"))
        assert by_kind["road"] == {"Broadway", "Stockton Tunnel"}, by_kind
        assert by_kind["underpass"] == {"1st Street"}, by_kind
        # Measured, not defaulted: each bore carries the lidar's cover profile and mouths.
        for way in deployed["ways"]:
            if way.get("tunnel_kind") == "road":
                assert len(way.get("tunnel_cover") or []) > 20, (way["name"], "no cover profile")
                assert way.get("tunnel_mouth_low_cover_m"), way["name"]


def test_a_tunnel_way_is_cut_at_its_mouths_and_the_rest_is_street() -> None:
    """OpenStreetMap ends a tunnel way where the tagging changes, not where the ground closes
    over the road. The way used to be drawn as a tunnel end to end, so the open approach past
    the lidar's mouth had no road and no pavement. The way is cut at the mouths: the piece
    between them is the bore, the pieces outside are streets. And a mouth is where the cover
    is a roof: the lidar's 0.8 m criterion put Broadway's east mouth 26 m before the cover
    reaches 3.5 m, and that piece was a shell 1.5 m high over the road. Bush Street stands on
    the Stockton Tunnel's south portal and the mouth stays under it -- the ground is the
    lidar's now and the street is drawn on the deck."""
    namespace = runpy.run_path(str(SOURCE))
    classify = namespace["classify_tunnels"]
    split = namespace["split_tunnel_approaches"]
    stockton = {"kind": "street", "name": "Stockton Tunnel", "highway": "tertiary", "tunnel": True,
                "road_m": 14.0,
                "points": [[-122.407148, 37.790283], [-122.407648, 37.792749]]}
    # Seven decimals, as the payload now delivers its points: the portal record was keyed on
    # six, and a textual match sent every tunnel back to default portals.
    broadway = {"kind": "street", "name": "Broadway", "highway": "primary", "tunnel": True,
                "road_m": 22.0,
                "points": [[-122.4112874, 37.7972653], [-122.4178520, 37.7964130]]}
    bush = {"kind": "street", "name": "Bush Street", "highway": "secondary", "road_m": 15.0,
            "points": [[-122.4080, 37.790355], [-122.4063, 37.790355]]}
    ways = [stockton, broadway, bush]
    counts = classify(ways)
    assert counts["road tunnel measured from the lidar"] == 2, counts
    counts = split(ways)
    assert counts["bore split at its mouths"] == 2
    assert counts["approach drawn as street"] == 3, counts
    assert "mouth moved past a junction" not in counts
    approaches = [w for w in ways if w.get("tunnel_approach")]
    assert all(w["kind"] == "street" and not w.get("tunnel_kind") and not w.get("tunnel")
               for w in approaches)
    assert {(w["name"], w["tunnel_approach"]) for w in approaches} == {
        ("Stockton Tunnel", "start"), ("Broadway", "start"), ("Broadway", "end")}
    # Stockton's mouths stay where the lidar put them, under Bush Street; the cover is a roof
    # from the first sample.
    assert stockton["tunnel_mouth_low_cover_m"] == {"start": 2.0, "end": 2.0}
    assert 270 < stockton["tunnel_length_m"] < 276, stockton["tunnel_length_m"]
    assert stockton["tunnel_mouths"]["start"] == stockton["points"][0]
    assert stockton["tunnel_cover"][0][0] >= 0
    # Broadway's east mouth: 14 m inside the way by the lidar, then 26 m more to where the
    # cover is 3.5 m for two samples running. That 40 m is a street in a cut now.
    assert broadway["tunnel_mouth_low_cover_m"]["start"] == 26.0
    east = next(w for w in approaches if w["name"] == "Broadway" and w["tunnel_approach"] == "start")
    assert 36 < namespace["_way_length_m"](east["points"]) < 44
    assert 528 < broadway["tunnel_length_m"] < 536, broadway["tunnel_length_m"]
    assert broadway["tunnel_cover"][0][1] >= 3.5
    assert '"tunnel_approach"' in _source().split("PAGE_FIELDS = {", 1)[1].split("}", 1)[0]


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
