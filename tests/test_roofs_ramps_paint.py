"""Roof shapes, kerb ramps and stairs off the lidar, crosswalk paint off the photograph, and the
test scripts that score them (cloud/docs/roofs-ramps-paint-tests.md), on made-up cases whose
answers are known."""

from __future__ import annotations

import importlib.util
import math
from pathlib import Path

import numpy as np

from smc.imagery.crosswalks import crossing_paint
from smc.lidar.ept import CLASS_GROUND, LocalCloud
from smc.lidar.ramps import kerb_step_at, stair_profile
from smc.lidar.region import latlon
from smc.lidar.roofs import classify_planes, rectangularity, roof_shape

ROOT = Path(__file__).resolve().parents[1]
LAT0, LON0 = 37.87, -122.27


def script(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cloud(e, n, u, c) -> LocalCloud:
    return LocalCloud(east=np.asarray(e, float), north=np.asarray(n, float), up=np.asarray(u, float),
                      classification=np.asarray(c, np.uint8), origin_lat=LAT0, origin_lon=LON0)


def ring_lonlat(w: float, d: float) -> list[list[float]]:
    pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2), (-w / 2, -d / 2)]
    return [[latlon(x, y, LAT0, LON0)[1], latlon(x, y, LAT0, LON0)[0]] for x, y in pts]


def house(roof, w=14.0, d=10.0, step=0.25):
    """Ground round a w x d house and its roof (z = roof(x, y)), returns every ``step`` metres."""
    xs, ys = np.meshgrid(np.arange(-w / 2 - 3, w / 2 + 3, step), np.arange(-d / 2 - 3, d / 2 + 3, step))
    x, y = xs.ravel(), ys.ravel()
    on = (np.abs(x) < w / 2) & (np.abs(y) < d / 2)
    z = np.where(on, 6.0 + roof(x, y), 0.0)
    c = np.where(on, 6, CLASS_GROUND)
    return cloud(x, y, z, c)


def test_a_hipped_roof_and_a_flat_one_are_told_apart():
    def hip(x, y):
        return np.minimum(np.minimum(7 - np.abs(x), 5 - np.abs(y)), 4.0) * 0.6
    assert roof_shape(house(hip), ring_lonlat(14, 10))["shape"] == "hip"
    def flat(x, y):
        return np.zeros_like(x)
    assert roof_shape(house(flat), ring_lonlat(14, 10))["shape"] == "flat"
    small = roof_shape(house(flat, 5, 6), ring_lonlat(5, 6))
    assert small["shape"] == "unknown" and small["abstain"] == "too small"


def test_the_plane_rules_abstain_rather_than_guess():
    def face(az, share, slope=30):
        return {"slope_deg": slope, "azimuth_deg": az, "share": share}
    assert classify_planes([face(0, 0.25), face(90, 0.25), face(180, 0.25), face(270, 0.25)], 0.95)[0] == "hip"
    assert classify_planes([face(0, 0.5), face(180, 0.5)], 0.95, drop=0.1)[0] == "gable"
    assert classify_planes([face(0, 0.5), face(180, 0.5)], 0.95, drop=0.9)[0] == "unknown"
    assert classify_planes([face(0, 0.25), face(90, 0.25), face(180, 0.25), face(270, 0.25)], 0.95, rect=0.8)[0] == "unknown"
    assert classify_planes([face(0, 0.9)], 0.4)[0] == "unknown"
    assert rectangularity(np.array([[0, 0], [10, 0], [10, 6], [0, 6]], float)) > 0.99


def kerb_cloud(riser: float):
    """A crossing end: road to the west, pavement to the east ``riser`` higher, the step at x=0."""
    xs, ys = np.meshgrid(np.arange(-3, 3, 0.05), np.arange(-0.8, 0.8, 0.1))
    x, y = xs.ravel(), ys.ravel()
    z = np.where(x > 0, riser, 0.0) + 0.005 * np.sin(x * 37)
    return cloud(x, y, z, np.full(x.size, CLASS_GROUND))


def lonlat(e, n):
    lat, lon = latlon(e, n, LAT0, LON0)
    return [lon, lat]


def test_a_kerb_and_a_ramp_at_the_end_of_a_crossing():
    end, road = lonlat(0.5, 0), lonlat(-8, 0)
    assert kerb_step_at(kerb_cloud(0.15), end, road)["class"] == "kerb"
    assert kerb_step_at(kerb_cloud(0.0), end, road)["class"] == "ramp"
    assert kerb_step_at(kerb_cloud(0.07), end, road)["class"] == "unknown"


def test_a_flight_of_stairs_is_steeper_than_any_street():
    xs, ys = np.meshgrid(np.arange(0, 20, 0.15), np.arange(-1, 1, 0.15))
    x, y = xs.ravel(), ys.ravel()
    steps = cloud(x, y, np.where((x > 6) & (x < 12), (x - 6) * 0.6, np.where(x >= 12, 3.6, 0)), np.full(x.size, CLASS_GROUND))
    hill = cloud(x, y, x * 0.17, np.full(x.size, CLASS_GROUND))
    line = [lonlat(0.5, 0), lonlat(19, 0)]
    assert stair_profile(steps, line)["stairs"] is True
    assert stair_profile(hill, line)["stairs"] is False


def photo(bars: bool):
    """A 0.25 m photograph 20 m square: grey asphalt, and continental bars across a crossing
    running east-west through the middle (1.2 m period) when ``bars``."""
    px, size = 0.25, 80
    rgb = np.full((3, size, size), 95.0)
    if bars:
        cols = np.arange(size) * px
        on = (np.floor(cols / 0.6) % 2 == 0) & (cols > 4) & (cols < 16)
        rows = slice(int(8.5 / px), int(11.5 / px))
        for k in range(3):
            rgb[k, rows, on] = 220.0
    return {"rgb": rgb, "valid": np.ones((size, size), bool), "nir": np.full((size, size), 60.0),
            "bounds": (0.0, 0.0, 20.0, 20.0), "pixel_m": px, "gsd_m": px}


def test_continental_bars_are_paint_and_coarse_photographs_are_unknown():
    a, b = (3.0, 10.0), (17.0, 10.0)
    assert crossing_paint(photo(True), a, b)["answer"] == "paint"
    assert crossing_paint(photo(False), a, b)["answer"] != "paint"
    coarse = {**photo(True), "gsd_m": 0.6}
    assert crossing_paint(coarse, a, b) == {"answer": "unknown", "why": "photograph too coarse"}


def test_the_scoring_scripts():
    paint = script(ROOT / "scripts" / "test_paint_crosswalks.py")
    p = {"share": 0.45, "agree": 0.5, "contrast": 30, "ridge": 1.01, "clean": -1}
    seen = {"period_share": 0.6, "half_agreement": 0.8, "contrast": 60, "bright": 200, "edge_ridge": 0, "shadow": 0}
    assert paint.decide(seen, p) == "paint"
    assert paint.decide({**seen, "gate": "in shadow"}, p) == "unknown"
    rows = [{"scores": seen, "truth": "paint"}, {"scores": {**seen, "contrast": 5}, "truth": "no_paint"}]
    assert paint.table(rows, p)["paint"]["precision"] == 1.0
    assert paint.half("osm:1") in ("tune", "test")
    access = script(ROOT / "scripts" / "test_access_lidar.py")
    summary = access.summarise_ramps([{"class": "ramp", "truth": "ramp"}, {"class": "kerb", "truth": "ramp"}, {"class": "unknown", "truth": None}])
    assert summary["ramp_precision"] == 1.0 and summary["kerb_precision"] == 0.0
    roofs = script(ROOT / "scripts" / "measure_roof_shapes.py")
    rect = roofs.min_rectangle([[-122.27, 37.87], [-122.2699, 37.87], [-122.2699, 37.8701], [-122.27, 37.8701], [-122.27, 37.87]])
    assert len(rect) == 5 and rect[0] == rect[-1]
    snap = script(ROOT / "scripts" / "test_entrance_snap.py")
    d, q = snap.seg_dist((1, 1), (0, 0), (2, 0))
    assert math.isclose(d, 1.0) and q == (1.0, 0.0)
    osm = script(ROOT / "scripts" / "fetch_access_osm.py")
    assert osm.pick({"wheelchair": "yes", "x": 1}, ("wheelchair",)) == {"wheelchair": "yes"}
