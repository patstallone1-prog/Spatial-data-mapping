"""A synthetic two-building block on an east-west street, used across the tests.

    y
    22 ---------------- Chestnut Street centreline ----------------
    15  +---------+---------+
        |    A    |    B    |      A: [0,10]x[0,15], B: [10,20]x[0,15]
     0  +---------+---------+
        0        10        20   x (metres, east)
"""

from __future__ import annotations

import pytest
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree

from kerbfront.faces import Building, build_faces


@pytest.fixture
def block():
    a = Building("A", Polygon([(0, 0), (10, 0), (10, 15), (0, 15)]), 9.0, None, None)
    b = Building("B", Polygon([(10, 0), (20, 0), (20, 15), (10, 15)]), 12.0, None, None)
    streets = [("CHESTNUT ST", LineString([(-50, 22), (70, 22)]))]
    faces = build_faces([a, b], streets)
    polys = [a.poly, b.poly]
    return {"buildings": {"A": a, "B": b}, "faces": faces, "polys": polys,
            "tree": STRtree(polys), "streets": streets}


@pytest.fixture
def a_front(block):
    return next(f for f in block["faces"] if f.building_id == "A" and f.role == "street")


def frame(fid="f1", heading=180.0, camera_type="perspective", hfov=70.0, width=4000,
          height=3000, captured_at="2026-06-01T20:00:00+00:00", sequence="s1", **kw):
    return {"id": fid, "heading": heading, "camera_type": camera_type, "hfov": hfov,
            "width": width, "height": height, "captured_at": captured_at, "sequence": sequence,
            "position_source": "sfm", "quality_score": 0.9, **kw}
