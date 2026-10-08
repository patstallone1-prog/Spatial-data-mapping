"""Fill the ground nothing describes from what surrounds it.

The page draws streets, footways, buildings, yards, parks and plazas; whatever lies between them
is bare terrain -- the slivers behind a row of houses, the strip between a kerb and a frontage
the parcel data stops short of, the corner of a lot. Those are "unmeasured" ground: no record
says what is there. This reads a top-down class image of the rendered world (every surface
drawn in a flat colour, bare terrain in its own; made in the page by the headless capture) and
gives each bare cell the surface that is nearest it, by these rules:

  next to a footway, a plaza, a kerb   paving
  next to a lawn, a yard, a park       grass
  next to a service yard               the neutral hardscape
  next to a building                   what lies beyond the building's wall: paving toward a
                                       street or a footway, grass toward a garden
  next to the road only                asphalt, within a few metres; paving where a footway is
                                       close behind it (the strip between kerb and frontage)

The fills are written as rings into the ground files under ``inferred``, each tagged with what
it was inferred as. They are drawn under every mapped surface, so a fill never hides a record:
it only covers the terrain that showed through.

    node tools/ground_capture/capture.mjs URL CAPTURE_DIR     # headless Chrome on :9333
    .venv/bin/python tools/infer_ground_gaps.py [--append] CAPTURE_DIR GROUND.json [...]

prints the share of the land left unmeasured and writes the fills; run the capture again on the
page with the fills drawn, and ``--append`` a second pass for what the first left (a fill a
mask clipped). The older form takes the class image as a .npy with its frame and bounds:

    .venv/bin/python tools/infer_ground_gaps.py MOSAIC.npy FRAME.json "W E N S" GROUND.json [...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

CLASSES = ["none", "bare", "road", "paving", "grass", "building", "water", "service", "outside",
           "other", "structure"]
C = {name: i for i, name in enumerate(CLASSES)}
PX_PER_M = 2
#: A road-side gap is asphalt within this distance of the road and with no footway nearer.
ROAD_GAP_M = 4.0
#: A footway this close behind a road-side gap makes the gap pavement, not road.
FOOTWAY_BEHIND_M = 6.0
#: A patch this much of whose edge is road is road.
ROAD_RINGED_SHARE = 0.6
#: A patch this large is open land, whatever its edges are.
OPEN_LAND_M2 = 1000.0
#: Smaller fills than this are not worth a ring: a quarter of a square metre.
MIN_AREA_PX = 1
FILL_KINDS = ["paving", "grass", "asphalt", "service"]


def nearest(classes: np.ndarray, sources: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """For every pixel, the class of the nearest source pixel and the distance to it (px)."""
    free = np.where(sources, 0, 255).astype(np.uint8)
    dist, labels = cv2.distanceTransformWithLabels(free, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(sources)
    lookup = np.zeros(labels.max() + 1, np.uint8)
    # The label of a source pixel is its own index in scan order of the zero pixels.
    zero_labels = labels[ys, xs]
    lookup[zero_labels] = classes[ys, xs]
    return lookup[labels], dist


def infer(mosaic: np.ndarray) -> tuple[np.ndarray, dict]:
    bare = (mosaic == C["bare"]) | (mosaic == C["none"])
    described = ~bare & (mosaic != C["water"]) & (mosaic != C["outside"])
    classes = mosaic.copy()
    classes[(classes == C["other"]) | (classes == C["structure"])] = C["paving"]
    near_all, d_all = nearest(classes, described)
    no_building = described & (classes != C["building"])
    near_open, d_open = nearest(classes, no_building)
    no_road = no_building & (classes != C["road"])
    near_side, d_side = nearest(classes, no_road)

    fill = np.zeros(mosaic.shape, np.uint8)          # 0 nothing, else 1 + index in FILL_KINDS
    kind = {name: 1 + i for i, name in enumerate(FILL_KINDS)}

    def by_open(target: np.ndarray, beyond: np.ndarray, beyond_d: np.ndarray) -> None:
        # What a building-side or road-side gap opens onto.
        fill[target & (beyond == C["grass"])] = kind["grass"]
        fill[target & (beyond == C["service"])] = kind["service"]
        fill[target & ((beyond == C["paving"]) | (beyond == C["road"]))] = kind["paving"]

    paving = bare & (near_all == C["paving"])
    fill[paving] = kind["paving"]
    fill[bare & (near_all == C["grass"])] = kind["grass"]
    fill[bare & (near_all == C["service"])] = kind["service"]
    by_open(bare & (near_all == C["building"]), near_open, d_open)
    road = bare & (near_all == C["road"])
    footway_behind = (near_side == C["paving"]) & (d_side <= FOOTWAY_BEHIND_M * PX_PER_M)
    fill[road & footway_behind] = kind["paving"]
    fill[road & ~footway_behind & (near_side == C["grass"]) & (d_side <= FOOTWAY_BEHIND_M * PX_PER_M)] = kind["grass"]
    rest = road & (fill == 0)
    fill[rest & (d_all <= ROAD_GAP_M * PX_PER_M)] = kind["asphalt"]
    fill[rest & (d_all > ROAD_GAP_M * PX_PER_M)] = kind["service"]
    fill[bare & (fill == 0)] = kind["service"]
    # A patch the road rings almost all round -- a hole in a parking lot, an island of nothing
    # in a junction -- is road surface whatever footway lies a few metres off.
    count, labels = cv2.connectedComponents(bare.astype(np.uint8), connectivity=8)
    if count > 1:
        grown = cv2.dilate(labels.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
        ring = (~bare) & (grown > 0)
        owner = grown[ring].astype(np.int64)
        cls = classes[ring]
        total = np.bincount(owner, minlength=count)
        roadside = np.bincount(owner, weights=(cls == C["road"]).astype(np.float64), minlength=count)
        road_ringed = np.zeros(count, bool)
        road_ringed[1:] = (total[1:] > 0) & (roadside[1:] >= ROAD_RINGED_SHARE * total[1:])
        # A stretch of open ground -- a wooded hillside, a reserve, a vacant lot -- with only
        # footpaths across it is the ground between the paths, not more path: it is green.
        area = np.bincount(labels.ravel(), minlength=count)
        open_land = np.zeros(count, bool)
        open_land[1:] = area[1:] >= OPEN_LAND_M2 * PX_PER_M ** 2
        fill[bare & open_land[labels] & ~road_ringed[labels]] = kind["grass"]
        fill[bare & road_ringed[labels]] = kind["asphalt"]
    counts = {name: int((fill == kind[name]).sum()) for name in FILL_KINDS}
    return fill, counts


def rings(fill: np.ndarray, frame: dict, west: float, south_z: float) -> list[dict]:
    """The fills as lon/lat rings, each grown half a metre so it tucks under its neighbours."""
    out = []
    grow = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    for index, name in enumerate(FILL_KINDS, start=1):
        mask = cv2.dilate((fill == index).astype(np.uint8), grow)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) < MIN_AREA_PX and len(contour) < 4:
                continue
            simple = cv2.approxPolyDP(contour, 1.0, True).reshape(-1, 2)
            if len(simple) < 3:
                x, y, w, h = cv2.boundingRect(contour)
                simple = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
            ring = []
            for col, row in simple:
                x = west + col / PX_PER_M
                z = south_z + row / PX_PER_M
                ring.append([round(frame["midLon"] + x / frame["mPerLon"], 6),
                             round(frame["midLat"] - z / frame["mPerLat"], 6)])
            ring.append(ring[0])
            out.append({"k": name, "p": ring})
    return out


def main() -> None:
    args = sys.argv[1:]
    # --append: a further pass over a capture made with the first pass's fills drawn, adding
    # to them what they left (where a fill was clipped or a mask discarded it).
    append = "--append" in args
    args = [a for a in args if a != "--append"]
    if Path(args[0]).is_dir():
        # A capture from tools/ground_capture/capture.mjs: classes.bin and meta.json.
        capture, *grounds = args
        meta = json.loads((Path(capture) / "meta.json").read_text())
        mosaic = np.fromfile(Path(capture) / "classes.bin", np.uint8).reshape(meta["height"], meta["width"])
        frame, west, north_edge_z = meta["frame"], float(meta["west"]), float(meta["north"])
        bare = np.isin(mosaic, [C["bare"], C["none"]]).sum()
        land = (~np.isin(mosaic, [C["water"], C["outside"]])).sum()
        print(json.dumps({"unmeasured_share_of_land": round(float(bare / max(land, 1)), 4),
                          "unmeasured_m2": float(bare) / PX_PER_M ** 2}))
    else:
        mosaic_path, frame_path, bounds, *grounds = args
        mosaic = np.load(mosaic_path)
        frame = json.loads(Path(frame_path).read_text())
        west, _east, north_edge_z, _south_edge_z = (float(v) for v in bounds.split())
    fill, counts = infer(mosaic)
    found = rings(fill, frame, west, north_edge_z)
    print(json.dumps({"inferred_m2": {k: v / PX_PER_M ** 2 for k, v in counts.items()}, "rings": len(found)}))
    for ground_path in grounds:
        path = Path(ground_path)
        ground = json.loads(path.read_text())
        ground["inferred"] = (ground.get("inferred", []) if append else []) + found
        path.write_text(json.dumps(ground, separators=(",", ":")))
        print(f"{path}: {len(ground['inferred'])} inferred rings")


if __name__ == "__main__":
    main()
