#!/usr/bin/env python3
"""Fit the facade catalogue to walls somebody has looked at.

The catalogue in smc.facades.match places each render in fingerprint space by a prototype.
Written from what a render looks like, the prototypes called 3% of the corridor's houses
stucco. This fits them to labelled walls instead:

    sheets   pick a stratified sample of fingerprinted buildings, re-rectify the wall each
             fingerprint was read from, and lay the patches out on numbered contact sheets
             (build/facade-labels/sheet-NN.jpg) with an index of which building is which;
    fit      read the labels (data/sf_public_works/facade_labels.json: index -> material),
             set each render's prototype to the median fingerprint of its labelled walls,
             score the fit leave-one-out, and print the catalogue to paste into match.py.

The labels file records who labelled and from what, so a match traced back lands on a
photograph a person looked at.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import build_facades as facades  # noqa: E402
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.facades.geometry import Camera, LocalFrame, walls_of  # noqa: E402
from smc.facades.match import CATALOGUE, WEIGHTS, Fingerprint, closest_render  # noqa: E402
from smc.facades.rectify import rectify_wall  # noqa: E402

MAP_JSON = ROOT / "docs" / "sf-corridor-3d.json"
CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
FINGERPRINTS = ROOT / "data" / "sf_public_works" / "facade_fingerprints.json"
LABELS = ROOT / "data" / "sf_public_works" / "facade_labels.json"
SHEETS = ROOT / "build" / "facade-labels"
MATERIALS = ("stucco", "painted", "concrete", "brick", "glass", "metal")
#: What the fingerprint can tell apart. Paint is a colour, not a texture: a painted wall is
#: fitted as stucco and the sampled colour carries the paint.
FIT_CLASSES = ("stucco", "concrete", "brick", "glass", "metal")
MERGE = {"painted": "stucco"}
PATCH_W, PATCH_H = 300, 220
COLUMNS, ROWS = 4, 3


def sheets(count: int, seed: int) -> int:
    payload = json.loads(MAP_JSON.read_text())
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0)
    buildings = {str(w["osm_id"]): (i, w) for i, w in enumerate(payload["ways"])
                 if w.get("kind") == "building" and w.get("osm_id") is not None}
    fingerprints = json.loads(FINGERPRINTS.read_text())["buildings"]
    # Stratified by what the catalogue currently says and by height, so the sample is not
    # all of whatever the biased match favours.
    rng = random.Random(seed)
    # Walls already labelled are not sampled again; the labels accumulate across rounds.
    labelled = set()
    if LABELS.exists():
        labelled = {w["osm_id"] for w in json.loads(LABELS.read_text()).get("walls", {}).values()}
    strata: dict[tuple[str, str], list[str]] = defaultdict(list)
    for key, fp in fingerprints.items():
        if key not in buildings or not fp.get("frames") or key in labelled:
            continue
        height = float(buildings[key][1].get("height_m") or 10)
        band = "tall" if height > 25 else "mid" if height > 12 else "low"
        strata[(closest_render(Fingerprint.from_json(fp)).material, band)].append(key)
    chosen: list[str] = []
    keys = sorted(strata)
    per = max(1, count // max(1, len(keys)))
    for stratum in keys:
        pool = strata[stratum]
        rng.shuffle(pool)
        chosen.extend(pool[:per])
    while len(chosen) < count:
        extra = rng.choice(list(fingerprints))
        if extra in buildings and extra not in chosen:
            chosen.append(extra)
    chosen = chosen[:count]

    rows = pq.read_table(CATALOG, columns=[
        "provider", "provider_sequence_id", "provider_image_id", "latitude", "longitude",
        "heading_deg", "horizontal_fov", "projection_type", "original_width", "original_height",
        "eligible", "estimated_camera_height"]).to_pydict()
    by_image = {str(rows["provider_image_id"][i]): i for i in range(len(rows["provider"]))}

    SHEETS.mkdir(parents=True, exist_ok=True)
    for old in SHEETS.glob("sheet-*.jpg"):
        old.unlink()
    index: list[dict] = []
    patches: list[np.ndarray] = []
    for key in chosen:
        fp = fingerprints[key]
        i_way, way = buildings[key]
        ring = [frame.to_xy(lon, lat) for lon, lat in way["points"]]
        walls = {w.wall_index: w for w in walls_of(ring, float(way.get("height_m") or 10.5), i_way)}
        patch = None
        for fr in fp["frames"]:
            i = by_image.get(str(fr["i"]))
            wall = walls.get(fr["w"])
            if i is None or wall is None:
                continue
            camera = facades.camera_for(rows, i, frame)
            image = facades.fetch_image(rows["provider"][i], rows["provider_sequence_id"][i], rows["provider_image_id"][i])
            if camera is None or image is None:
                continue
            h, w = image.shape[:2]
            if (w, h) != (camera.width, camera.height):
                camera = Camera(camera.x, camera.y, camera.z, camera.yaw_rad, w, h, camera.spherical, camera.hfov_rad)
            view = rectify_wall(image, camera, wall, pixels_per_m=8.0)
            if view is None or view.mask.sum() < 400:
                continue
            img = view.image.copy()
            img[~view.mask.astype(bool)] = (30, 30, 30)
            patch = img
            break
        if patch is None:
            continue
        scale = min(PATCH_W / patch.shape[1], PATCH_H / patch.shape[0])
        patch = cv2.resize(patch, (max(1, int(patch.shape[1] * scale)), max(1, int(patch.shape[0] * scale))))
        canvas = np.full((PATCH_H, PATCH_W, 3), 18, dtype=np.uint8)
        canvas[:patch.shape[0], :patch.shape[1]] = patch
        label = f"#{len(index)} {closest_render(Fingerprint.from_json(fp)).material[:4]} {way.get('height_m', 0):.0f}m"
        cv2.putText(canvas, label, (4, PATCH_H - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
        patches.append(canvas)
        index.append({"n": len(index), "osm_id": key, "guess": closest_render(Fingerprint.from_json(fp)).material,
                      "height_m": way.get("height_m"), "archetype": way.get("archetype"),
                      "frame": fp["frames"][0]})
    per_sheet = COLUMNS * ROWS
    for s in range(0, len(patches), per_sheet):
        cells = patches[s:s + per_sheet]
        while len(cells) < per_sheet:
            cells.append(np.full((PATCH_H, PATCH_W, 3), 18, dtype=np.uint8))
        grid = np.vstack([np.hstack(cells[r * COLUMNS:(r + 1) * COLUMNS]) for r in range(ROWS)])
        cv2.imwrite(str(SHEETS / f"sheet-{s // per_sheet:02d}.jpg"), grid, [cv2.IMWRITE_JPEG_QUALITY, 82])
    (SHEETS / "index.json").write_text(json.dumps(index, indent=1))
    print(f"{len(index)} walls on {(len(patches) + per_sheet - 1) // per_sheet} sheets under {SHEETS}")
    return 0


def fit() -> int:
    labels = json.loads(LABELS.read_text())
    fingerprints = json.loads(FINGERPRINTS.read_text())["buildings"]
    samples: list[tuple[str, Fingerprint]] = []
    skipped = Counter()
    for wall in labels.get("walls", {}).values():
        material = wall.get("label")
        if material not in MATERIALS:
            skipped[material] += 1
            continue
        if wall["osm_id"] not in fingerprints:
            skipped["no fingerprint yet"] += 1
            continue
        samples.append((MERGE.get(material, material), Fingerprint.from_json(fingerprints[wall["osm_id"]])))
    print(f"labelled walls not used: {dict(skipped)}")
    counts = Counter(m for m, _ in samples)
    print(f"{len(samples)} labelled walls: {dict(counts)}")

    def prototypes(rows: list[tuple[str, Fingerprint]]) -> list[dict]:
        out = []
        for material in FIT_CLASSES:
            fps = [fp for m, fp in rows if m == material]
            base = next(e for e in CATALOGUE if e["material"] == material)
            if len(fps) < 2:
                out.append(base)
                continue
            hues = np.radians([fp.hue for fp in fps if fp.saturation >= 0.12])
            hue = float(np.degrees(np.arctan2(np.sin(hues).mean(), np.cos(hues).mean())) % 360) if len(hues) >= 2 else None
            out.append({"material": material, "hue": hue if material in ("brick", "stucco") else base["hue"],
                        "proto": {"glazing": statistics.median(fp.glazing for fp in fps),
                                  "texture": statistics.median(fp.texture for fp in fps),
                                  "saturation": statistics.median(fp.saturation for fp in fps),
                                  "lightness": statistics.median(fp.lightness for fp in fps),
                                  "sd": statistics.median(fp.sd for fp in fps)}})
        return out

    # Leave-one-out: fit on all but one, match the one.
    right = 0
    confusion: Counter[tuple[str, str]] = Counter()
    for k in range(len(samples)):
        held, rest = samples[k], samples[:k] + samples[k + 1:]
        guess = closest_render(held[1], prototypes(rest)).material
        confusion[(held[0], guess)] += 1
        right += guess == held[0]
    before = sum(closest_render(fp).material == m for m, fp in samples)
    print(f"leave-one-out: {right}/{len(samples)} right with fitted prototypes; "
          f"{before}/{len(samples)} with the unfitted catalogue")
    for (truth, guess), n in sorted(confusion.items()):
        if truth != guess:
            print(f"  {truth:9s} -> {guess:9s} {n}")
    fitted = prototypes(samples)
    print("\nCATALOGUE = [")
    for e in fitted:
        p = e["proto"]
        print(f'    {{"material": "{e["material"]}", "proto": {{"glazing": {p["glazing"]:.3f}, "texture": {p["texture"]:.3f}, '
              f'"saturation": {p["saturation"]:.3f},\n'
              f'{" " * 34}"lightness": {p["lightness"]:.3f}, "sd": {p["sd"]:.3f}}}, "hue": {e["hue"] if e["hue"] is None else round(e["hue"], 1)}}},')
    print("]")
    print(f"weights in use: {WEIGHTS}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    s = sub.add_parser("sheets")
    s.add_argument("--count", type=int, default=72)
    s.add_argument("--seed", type=int, default=7)
    sub.add_parser("fit")
    args = ap.parse_args()
    return sheets(args.count, args.seed) if args.command == "sheets" else fit()


if __name__ == "__main__":
    raise SystemExit(main())
