"""The buildings of the landscape: every mapped building outside the built regions' own.

The landscape (docs/nature-runtime.mjs) lays the Bay Area's ground, plants, trails and roads
beyond the regions the viewer builds street by street. It had no buildings: a town in the
hills (Sausalito, Mill Valley, Tiburon) showed as streets on bare ground. This writes every
OpenStreetMap building in the landscape's frame as a footprint and a height, for the runtime
to raise as a plain house or block where no region draws its own.

Heights are the mapped ``height`` or ``building:levels`` where tagged, else inferred from the
building's kind and size (a house about 6.5 m, a garage 3 m), and marked so in the manifest.

Buildings inside a built region (docs/app-regions.json) are left out: the region draws its own.

Output: ``docs/nature/buildings/<col>-<row>.bin`` (the paths' 4 km tiles), gzip of
``KBLD`` records -- per building a point count, a kind, a height in decimetres, a roof hint,
its first corner in eighths of a metre from 50 m outside the tile's corner and the rest as
steps from the one before -- and ``docs/nature/buildings.json``, the manifest.

    PYTHONPATH=src .venv/bin/python scripts/build_nature_buildings.py --pbf norcal-latest.osm.pbf
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import struct
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TILE_M = 4000
QUANT = 8  # eighths of a metre
PAD_M = 50  # a building over the tile's edge stays whole in its centre's tile
MAGIC = b"KBL2"

#: The kinds the runtime colours and shapes: code, and the tags that make it.
KINDS = {
    "house": (1, {"house", "detached", "semidetached_house", "bungalow", "cabin", "farm", "terrace", "houseboat", "static_caravan"}),
    "apartments": (2, {"apartments", "residential", "dormitory"}),
    "commercial": (3, {"commercial", "retail", "office", "supermarket", "kiosk", "hotel"}),
    "industrial": (4, {"industrial", "warehouse", "manufacture", "hangar", "storage_tank"}),
    "outbuilding": (5, {"garage", "garages", "shed", "carport", "barn", "greenhouse", "hut", "roof", "boathouse", "farm_auxiliary"}),
    "civic": (6, {"school", "church", "public", "civic", "hospital", "university", "college", "government", "fire_station", "chapel", "temple"}),
}
CODE = {tag: code for code, tags in KINDS.values() for tag in tags}


def ring_area(ring: list[tuple[float, float]]) -> float:
    return abs(sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1], strict=True))) / 2


def simplify(ring: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on a closed ring (first point kept)."""
    if len(ring) <= 4:
        return ring

    def dp(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        (ax, ay), (bx, by) = points[0], points[-1]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1e-9
        best, index = -1.0, 0
        for i in range(1, len(points) - 1):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / length
            if d > best:
                best, index = d, i
        if best <= tolerance:
            return [points[0], points[-1]]
        return dp(points[: index + 1])[:-1] + dp(points[index:])

    far = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
    out = dp(ring[: far + 1])[:-1] + dp(ring[far:] + [ring[0]])[:-1]
    return out if len(out) >= 3 else ring


def parse_metres(value: str | None) -> float | None:
    if not value:
        return None
    try:
        text = value.lower().replace("m", "").strip()
        if "'" in text:
            feet = float(text.split("'")[0])
            return feet * 0.3048
        return float(text.split()[0].replace(",", "."))
    except (ValueError, IndexError):
        return None


def height_of(tags: dict, kind: str, area: float) -> tuple[float, bool]:
    """The building's height in metres, and whether it was mapped (not inferred)."""
    mapped = parse_metres(tags.get("height"))
    if mapped and 2 <= mapped <= 300:
        return mapped, True
    levels = parse_metres(tags.get("building:levels"))
    if levels and 1 <= levels <= 80:
        roof = 2.0 if CODE.get(kind) in (1, None) and levels <= 3 else 0.5
        return levels * 3.1 + roof, True
    code = CODE.get(kind)
    if code == 5:
        return 3.2, False
    if code == 1:
        return 6.5 if area < 220 else 7.5, False
    if code == 2:
        return 7.0 if area < 250 else 10.5, False
    if code == 4:
        return 8.0, False
    if code == 6:
        return 9.0, False
    if code == 3:
        return 5.5 if area < 400 else 8.0, False
    # Untagged ("yes"): by size, as the city's own buildings go.
    return (3.2 if area < 40 else 6.5 if area < 220 else 8.0 if area < 900 else 11.0), False


def extract(pbf: Path, frame: dict) -> list[dict]:
    import osmium

    b = frame["bbox"]

    class Buildings(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()
            self.found: list[dict] = []

        def way(self, way) -> None:
            tags = way.tags
            kind = tags.get("building")
            if not kind or kind == "no" or tags.get("location") == "underground":
                return
            if not way.is_closed() or len(way.nodes) < 4:
                return
            try:
                points = [(n.lon, n.lat) for n in way.nodes]
            except osmium.InvalidLocationError:
                return
            lon = sum(p[0] for p in points) / len(points)
            lat = sum(p[1] for p in points) / len(points)
            if not (b["west"] <= lon <= b["east"] and b["south"] <= lat <= b["north"]):
                return
            self.found.append({"id": way.id, "kind": kind, "points": points[:-1],
                               "tags": {k: tags.get(k) for k in ("height", "building:levels", "roof:shape") if tags.get(k)}})

    handler = Buildings()
    work = ROOT / "build" / "nature"
    work.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="osm-index-", dir=work) as tmp:
        handler.apply_file(str(pbf), locations=True, idx=f"sparse_file_array,{tmp}/nodes.idx")
    return handler.found


def varint(out: bytearray, value: int) -> None:
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return


def zigzag(value: int) -> int:
    return value * 2 if value >= 0 else -value * 2 - 1


def encode(records: list[tuple[int, int, int, int, list[tuple[int, int]]]]) -> bytes:
    """KBL2: u32 count; per building varint points, u8 kind, varint height (dm), u8 roof,
    u16 x and y of the first corner, then zigzag varint steps to each next corner."""
    out = bytearray(MAGIC + struct.pack("<I", len(records)))
    for kind, height_dm, roof, _, ring in records:
        varint(out, len(ring))
        out.append(kind)
        varint(out, height_dm)
        out.append(roof)
        out += struct.pack("<HH", *ring[0])
        for (ax, ay), (bx, by) in zip(ring, ring[1:], strict=False):
            varint(out, zigzag(bx - ax))
            varint(out, zigzag(by - ay))
    return bytes(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbf", type=Path, required=True)
    parser.add_argument("--cache", type=Path, help="reuse an extracted buildings list (JSON)")
    args = parser.parse_args()
    frame = json.loads((ROOT / "docs/nature/paths.json").read_text())["frame"]
    if args.cache and args.cache.exists():
        found = json.loads(args.cache.read_text())
    else:
        found = extract(args.pbf, frame)
        if args.cache:
            args.cache.write_text(json.dumps(found, separators=(",", ":")))
    print(f"{len(found)} buildings in the frame", flush=True)
    regions = [r["bbox"] for r in json.loads((ROOT / "docs/app-regions.json").read_text())["regions"] if r.get("bbox")]
    skipped = 0
    tiles: dict[str, list] = {}
    inferred = mapped = 0
    for item in found:
        lon = sum(p[0] for p in item["points"]) / len(item["points"])
        lat = sum(p[1] for p in item["points"]) / len(item["points"])
        if any(s <= lat <= n and w <= lon <= e for s, w, n, e in regions):
            skipped += 1
            continue
        ring = [((lon - frame["mid_lon"]) * frame["metres_per_lon"] - frame["x0"],
                 (lat - frame["mid_lat"]) * frame["metres_per_lat"] - frame["y0"]) for lon, lat in item["points"]]
        area = ring_area(ring)
        if area < 8:
            continue
        ring = simplify(ring, 0.35)
        if len(ring) > 255:
            ring = ring[:: math.ceil(len(ring) / 255)]
        cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
        col, row = math.floor(cx / TILE_M), math.floor(cy / TILE_M)
        ox, oy = col * TILE_M, row * TILE_M
        # A building over the tile's edge is kept whole in its centre's tile (clamped a little).
        local = [(min(65535, max(0, round((x - ox + PAD_M) * QUANT))), min(65535, max(0, round((y - oy + PAD_M) * QUANT)))) for x, y in ring]
        height, was_mapped = height_of(item["tags"], item["kind"], area)
        mapped += was_mapped
        inferred += not was_mapped
        shape = item["tags"].get("roof:shape", "")
        roof = 2 if shape == "flat" else 1 if shape in {"gabled", "hipped", "pyramidal", "gambrel", "half-hipped"} else 0
        tiles.setdefault(f"{col}-{row}", []).append((CODE.get(item["kind"], 0), min(65535, round(height * 10)), roof, item["id"], local))
    out = ROOT / "docs/nature/buildings"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.bin"):
        old.unlink()
    assets, total = {}, 0
    for key, records in sorted(tiles.items()):
        records.sort(key=lambda r: r[3])
        raw = encode(records)
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        (out / f"{key}.bin").write_bytes(packed)
        assets[key] = {"file": f"buildings/{key}.bin", "sha256": hashlib.sha256(packed).hexdigest(), "encoding": "gzip",
                       "decoded_bytes": len(raw), "bytes": len(packed), "buildings": len(records)}
        total += len(records)
    manifest = {
        "schema": 1,
        "frame": frame,
        "tile_m": TILE_M,
        "format": "KBL2: u32 count; per building varint points, u8 kind, varint height (dm), u8 roof (0 by shape, 1 pitched, 2 flat), "
                  "u16 x, y of the first corner ((metres from the tile's corner) + 50) * 8, then zigzag varint steps (eighths of a metre)",
        "left_out": {"inside_built_regions": skipped, "basis": "docs/app-regions.json bboxes: those regions draw their own buildings"},
        "kinds": {name: code for name, (code, _) in KINDS.items()},
        "buildings": total,
        "heights": {"mapped": mapped, "inferred": inferred,
                    "inferred_basis": "OSM building kind and footprint area (a house 6.5 m, a garage 3.2 m, a block of flats 10.5 m)"},
        "tiles": assets,
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL-1.0",
        "source": "https://www.openstreetmap.org/copyright",
        "extract": {"provider": "Geofabrik Northern California", "url": "https://download.geofabrik.de/north-america/us/california/norcal.html",
                    "sha256": hashlib.file_digest(args.pbf.open("rb"), "sha256").hexdigest()},
        "role": "Mapped footprints, heights mostly inferred: the landscape's towns beyond the built regions, not survey truth",
    }
    (ROOT / "docs/nature/buildings.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{total} buildings in {len(assets)} tiles, {sum(a['bytes'] for a in assets.values()) / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
