"""The grid's water is the map's water, at the height the lidar saw the water."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from smc.terrain.waterline import apply_waterline, rasterise, water_surface_m


def _grid(tmp_path: Path, height: np.ndarray, step: float = 2.0) -> Path:
    rows, cols = height.shape
    frame = {"mid_lon": -122.4, "mid_lat": 37.8, "metres_per_lon": 88_000.0, "metres_per_lat": 111_320.0,
             "x0": -cols * step / 2, "y0": -rows * step / 2, "step_m": step, "cols": cols, "rows": rows,
             "base_m": -3.0, "nodata": -32768, "dtype": "int16-le-cm"}
    cm = np.where(np.isnan(height), -32768, np.round((height - frame["base_m"]) * 100.0)).astype(np.int16)
    (tmp_path / "grid.bin").write_bytes(cm.tobytes(order="C"))
    (tmp_path / "grid.json").write_text(json.dumps({"frame": frame}))
    return tmp_path / "grid.bin"


def test_a_quays_fill_over_the_bay_becomes_water_and_land_outside_the_coastline_stays(tmp_path: Path):
    rows, cols = 60, 100
    height = np.full((rows, cols), 4.0)               # the town, 4 m up
    height[:, 60:] = -0.1 + 0.02 * np.random.default_rng(1).standard_normal((rows, 40))   # returns off the water
    height[:, 55:60] = 3.5                             # the grid builder's fill, 10 m out over the water
    height[20:25, 40:50] = 3.2                         # a pier deck the coastline goes round, mapped as land
    height[:, 95:] = np.nan                            # open water, no returns
    # The coastline: everything east of column 55 is water, in lon/lat.
    frame = json.loads((_grid(tmp_path, height)).with_suffix(".json").read_text())["frame"]
    x_edge = frame["x0"] + 55 * frame["step_m"]
    def lon(x): return -122.4 + x / 88_000.0
    def lat(y): return 37.8 + y / 111_320.0
    ring = [[lon(x_edge), lat(-1000)], [lon(1000), lat(-1000)], [lon(1000), lat(1000)], [lon(x_edge), lat(1000)]]
    grid = tmp_path / "grid.bin"
    record = apply_waterline(grid, [ring])
    assert abs(record["surface_m"] - (-0.1)) < 0.05
    cm = np.frombuffer(grid.read_bytes(), dtype=np.int16).reshape(rows, cols)
    h = np.where(cm == -32768, np.nan, -3.0 + cm / 100.0)
    # The fill became water; the pier and the town outside the coastline did not; open water is
    # still no data.
    assert np.allclose(h[:, 55:60], record["surface_m"], atol=0.011)
    assert np.allclose(h[20:25, 40:50], 3.2, atol=0.011) and np.allclose(h[:20, :55], 4.0)
    assert np.isnan(h[:, 95:]).all()
    assert record["cells_set_to_water"] >= rows * 5
    # Running it again changes nothing more.
    again = apply_waterline(grid, [ring])
    assert again["cells_set_to_water"] == 0 and again["surface_m"] == record["surface_m"]


def test_rasterise_follows_the_even_odd_rule_and_a_grid_with_no_water_says_so():
    frame = {"mid_lon": 0.0, "mid_lat": 0.0, "metres_per_lon": 100_000.0, "metres_per_lat": 100_000.0,
             "x0": -10.0, "y0": -10.0, "step_m": 1.0, "cols": 20, "rows": 20}
    square = [[-0.00005, -0.00005], [0.00005, -0.00005], [0.00005, 0.00005], [-0.00005, 0.00005]]
    mask = rasterise([square], frame)
    assert 90 <= mask.sum() <= 110 and mask[10, 10] and not mask[0, 0]
    assert water_surface_m(np.full((10, 10), 20.0)) is None


def test_a_coastline_floods_its_seaward_side_and_stops_at_the_quay(tmp_path: Path):
    """Water to port of the way, land to starboard; the flood does not climb a quay."""
    from smc.terrain.waterline import coastline_mask
    rows, cols = 40, 80
    height = np.full((rows, cols), -0.1)
    height[:, :30] = 5.0                  # the town, west
    height[:, 30:34] = 2.0                # the quay wall
    height[10:14, 34:60] = 1.6            # a pier deck out over the water: land
    frame = json.loads(_grid(tmp_path, height).with_suffix(".json").read_text())["frame"]
    # A coastline running south along column 34's west edge: travelling south the land (west) is
    # on its right and the water (east) on its left, as the map's convention has it.
    x = frame["x0"] + 34 * frame["step_m"]
    def lon(xx): return -122.4 + xx / 88_000.0
    def lat(yy): return 37.8 + yy / 111_320.0
    coast = [[lon(x), lat(frame["y0"] + rows * frame["step_m"])], [lon(x), lat(frame["y0"])]]
    for line in (coast, coast[::-1]):                  # drawn either way round: the returns decide
        water = coastline_mask([line], frame, height, -0.1)
        assert water[:, 40:].sum() > rows * 35 * 0.9      # the open water is water
        assert not water[:, :33].any()                     # the town and the quay are not
        assert not water[10:14, 36:58].any()               # the pier deck is not
