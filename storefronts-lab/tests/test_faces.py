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
