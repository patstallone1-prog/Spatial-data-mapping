#!/usr/bin/env python3
"""The ground the corridor stands on, from the city's lidar.

The model was flat: every street, footway and building sat at y = 0, Russian Hill was a level
plain, and the tunnels had to be sunk under it to have anything to go through. This builds a
digital elevation model of the ground surface from USGS 3DEP ground returns -- the same lidar
the kerb heights, the medians and the tunnel mouths were read from -- on a ``STEP_M`` grid over
the corridor, and publishes it as a compact binary the page lifts everything onto.

Each cell takes the mean of the ground returns inside it; a cell with none takes the mean of
its neighbours, out to ``FILL_REACH`` cells. A hole wider than that -- the block under a large
building, a decked-over road -- is closed by growing the known ground into it one cell at a
time, out to ``FAR_FILL_REACH`` cells, so nothing standing on it drops to sea level; a hole
wider still is open water and stays no data (the page draws the bay there). Heights are stored as Int16 centimetres above
``base_m`` so the whole corridor is a few megabytes and compresses to less.

Accuracy is measured, not assumed: ``HOLDOUT_SHARE`` of the ground returns take no part in
the gridding and are then compared with the grid interpolated at their position. That is the
DEM's own error -- gridding plus interpolation -- on top of the lidar's, which USGS states as
about 10 cm RMSEz for this collection. The residuals are reported overall, on the roadway
(within 4 m of a street centreline), on everything else, and by slope class, and written
beside the grid so the README quotes a file.

Output: docs/sf-corridor-terrain.bin (Int16 little-endian, row-major, rows south to north,
columns west to east) and docs/sf-corridor-terrain.json (the grid's frame and the accuracy).
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import SF_CORRIDOR  # noqa: E402
from smc.lidar.ept import EptReader  # noqa: E402

STEP_M = 2.0
#: Fetched in tiles this wide; the reader caches them, so a re-run costs no download.
TILE_M = 200.0
MARGIN_M = 120.0
FILL_REACH = 6
#: A hole wider than FILL_REACH is grown into from its edge, one cell a step, this far (cells).
#: Sixty cells is 120 m: the widest block in the corridor, not the bay.
FAR_FILL_REACH = 60
HOLDOUT_SHARE = 0.02
MIN_CELL_POINTS = 2
#: The lidar is read at this spacing: two metres of grid does not need five-centimetre points.
RESOLUTION_M = 0.5
KY = 111_320.0


def fill_far(filled: np.ndarray, max_reach: int = FAR_FILL_REACH) -> tuple[np.ndarray, int]:
    """Grow the known ground into the remaining holes, one ring of cells a step.

    Each step, every no-data cell with a known 8-neighbour takes the mean of those neighbours.
    Returns the grid and how many cells were closed. A hole that is still open after
    ``max_reach`` steps is wider than 2 * max_reach cells and is left as no data.
    """
    out = filled.copy()
    rows, cols = out.shape
    closed = 0
    for _ in range(max_reach):
        holes = np.isnan(out)
        if not holes.any():
            break
        padded = np.pad(np.where(holes, 0.0, out), 1)
        mask = np.pad((~holes).astype(np.float64), 1)
        total = np.zeros_like(out)
        n = np.zeros_like(out)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                total += padded[1 + dy:1 + dy + rows, 1 + dx:1 + dx + cols]
                n += mask[1 + dy:1 + dy + rows, 1 + dx:1 + dx + cols]
        take = holes & (n > 0)
        if not take.any():
            break
        out[take] = total[take] / n[take]
        closed += int(take.sum())
    return out, closed


def refill(out: Path) -> int:
    """Close the wide holes in an already built grid in place (``--refill``)."""
    meta = json.loads(out.with_suffix(".json").read_text())
    frame = meta["frame"]
    cm = np.frombuffer(out.read_bytes(), dtype=np.int16).reshape(frame["rows"], frame["cols"])
    height = np.where(cm == frame["nodata"], np.nan, frame["base_m"] + cm / 100.0)
    filled, closed = fill_far(height)
    unfilled = int(np.isnan(filled).sum())
    new_cm = np.where(np.isnan(filled), -32768, np.round((filled - frame["base_m"]) * 100.0)).astype(np.int16)
    out.write_bytes(new_cm.tobytes(order="C"))
    meta["cells_filled"] = meta.get("cells_filled", 0) + closed
    meta["cells_no_data"] = unfilled
    meta["cells_filled_far"] = closed
    meta["method"] += (f"; holes still open are grown into from their edge a cell a step, out to "
                       f"{FAR_FILL_REACH} cells, so a block under a wide building has ground")
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"closed {closed} cells; {unfilled} still no data (open water)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "sf-corridor-terrain.bin")
    ap.add_argument("--refill", action="store_true",
                    help="only close the wide holes in the grid already at --out")
    ap.add_argument("--step", type=float, default=STEP_M)
    ap.add_argument("--centrelines", type=Path, default=ROOT / "data/sf_public_works/centrelines.json")
    args = ap.parse_args()
    if args.refill:
        return refill(args.out)

    bbox = SF_CORRIDOR.bbox
    mid_lat = (bbox.south + bbox.north) / 2.0
    mid_lon = (bbox.west + bbox.east) / 2.0
    kx = KY * math.cos(math.radians(mid_lat))
    # The grid frame is the page's: metres east and north of the corridor's middle.
    x0 = (bbox.west - mid_lon) * kx - MARGIN_M
    x1 = (bbox.east - mid_lon) * kx + MARGIN_M
    y0 = (bbox.south - mid_lat) * KY - MARGIN_M
    y1 = (bbox.north - mid_lat) * KY + MARGIN_M
    step = args.step
    cols = math.ceil((x1 - x0) / step)
    rows = math.ceil((y1 - y0) / step)
    print(f"grid {cols} x {rows} at {step} m ({cols * rows / 1e6:.2f} M cells)", flush=True)

    total = np.zeros((rows, cols), dtype=np.float64)
    count = np.zeros((rows, cols), dtype=np.int32)
    # Medians need the values; a running sum does not. The cells are small enough that the
    # mean of the ground returns is within centimetres of their median on a surface, and the
    # kerb step inside a cell is what the residuals below measure.
    holdout: list[np.ndarray] = []
    rng = np.random.default_rng(11)
    reader = EptReader()
    tiles = 0
    tx = x0
    while tx < x1:
        ty = y0
        while ty < y1:
            cx, cy = tx + TILE_M / 2, ty + TILE_M / 2
            lat = mid_lat + cy / KY
            lon = mid_lon + cx / kx
            try:
                cloud = reader.around(lat, lon, TILE_M / 2 + 2.0, resolution_m=RESOLUTION_M).ground()
            except Exception as exc:  # a missing tile is a hole, not a halt
                print(f"  tile at {lat:.4f},{lon:.4f} unavailable: {exc}", flush=True)
                ty += TILE_M
                continue
            tiles += 1
            if len(cloud.east):
                ex = cloud.east + (cloud.origin_lon - mid_lon) * kx
                ny = cloud.north + (cloud.origin_lat - mid_lat) * KY
                keep = (ex >= tx) & (ex < tx + TILE_M) & (ny >= ty) & (ny < ty + TILE_M)
                ex, ny, up = ex[keep], ny[keep], cloud.up[keep]
                held = rng.random(ex.size) < HOLDOUT_SHARE
                if held.any():
                    holdout.append(np.column_stack((ex[held], ny[held], up[held])))
                ex, ny, up = ex[~held], ny[~held], up[~held]
                ci = np.clip(((ex - x0) / step).astype(int), 0, cols - 1)
                ri = np.clip(((ny - y0) / step).astype(int), 0, rows - 1)
                np.add.at(total, (ri, ci), up)
                np.add.at(count, (ri, ci), 1)
            ty += TILE_M
        tx += TILE_M
        print(f"  {tiles} tiles, {int((count > 0).sum())} cells so far", flush=True)

    height = np.full((rows, cols), np.nan, dtype=np.float64)
    known = count >= MIN_CELL_POINTS
    height[known] = total[known] / count[known]
    print(f"{int(known.sum())} cells with ground, {int((~known).sum())} to fill", flush=True)

    # Fill: each empty cell takes the mean of the known cells in a growing window.
    filled = height.copy()
    for reach in range(1, FILL_REACH + 1):
        if not np.isnan(filled).any():
            break
        padded = np.pad(np.where(np.isnan(height), 0.0, height), reach)
        mask = np.pad(known.astype(np.float64), reach)
        window_sum = np.zeros_like(height)
        window_n = np.zeros_like(height)
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                window_sum += padded[reach + dy:reach + dy + rows, reach + dx:reach + dx + cols]
                window_n += mask[reach + dy:reach + dy + rows, reach + dx:reach + dx + cols]
        take = np.isnan(filled) & (window_n > 0)
        filled[take] = window_sum[take] / window_n[take]
    filled, closed_far = fill_far(filled)
    unfilled = int(np.isnan(filled).sum())
    base = float(np.nanmin(filled)) - 1.0
    cm = np.where(np.isnan(filled), -32768, np.round((filled - base) * 100.0)).astype(np.int16)
    args.out.write_bytes(cm.tobytes(order="C"))

    # -- accuracy: the held-out ground returns against the grid -----------------------------
    held = np.concatenate(holdout) if holdout else np.empty((0, 3))

    def sample(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        fx = (xs - x0) / step - 0.5
        fy = (ys - y0) / step - 0.5
        c0 = np.clip(np.floor(fx).astype(int), 0, cols - 2)
        r0 = np.clip(np.floor(fy).astype(int), 0, rows - 2)
        tx_ = np.clip(fx - c0, 0, 1)
        ty_ = np.clip(fy - r0, 0, 1)
        g = filled
        z00, z10 = g[r0, c0], g[r0, c0 + 1]
        z01, z11 = g[r0 + 1, c0], g[r0 + 1, c0 + 1]
        return (z00 * (1 - tx_) * (1 - ty_) + z10 * tx_ * (1 - ty_)
                + z01 * (1 - tx_) * ty_ + z11 * tx_ * ty_)

    report: dict = {"held_out_points": int(held.shape[0])}
    if held.shape[0]:
        predicted = sample(held[:, 0], held[:, 1])
        ok = np.isfinite(predicted)
        residual = predicted[ok] - held[ok, 2]

        def stats(r: np.ndarray) -> dict:
            if r.size == 0:
                return {"n": 0}
            a = np.abs(r)
            return {"n": int(r.size), "rmse_m": round(float(np.sqrt(np.mean(r * r))), 3),
                    "mae_m": round(float(a.mean()), 3), "bias_m": round(float(r.mean()), 3),
                    "median_abs_m": round(float(np.median(a)), 3),
                    "p90_abs_m": round(float(np.quantile(a, 0.9)), 3),
                    "p99_abs_m": round(float(np.quantile(a, 0.99)), 3)}

        report["all"] = stats(residual)
        # On the roadway: within 4 m of a city centreline.
        if args.centrelines.exists():
            lines = json.loads(args.centrelines.read_text())
            segs = []
            for line in lines:
                pts = [((p[0] - mid_lon) * kx, (p[1] - mid_lat) * KY) for p in line["points"]]
                segs += list(itertools.pairwise(pts))
            # A coarse grid of segments, so each held-out point asks a handful.
            cell = 60.0
            grid: dict[tuple[int, int], list] = {}
            for a, b in segs:
                for ix in range(int(min(a[0], b[0]) // cell), int(max(a[0], b[0]) // cell) + 1):
                    for iy in range(int(min(a[1], b[1]) // cell), int(max(a[1], b[1]) // cell) + 1):
                        grid.setdefault((ix, iy), []).append((a, b))
            hx, hy = held[ok, 0], held[ok, 1]
            on_road = np.zeros(hx.size, dtype=bool)
            for i in range(hx.size):
                x, y = hx[i], hy[i]
                for a, b in grid.get((int(x // cell), int(y // cell)), ()):
                    sx, sy = b[0] - a[0], b[1] - a[1]
                    l2 = sx * sx + sy * sy
                    if l2 <= 0:
                        continue
                    t = max(0.0, min(1.0, ((x - a[0]) * sx + (y - a[1]) * sy) / l2))
                    if math.hypot(x - a[0] - sx * t, y - a[1] - sy * t) <= 4.0:
                        on_road[i] = True
                        break
            report["roadway"] = stats(residual[on_road])
            report["off_roadway"] = stats(residual[~on_road])
        # By slope: the grid's own gradient at the point.
        gy, gx = np.gradient(np.nan_to_num(filled, nan=float(np.nanmean(filled))), step)
        slope = np.hypot(gx, gy)
        si = np.clip(((held[ok, 1] - y0) / step).astype(int), 0, rows - 1)
        sj = np.clip(((held[ok, 0] - x0) / step).astype(int), 0, cols - 1)
        s = slope[si, sj]
        report["by_slope"] = {
            "under_5pct": stats(residual[s < 0.05]),
            "5_to_15pct": stats(residual[(s >= 0.05) & (s < 0.15)]),
            "over_15pct": stats(residual[s >= 0.15]),
        }

    meta = {
        "source": "USGS 3DEP CA_SanFrancisco_1_B23 ground returns (class 2), via Entwine",
        "method": f"mean of the ground returns in each {step} m cell; empty cells filled from "
                  f"neighbours out to {FILL_REACH} cells; holes still open are grown into from their "
                  f"edge a cell a step, out to {FAR_FILL_REACH} cells; {HOLDOUT_SHARE:.0%} of returns "
                  "held out and compared with the bilinear grid at their position",
        "sensor_accuracy_note": "USGS states about 0.10 m RMSEz for this collection; the figures "
                                "here are the grid's own error on top of that, measured against "
                                "held-out returns of the same lidar.",
        "frame": {"mid_lon": mid_lon, "mid_lat": mid_lat, "metres_per_lon": kx, "metres_per_lat": KY,
                  "x0": round(x0, 3), "y0": round(y0, 3), "step_m": step, "cols": cols, "rows": rows,
                  "base_m": round(base, 3), "nodata": -32768, "dtype": "int16-le-cm"},
        "cells_with_ground": int(known.sum()), "cells_filled": int((~known).sum() - unfilled),
        "cells_no_data": unfilled, "cells_filled_far": closed_far, "tiles": tiles,
        "height_range_m": [round(float(np.nanmin(filled)), 2), round(float(np.nanmax(filled)), 2)],
        "accuracy": report,
    }
    args.out.with_suffix(".json").write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps(report, indent=1))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB) and {args.out.with_suffix('.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
