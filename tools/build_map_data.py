"""Assemble the self-contained dataset the web map ships with.

An Artifact runs under a strict CSP: no CDN scripts, no tile servers, no fetch. So the map
cannot stream tiles — the geometry has to travel inside the page. That is a real constraint and
it shapes the product honestly: what ships is a vector street network plus whatever coverage
exists, quantised hard enough to stay small.

Everything here is real. Streets and footways come from OpenStreetMap via Overpass (ODbL,
reference use only — see docs/01-dependency-stack.md 0.2). Existing street-level coverage comes
from Panoramax. Nothing is invented for the demo.
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.adapters.free import BoundingBox, OverpassClient  # noqa: E402
from smc.adapters.panoramax import PanoramaxImagery  # noqa: E402
from smc.ingest.photos import discover_photos, load_photo  # noqa: E402

CENTRE = (37.7764, -122.4325)  # Alamo Square, San Francisco
RADIUS_M = 420.0
#: Five decimals is about a metre — finer than any claim this map makes, and it halves the file.
PRECISION = 5


def road_query(bbox: BoundingBox) -> str:
    area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    return (
        "[out:json][timeout:60];("
        f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|'
        f'unclassified|service|living_street)$"]({area});'
        ");out geom;"
    )


def simplify(points: list[list[float]], tolerance: float = 1.2e-5) -> list[list[float]]:
    """Drop collinear vertices. Straight city blocks carry a lot of redundant nodes."""
    if len(points) <= 2:
        return points
    kept = [points[0]]
    for previous, current, following in zip(points, points[1:], points[2:], strict=False):
        cross = abs(
            (current[0] - previous[0]) * (following[1] - previous[1])
            - (current[1] - previous[1]) * (following[0] - previous[0])
        )
        if cross > tolerance:
            kept.append(current)
    kept.append(points[-1])
    return kept


def ways_from(payload: dict, classify) -> list[dict]:
    out = []
    for element in payload.get("elements", []):
        if element.get("type") != "way" or not element.get("geometry"):
            continue
        kind = classify(element.get("tags", {}))
        if kind is None:
            continue
        line = simplify(
            [[round(p["lon"], PRECISION), round(p["lat"], PRECISION)] for p in element["geometry"]]
        )
        if len(line) >= 2:
            out.append({"k": kind, "g": line})
    return out


def thumbnails(directory: Path, count: int = 10, width: int = 220) -> list[dict]:
    """Small JPEGs of the capture session, inlined as data URIs."""
    from PIL import Image

    files = discover_photos(directory)
    if not files:
        return []
    step = max(1, len(files) // count)
    out = []
    for path in files[::step][:count]:
        image, meta = load_photo(path, max_width=width)
        buffer = io.BytesIO()
        Image.fromarray(image).save(buffer, "JPEG", quality=62)
        out.append(
            {
                "n": path.stem,
                "t": meta.captured_at.strftime("%H:%M:%S") if meta.captured_at else "",
                "src": "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode(),
            }
        )
    return out


def main() -> int:
    bbox = BoundingBox.around(*CENTRE, RADIUS_M)
    overpass = OverpassClient()

    roads = ways_from(
        overpass._get(f"{overpass.PUBLIC_ENDPOINT}?data={road_query(bbox)}")  # noqa: SLF001
        if False
        else _fetch(overpass, road_query(bbox)),
        lambda tags: "road" if tags.get("highway") else None,
    )
    pedestrian = ways_from(
        _fetch(overpass, overpass.pedestrian_query(bbox)),
        lambda tags: (
            "crossing"
            if tags.get("footway") == "crossing"
            else ("sidewalk" if tags.get("footway") == "sidewalk" or tags.get("highway") == "footway" else None)
        ),
    )

    panoramax = PanoramaxImagery()
    captures = [
        {
            "lon": round(image.lon, PRECISION),
            "lat": round(image.lat, PRECISION),
            "h": image.heading_deg,
            "d": image.captured_at.date().isoformat() if image.captured_at else None,
        }
        for image in panoramax.nearby(*CENTRE, radius_m=RADIUS_M, limit=300)
    ]

    photos = thumbnails(Path("photos/vantage"))

    data = {
        "centre": {"lat": CENTRE[0], "lon": CENTRE[1]},
        "bbox": [bbox.west, bbox.south, bbox.east, bbox.north],
        "roads": roads,
        "pedestrian": pedestrian,
        "coverage": captures,
        "session": {
            "frames": len(discover_photos(Path("photos/vantage"))),
            "photos": photos,
        },
    }
    out = Path("build/map_data.json")
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"roads {len(roads)}, pedestrian {len(pedestrian)}, coverage {len(captures)}")
    print(f"thumbnails {len(photos)}")
    print(f"{out}: {out.stat().st_size / 1e6:.2f} MB")
    return 0


def _fetch(client: OverpassClient, query: str) -> dict:
    import urllib.parse

    from smc.adapters.free import _get

    client._throttle()  # noqa: SLF001
    return _get(f"{client.PUBLIC_ENDPOINT}?{urllib.parse.urlencode({'data': query})}")


if __name__ == "__main__":
    raise SystemExit(main())
