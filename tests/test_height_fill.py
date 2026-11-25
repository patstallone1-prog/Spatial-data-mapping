"""The height fill (smc.buildings.height_fill): City3D, then 3dfier, then the atlas -- and only
for buildings whose height was a guess."""

from __future__ import annotations

import math
from pathlib import Path

from smc.buildings.height_fill import (
    FILLABLE,
    GbaIndex,
    city3d_reading,
    fill_heights,
    overlap,
    plausible,
    roof_entry,
    tdf_reading,
)

# A 10 x 8 m footprint at the Marina (lon/lat).
LON, LAT = -122.4360, 37.8030
KX = 111_320.0 * math.cos(math.radians(LAT))


def square(w=10.0, d=8.0, dx=0.0):
    return [[LON + (dx + x) / KX, LAT + y / 111_320.0] for x, y in ((0, 0), (w, 0), (w, d), (0, d), (0, 0))]


def building(osm_id, source="inferred_default", h=10.5, dx=0.0):
    return {"kind": "building", "osm_id": osm_id, "height_m": h, "height_source": source, "points": square(dx=dx)}


def test_the_sources_are_tried_in_order_city3d_then_3dfier_then_the_atlas():
    readings = {"city3d": {"1": {"height_m": 7.2}}, "3dfier": {"1": {"height_m": 7.9}, "2": {"height_m": 12.4}}}
    gba = GbaIndex([{"k": "osm1USA", "src": "osm", "id": "1", "h": 9.0, "p": square()},
                    {"k": "osm2USA", "src": "osm", "id": "2", "h": 15.0, "p": square()},
                    {"k": "osm3USA", "src": "osm", "id": "3", "h": 6.1, "p": square()}])
    ways = [building(1), building(2), building(3), building(4, dx=300)]
    counts = fill_heights(ways, readings, gba)
    assert [w["height_source"] for w in ways] == ["city3d_lod2", "3dfier_lod12", "gba_lod1", "inferred_default"]
    assert [w["height_m"] for w in ways] == [7.2, 12.4, 6.1, 10.5]
    assert counts == {"city3d": 1, "3dfier": 1, "gba": 1, "unfilled": 1}
    # The atlas's heights are non-commercial, and a building filled from it says so.
    assert "NC" in ways[2]["height_licence"] and "height_licence" not in ways[0]


def test_only_a_guessed_height_is_filled():
    readings = {"city3d": {str(i): {"height_m": 20.0} for i in range(10)}}
    kept = [building(1, "osm_height", 9.0), building(2, "lidar_region", 11.0), building(3, "osm_levels", 6.0),
            building(4, "datasf_lidar_median_height", 8.0), building(5, "overture_height", 7.0)]
    filled = [building(6, "inferred_default"), building(7, "regional_median_estimate", 7.0), building(8, None, None)]
    fill_heights(kept + filled, readings, None)
    assert [w["height_m"] for w in kept] == [9.0, 11.0, 6.0, 8.0, 7.0]
    assert all(w["height_m"] == 20.0 for w in filled)
    assert {"inferred_default", "regional_median_estimate", None} <= FILLABLE


def test_an_implausible_reading_falls_through_to_the_next_source():
    # 90 m on a 10 x 8 m footprint is a crane or the tower next door, not this building.
    readings = {"city3d": {"1": {"height_m": 90.0}}, "3dfier": {"1": {"height_m": 1.1}}}
    gba = GbaIndex([{"k": "osm1USA", "src": "osm", "id": "1", "h": 8.4, "p": square()}])
    ways = [building(1)]
    fill_heights(ways, readings, gba)
    assert ways[0]["height_source"] == "gba_lod1" and ways[0]["height_m"] == 8.4
    assert not plausible(90.0, 80.0) and not plausible(1.1) and plausible(326.0, 2500.0)
    # A shed may be that low; a house-sized footprint may not.
    assert plausible(1.3, 12.0) and not plausible(1.3, 120.0) and not plausible(0.6, 12.0)


def test_the_atlas_is_found_by_its_osm_way_or_else_by_the_outline_it_overlaps():
    gba = GbaIndex([{"k": "ms77USA", "src": "ms", "id": "77", "h": 13.0, "p": square(dx=0.6)},
                    {"k": "ms78USA", "src": "ms", "id": "78", "h": 30.0, "p": square(dx=40)}])
    near = gba.find({"osm_id": -5, "points": square()})
    assert near["height_m"] == 13.0 and near["match"] == "outline" and near["overlap"] > 0.85
    assert gba.find({"osm_id": -6, "points": square(dx=20)}) is None
    assert overlap([(0, 0), (10, 0), (10, 10), (0, 10)], [(5, 0), (15, 0), (15, 10), (5, 10)]) == pytest_approx(1 / 3)


def pytest_approx(v, tol=0.03):
    class _A:
        def __eq__(self, other):
            return abs(other - v) <= tol
    return _A()


def obj(verts, faces):
    return "\n".join([f"v {x} {y} {z}" for x, y, z in verts] + ["f " + " ".join(str(i + 1) for i in f) for f in faces])


def test_city3d_models_give_a_height_and_a_roof():
    # A 10 x 8 box, walls to 6 m, a gable ridge along x at 9 m.
    v = [(0, 0, 0), (10, 0, 0), (10, 8, 0), (0, 8, 0), (0, 0, 6), (10, 0, 6), (10, 8, 6), (0, 8, 6), (0, 4, 9), (10, 4, 9)]
    walls = [[0, 1, 5, 4], [1, 2, 6, 9, 5], [2, 3, 7, 6], [3, 0, 4, 8, 7]]
    floor = [[0, 3, 2, 1]]
    gable = city3d_reading(obj(v, walls + floor + [[4, 5, 9, 8], [6, 7, 8, 9]]))
    assert gable["height_m"] == 9.0 and gable["roof"] == "gabled" and gable["roof_height_m"] == 3.0
    assert 30 < gable["pitch_deg"] < 45
    # Hipped: four sides to a short ridge.
    hv = [*v[:8], (3, 4, 9), (7, 4, 9)]
    hip = city3d_reading(obj(hv, [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], *floor, [4, 5, 9, 8], [6, 7, 8, 9], [5, 6, 9], [7, 4, 8]]))
    assert hip["roof"] == "hipped" and hip["sides"] == 4
    # Flat: one roof face at 6 m.
    flat = city3d_reading(obj(v[:8], [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], *floor, [4, 5, 6, 7]]))
    assert flat["roof"] == "flat" and flat["height_m"] == 6.0
    # Skillion: one face sloping from 6 to 8 m.
    sv = [*v[:4], (0, 0, 6), (10, 0, 6), (10, 8, 8), (0, 8, 8)]
    shed = city3d_reading(obj(sv, [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], *floor, [4, 5, 6, 7]]))
    assert shed["roof"] == "skillion"
    assert city3d_reading("") is None


def test_3dfier_percentiles_give_a_height_and_flat_or_pitched():
    flat = tdf_reading({"ground": "10.0", "roof-0.25": "21.6", "roof-0.90": "22.0", "roof-0.99": "22.1"})
    assert flat == {"height_m": 12.0, "roof_spread_m": 0.5, "roof": "flat"}
    pitched = tdf_reading({"ground": "3.0", "roof-0.10": "7.6", "roof-0.25": "8.0", "roof-0.90": "11.0", "roof-0.99": "11.8"})
    assert pitched["roof"] == "pitched" and pitched["height_m"] == 8.0 and pitched["roof_height_m"] == 4.2
    assert "roof" not in tdf_reading({"ground": "0", "roof-0.25": "5", "roof-0.90": "6", "roof-0.99": "6"})
    assert tdf_reading({"ground": "x"}) is None
    # A crown over a shed: the "roof" spreads 15 m over a 6 m reading -- canopy, no height.
    tree = tdf_reading({"ground": "0", "roof-0.10": "1", "roof-0.25": "2", "roof-0.90": "6.4", "roof-0.99": "17"})
    assert tree["rejected"] == "canopy" and "height_m" not in tree


def test_roofs_published_are_pitched_ones_with_a_real_rise():
    assert roof_entry("city3d", {"roof": "gabled", "roof_height_m": 3.0, "pitch_deg": 37}, 9.0) == {
        "roof": "gabled", "roof_height_m": 3.0, "source": "city3d_lod2", "pitch_deg": 37}
    # 3dfier can only say "pitched": drawn hipped, as the lidar measurer draws pitched roofs.
    assert roof_entry("3dfier", {"roof": "pitched", "roof_height_m": 2.4}, 8.0)["roof"] == "hipped"
    # Never more than half the building; flat, complex and shallow roofs are not published.
    assert roof_entry("city3d", {"roof": "hipped", "roof_height_m": 9.0}, 8.0)["roof_height_m"] == 4.0
    for r in ({"roof": "flat"}, {"roof": "complex", "roof_height_m": 3}, {"roof": "gabled", "roof_height_m": 0.4}):
        assert roof_entry("city3d", r, 10.0) is None


ROOT = Path(__file__).resolve().parents[1]
FILL_SCRIPT = ROOT / "scripts/fill_building_heights.py"
GBA_SCRIPT = ROOT / "scripts/fetch_gba_heights.py"


def _script(path):
    import importlib.util
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_fill_script_reads_3dfier_thins_for_city3d_and_picks_roof_classes():
    import numpy as np
    fill = _script(FILL_SCRIPT)
    # 3dfier's CSV header, as 1.5.0 writes it: the ground at its 10th percentile.
    row = dict(zip(["id", "ground-0.00", "ground-0.10", "ground-0.50", "roof-0.10", "roof-0.25", "roof-0.90", "roof-0.99"],
                   ["42", "-0.09", "-0.03", "0.00", "6.88", "7.26", "8.77", "8.97"], strict=True))
    cols = fill._tdf_columns(row)
    assert cols["ground"] == "-0.03" and tdf_reading(cols)["height_m"] == 8.8
    # One return per column, the highest.
    pts = np.array([[0.05, 0.05, 1.0], [0.1, 0.1, 3.0], [0.9, 0.9, 2.0]])
    assert sorted(fill._thin(pts, 0.3)[:, 2].tolist()) == [2.0, 3.0]

    class Cloud:
        def __init__(self, classes):
            self.classification = np.array(classes)
    assert fill.roof_classes(Cloud([2, 6, 6, 1, 5])) == [6]          # Santa Clara: buildings labelled
    assert fill.roof_classes(Cloud([2, 1, 1, 1, 2])) == [1, 6]       # San Francisco: not


def test_the_atlas_fetch_projects_web_mercator_and_keeps_only_the_regions():
    gba = _script(GBA_SCRIPT)
    lon, lat = gba.lonlat(-13604249.6, 4554813.7)
    assert abs(lon + 122.208) < 0.01 and abs(lat - 37.8) < 0.05
    boxes = gba.Boxes([(-122.45, 37.78, -122.39, 37.81)])
    assert boxes.has(-122.42, 37.80) and not boxes.has(-122.30, 37.80)
