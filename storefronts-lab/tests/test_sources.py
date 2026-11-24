from kerbfront.sources.datasf import parse_placement
from kerbfront.sources.mapillary import hfov_deg, normalize


def test_parklet_placement_is_parsed_into_metres():
    p = parse_placement(
        "APPROVAL FOR LEGISLATED PROGRAM: Shared Spaces Fixed/Movable Commercial Parklet occupying "
        "approximately 22 linear feet in the roadway at 1830 UNION ST, on the NORTH side of UNION ST, "
        "from 121 feet to 143 feet WEST of OCTAVIA ST. Times of operation: ...")
    assert p["kind"] == "fixed/movable" and p["in"] == "roadway"
    assert p["side"] == "NORTH" and p["street"] == "UNION ST" and p["cross_street"] == "OCTAVIA ST"
    assert p["length_m"] == 6.71 and (p["from_m"], p["to_m"]) == (36.88, 43.59)
    assert parse_placement("Excavation for a side sewer") is None


def test_mapillary_rows_prefer_the_sfm_solution():
    row = {"id": 1, "captured_at": 1791210413000, "compass_angle": 10.0,
           "computed_compass_angle": 79.8, "geometry": {"coordinates": [-122.1, 37.1]},
           "computed_geometry": {"coordinates": [-122.43638, 37.80083]},
           "camera_type": "perspective", "camera_parameters": [0.488, -0.158, 0.027],
           "width": 1920, "height": 1080, "sequence": "S"}
    f = normalize(row)
    assert f["heading"] == 79.8 and f["heading_source"] == "sfm" and f["position_source"] == "sfm"
    assert (f["lon"], f["lat"]) == (-122.43638, 37.80083)
    assert f["captured_at"].startswith("2026-")
    # focal 0.488 of 1920 px -> ~91 deg horizontal field of view
    assert 88 < f["hfov"] < 94
    assert hfov_deg("spherical", None, 5760, 2880) == 360.0


def test_short_category_words_need_their_own_word():
    from kerbfront.sources.kerbside import tag_for
    # "pho" inside mobile_phone_store once made T-Mobile and Verizon Vietnamese restaurants
    assert tag_for("mobile_phone_store", None, None) == "shop"
    assert tag_for("pho_restaurant", None, None) == "vietnamese"
    assert tag_for("carpet_store", None, None) == "shop"
    assert tag_for("space_rental", None, None) == "shop"
    assert tag_for("hair_salon", None, None) == "salon"
