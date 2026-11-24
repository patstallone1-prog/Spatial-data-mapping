import pytest


def test_street_party_and_open_faces(block):
    a = [f for f in block["faces"] if f.building_id == "A"]
    roles = {round(f.normal_bearing): f.role for f in a}
    assert roles[0] == "street"          # north edge faces Chestnut
    assert roles[90] == "party"          # shared wall with B
    assert roles[270] == "open"          # exposed west wall, no street within range
    assert roles[180] == "open"          # rear yard
    front = next(f for f in a if f.role == "street")
    assert front.street == "CHESTNUT ST"
    assert front.street_dist_m == pytest.approx(7.0, abs=0.01)
    assert front.length_m == pytest.approx(10.0)


def test_normals_point_outward(block):
    for f in block["faces"]:
        poly = block["buildings"][f.building_id].poly
        mx, my = f.mid
        nx, ny = f.normal
        from shapely.geometry import Point
        assert not poly.contains(Point(mx + nx * 0.5, my + ny * 0.5))
        assert poly.buffer(0.01).contains(Point(mx - nx * 0.005, my - ny * 0.005))


def test_street_must_run_parallel(block):
    from shapely.geometry import LineString
    from kerbfront.faces import build_faces
    cross = [("FILLMORE ST", LineString([(5, -50), (5, 80)]))]   # perpendicular street
    faces = build_faces(list(block["buildings"].values()), cross)
    assert not any(f.role == "street" and f.street == "FILLMORE ST" and round(f.normal_bearing) == 0
                   for f in faces)


def test_an_edge_inside_a_notch_is_a_recess_not_a_street_face():
    from shapely.geometry import LineString, Polygon
    from kerbfront.faces import Building, build_faces
    # a slot cut in from the east side (y 6..7, x 4..10): the slot's lower edge faces north,
    # toward the street, but the building's front part (y 7..10) stands between it and the street
    ring = [(0, 0), (10, 0), (10, 6), (4, 6), (4, 7), (10, 7), (10, 10), (0, 10)]
    shop = Building("S", Polygon(ring), 8.0, None, None)
    faces = build_faces([shop], [("CHESTNUT ST", LineString([(-30, 17), (40, 17)]))])
    slot = next(f for f in faces if abs(f.mid[1] - 6.0) < 0.01)
    front = next(f for f in faces if abs(f.mid[1] - 10.0) < 0.01)
    assert slot.role == "recess" and front.role == "street"


def test_a_bay_in_front_of_a_facade_does_not_make_it_a_recess():
    from shapely.geometry import LineString, Polygon
    from kerbfront.faces import Building, build_faces
    # 12 m frontage with a 3 m wide, 0.8 m deep bay projecting from its middle
    ring = [(0, 0), (12, 0), (12, 10), (7.5, 10), (7.5, 10.8), (4.5, 10.8), (4.5, 10), (0, 10)]
    b = Building("Bay", Polygon(ring), 9.0, None, None)
    faces = build_faces([b], [("UNION ST", LineString([(-30, 18), (40, 18)]))])
    street = [f for f in faces if f.role == "street"]
    assert {round(f.length_m, 1) for f in street} >= {4.5, 3.0}
