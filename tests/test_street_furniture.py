import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_street_furniture.py"


def _module():
    spec = importlib.util.spec_from_file_location("build_street_furniture", SOURCE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_overpass_query_pulls_inferred_furniture_tags() -> None:
    module = _module()
    query = module.overpass_query(module.CORRIDOR)

    assert 'node["advertising"]' in query
    assert 'way["advertising"]' in query
    assert 'node["amenity"="shelter"]' in query
    assert 'node["highway"~"^(bus_stop|stop|give_way|traffic_signals)$"]' in query
    assert 'node["traffic_sign"]' in query


def test_osm_records_are_inferred_not_geometry_based() -> None:
    module = _module()
    records = module.records_from_osm([
        {
            "type": "node",
            "id": 1,
            "lon": -122.42,
            "lat": 37.79,
            "tags": {"highway": "bus_stop", "name": "Muni stop"},
        },
        {
            "type": "node",
            "id": 2,
            "lon": -122.421,
            "lat": 37.791,
            "tags": {"amenity": "shelter", "shelter_type": "public_transport"},
        },
        {
            "type": "node",
            "id": 3,
            "lon": -122.422,
            "lat": 37.792,
            "tags": {"traffic_sign": "US:R1-1", "highway": "stop"},
        },
        {
            "type": "way",
            "id": 4,
            "geometry": [{"lon": -122.423, "lat": 37.793}, {"lon": -122.424, "lat": 37.794}],
            "tags": {"advertising": "billboard"},
        },
    ])

    assert len(records["bus_stops"]) == 1
    assert len(records["shelters"]) == 1
    assert len(records["street_signs"]) == 1
    assert len(records["ad_panels"]) == 1
    assert records["street_signs"][0]["provenance"] == "inferred_from_osm_tags"
    assert records["ad_panels"][0]["geometry_basis"] == "osm_way_centroid"
    assert records["ad_panels"][0]["creative"] == "blank_white_placeholder"


def test_muni_stop_specs_keep_official_dimensions_separate_from_shelter_mesh() -> None:
    module = _module()
    specs = module.MUNI_STOP_SPECS

    assert specs["official_geometry"]["bus_bulb_front_door_width_m"] == [2.44, 3.66]
    assert specs["official_geometry"]["transit_island_min_width_m"] == 2.44
    assert specs["official_geometry"]["transit_island_min_length_m"] == 45.72
    assert specs["official_geometry"]["transit_island_height_m"] == [0.152, 0.203]
    assert specs["inferred_shelter_mesh"]["provenance"] == "inferred_standard_mesh_from_osm_shelter_tag"


def test_official_stop_signs_are_geometry_based_with_orientation_provenance() -> None:
    module = _module()

    records = module.records_from_official({
        "sfmta_stop_signs": [{
            "type": "Feature",
            "properties": {
                "OBJECTID": 11,
                "STREET": "PIERCE",
                "X_STREET": "GREENWICH",
                "ST_FACING": "NB",
                "DIRECTION": "NW",
                "CNN": "26963000",
            },
            "geometry": {"type": "Point", "coordinates": [-122.4391562, 37.7985333]},
        }]
    })

    sign = records["street_signs"][0]
    assert sign["source"] == "sfmta_stop_signs"
    assert sign["provenance"] == "official_mtab_stop_sign_inventory"
    assert sign["geometry_basis"] == "official_asset_point"
    assert sign["sign_kind"] == "stop"
    assert sign["bearing"] == 180.0
    assert sign["face_policy"] == "single_sided_from_approach_heading"


def test_zero_degree_official_sign_bearing_does_not_fall_back_to_corner() -> None:
    module = _module()

    assert module.first_bearing("SB", "NW") == 0.0


def test_official_curb_zone_lines_keep_color_policy_and_geometry() -> None:
    module = _module()

    records = module.records_from_official({
        "sfmta_curb_zones": [{
            "type": "Feature",
            "properties": {
                "OBJECTID": 9,
                "CURB_ZONE_ID": "cz-9",
                "POLICY_CATEGORY": "Commercial Loading",
                "POLICY_SUPER_CATEGORY": "Commercial Loading",
                "LABEL": "Commercial Loading",
                "LENGTH_FT": 40,
                "STREET_NAME": "PINE ST",
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[-122.4169, 37.7900], [-122.4168, 37.7901]],
            },
        }]
    })

    zone = records["curb_zones"][0]
    assert zone["source"] == "sfmta_curb_zones"
    assert zone["curb_color"] == "yellow"
    assert zone["lines"] == [[[-122.4169, 37.79], [-122.4168, 37.7901]]]
    assert zone["geometry_basis"] == "official_digital_curb_polyline"


def test_curb_paint_is_paint_not_signage() -> None:
    """Two fifths of every kerb in the corridor was red because "No Parking Some Time" -- a
    street-cleaning sign on a post -- and "Crosswalk", a curb cut, were painted. Paint is the
    policies that are painted: the loading zones, the short no-parking-anytime zone at a
    corner, accessible, short term. Green comes from the Color Curb Program's own inventory,
    which is now rendered as well; it appeared nowhere else."""
    module = _module()
    color_curb_color, curb_zone_color = module.color_curb_color, module.curb_zone_color

    assert curb_zone_color({"POLICY_CATEGORY": "No Parking Some Time"}) is None
    assert curb_zone_color({"POLICY_CATEGORY": "Crosswalk"}) is None
    assert curb_zone_color({"POLICY_CATEGORY": "Driveway"}) is None
    assert curb_zone_color({"POLICY_CATEGORY": "General Parking"}) is None
    assert curb_zone_color({"POLICY_CATEGORY": "No Parking Anytime"}) == "red"
    assert curb_zone_color({"POLICY_CATEGORY": "Transit Vehicle Loading"}) == "red"
    assert curb_zone_color({"POLICY_CATEGORY": "Commercial Loading"}) == "yellow"
    assert curb_zone_color({"POLICY_CATEGORY": "Passenger Loading"}) == "white"
    assert curb_zone_color({"POLICY_CATEGORY": "Accessible Parking"}) == "blue"
    assert curb_zone_color({"POLICY_CATEGORY": "Short Term Parking"}) == "green"
    assert color_curb_color({"ZONE_TYPE": "Green Zone/Short Term Parking"}) == "green"
    assert color_curb_color({"ZONE_TYPE": "Green Meter"}) == "green"
    assert color_curb_color({"ZONE_TYPE": "Driveway Red Zone"}) == "red"
    assert color_curb_color({"ZONE_TYPE": "Blue Zone/Disabled Parking"}) == "blue"
    assert color_curb_color({"ZONE_TYPE": "Taxi Zone"}) == "white"
    assert color_curb_color({"ZONE_TYPE": "6-Wheel Commercial Loading Zone"}) == "yellow"


def test_the_published_curb_paint_is_all_five_colours_and_mostly_not_red() -> None:
    """What ships: no signed policy painted, every colour present, the paint inventory in."""
    import json

    sidecar = ROOT / "docs" / "sf-corridor-furniture.json"
    if not sidecar.exists():
        return
    official = json.loads(sidecar.read_text(encoding="utf-8"))["geometry_based"]
    zones = official["curb_zones"]
    assert not [z for z in zones if z.get("policy_category") in ("No Parking Some Time", "Crosswalk", "Driveway")]
    colours = {}
    for record in zones + official["color_curbs"]:
        colours[record["curb_color"]] = colours.get(record["curb_color"], 0) + 1
    assert set(colours) == {"red", "yellow", "white", "blue", "green"}, colours
    assert colours["green"] >= 50, colours
    # Red is the corner and hydrant zones, the transit stops and the driveway reds -- under
    # two thirds of the painted records, where it was five sixths.
    assert colours["red"] / sum(colours.values()) < 0.7, colours
