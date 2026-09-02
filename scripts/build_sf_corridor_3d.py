#!/usr/bin/env python3
"""Build an interactive 3D SF corridor map from the metadata catalog."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import h3
import pyarrow.parquet as pq

from smc.imagery.region import SF_CORRIDOR, BBox

PRECISION = 6


def overpass_query(bbox: BBox) -> str:
    area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    return (
        "[out:json][timeout:60];("
        f'way["highway"~"^(primary|secondary|tertiary|residential|service|living_street|footway|pedestrian)$"]({area});'
        f'way["footway"~"^(sidewalk|crossing)$"]({area});'
        f'way["building"]({area});'
        ");out geom;"
    )


def _float_text(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace(",", ".")
    if not text:
        return None
    if text.endswith("ft"):
        try:
            return float(text[:-2].strip()) * 0.3048
        except ValueError:
            return None
    if text.endswith("m"):
        text = text[:-1].strip()
    try:
        return float(text)
    except ValueError:
        return None


def _building_height(tags: dict[str, Any]) -> tuple[float, str]:
    height = _float_text(tags.get("height"))
    if height is not None and 2.0 <= height <= 300.0:
        return height, "osm_height"
    levels = _float_text(tags.get("building:levels"))
    if levels is not None and 1.0 <= levels <= 90.0:
        return max(3.2, levels * 3.2), "osm_levels"
    return 10.5, "inferred_default"


def _is_closed(points: list[list[float]]) -> bool:
    return len(points) >= 4 and points[0] == points[-1]


def _centroid(points: list[list[float]]) -> list[float]:
    ring = points[:-1] if _is_closed(points) else points
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return [round(lon, PRECISION), round(lat, PRECISION)]


def fetch_osm(bbox: BBox) -> list[dict[str, Any]]:
    url = "https://overpass-api.de/api/interpreter?" + urllib.parse.urlencode(
        {"data": overpass_query(bbox)}
    )
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Kerbside/0.1 SF corridor 3D viewer"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        data = json.loads(response.read().decode("utf-8"))
    ways = []
    for element in data.get("elements", []):
        geometry = element.get("geometry") or []
        tags = element.get("tags") or {}
        if not geometry:
            continue
        points = [
            [round(p["lon"], PRECISION), round(p["lat"], PRECISION)]
            for p in geometry
            if "lat" in p and "lon" in p
        ]
        if len(points) < 2:
            continue
        if tags.get("building") and _is_closed(points):
            height, height_source = _building_height(tags)
            ways.append(
                {
                    "kind": "building",
                    "name": tags.get("name"),
                    "height_m": round(height, 2),
                    "height_source": height_source,
                    "centroid": _centroid(points),
                    "points": points,
                }
            )
            continue
        kind = (
            "sidewalk"
            if tags.get("footway") == "sidewalk"
            else "crossing"
            if tags.get("footway") == "crossing"
            else "street"
        )
        ways.append(
            {
                "kind": kind,
                "name": tags.get("name"),
                "points": points,
            }
        )
    return ways


def district_bands() -> list[dict[str, Any]]:
    south, north = SF_CORRIDOR.bbox.south, SF_CORRIDOR.bbox.north
    return [
        {"name": "Marina", "west": -122.4475, "east": -122.4310, "south": 37.7975, "north": north},
        {"name": "Cow Hollow", "west": -122.4475, "east": -122.4235, "south": south, "north": 37.7975},
        {"name": "Russian Hill", "west": -122.4235, "east": -122.4115, "south": south, "north": north},
        {"name": "North Beach", "west": -122.4115, "east": -122.4020, "south": 37.7960, "north": north},
        {"name": "Chinatown", "west": -122.4115, "east": -122.4020, "south": south, "north": 37.7960},
        {"name": "Financial District", "west": -122.4020, "east": -122.3920, "south": south, "north": north},
    ]


def h3_boundary(cell: str) -> list[list[float]]:
    return [[round(lon, PRECISION), round(lat, PRECISION)] for lat, lon in h3.cell_to_boundary(cell)]


def _cell_resolution(cells: set[str]) -> int:
    if not cells:
        return 10
    return h3.get_resolution(next(iter(cells)))


def _feature_is_covered(feature: dict[str, Any], cells: set[str], resolution: int) -> bool:
    if not cells:
        return False
    sample_points = list(feature.get("points") or [])
    centroid = feature.get("centroid")
    if centroid:
        sample_points.append(centroid)
    for lon, lat in sample_points[:: max(1, len(sample_points) // 8)]:
        if h3.latlng_to_cell(lat, lon, resolution) in cells:
            return True
    return False


def annotate_osm_features(
    ways: list[dict[str, Any]], coverage: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    covered_cells = {
        row["coverage_cell"]
        for row in coverage
        if row.get("eligible_observations", 0) > 0
    }
    resolution = _cell_resolution(covered_cells)
    annotated = []
    height_sources = Counter()
    for feature in ways:
        item = dict(feature)
        item["covered"] = _feature_is_covered(item, covered_cells, resolution)
        if item.get("kind") == "building":
            height_sources[item.get("height_source") or "unknown"] += 1
        annotated.append(item)
    counts = Counter(item.get("kind") for item in annotated)
    covered_counts = Counter(item.get("kind") for item in annotated if item.get("covered"))
    return annotated, {
        "features": dict(counts),
        "covered_features": dict(covered_counts),
        "building_height_sources": dict(height_sources),
    }


def build_payload(root: Path, ways: list[dict[str, Any]]) -> dict[str, Any]:
    observations = pq.read_table(root / "observations" / "external-000.parquet").to_pylist()
    coverage = pq.read_table(root / "coverage" / "h3.parquet").to_pylist()
    sequences = pq.read_table(root / "sequences" / "external.parquet").to_pylist()
    ways, osm_summary = annotate_osm_features(ways, coverage)
    obs_by_sequence: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for obs in observations:
        obs_by_sequence[obs["sequence_uid"]].append(obs)
    sequence_paths = []
    for sequence_uid, rows in obs_by_sequence.items():
        rows.sort(key=lambda r: (r["provider_sequence_index"] is None, r["provider_sequence_index"] or 0))
        eligible_rows = [r for r in rows if r["eligible"]]
        if len(eligible_rows) < 2:
            continue
        sequence_paths.append(
            {
                "id": sequence_uid,
                "provider": eligible_rows[0]["provider"],
                "points": [
                    [round(r["longitude"], PRECISION), round(r["latitude"], PRECISION)]
                    for r in eligible_rows[:: max(1, len(eligible_rows) // 90)]
                ],
            }
        )
    sample_observations = [
        {
            "id": row["observation_uid"],
            "provider": row["provider"],
            "lon": round(row["longitude"], PRECISION),
            "lat": round(row["latitude"], PRECISION),
            "heading": row["heading_deg"],
            "mp": row["original_megapixels"],
            "tier": row["resolution_tier"],
            "projection": row["projection_type"],
            "eligible": row["eligible"],
        }
        for row in observations[:: max(1, len(observations) // 4500)]
    ]
    return {
        "summary": {
            "observations": len(observations),
            "eligible": sum(1 for row in observations if row["eligible"]),
            "sequences": len(sequences),
            "coverage_cells": len(coverage),
            "providers": dict(Counter(row["provider"] for row in observations)),
            "osm": osm_summary,
        },
        "bbox": {
            "south": SF_CORRIDOR.bbox.south,
            "west": SF_CORRIDOR.bbox.west,
            "north": SF_CORRIDOR.bbox.north,
            "east": SF_CORRIDOR.bbox.east,
        },
        "districts": district_bands(),
        "ways": ways,
        "coverage": [
            {
                "cell": row["coverage_cell"],
                "lat": row["latitude"],
                "lon": row["longitude"],
                "score": row["coverage_score"],
                "eligible": row["eligible_observations"],
                "total": row["total_observations"],
                "providers": row["unique_providers"],
                "mp": row["median_source_megapixels"],
                "boundary": h3_boundary(row["coverage_cell"]),
            }
            for row in coverage
        ],
        "observations": sample_observations,
        "sequence_paths": sequence_paths[:260],
    }


HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Kerbside SF Corridor 3D</title>
<style>
:root { color-scheme: dark; --bg:#071013; --panel:#10191e; --line:#274048; --ink:#edf5f5; --muted:#8fa4a6; --pink:#ff4d8f; --green:#4fbe86; --amber:#e0a84e; --cyan:#54c8e8; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow:hidden; }
#scene { position:fixed; inset:0; display:block; width:100vw; height:100vh; }
.hud { position:fixed; top:14px; left:14px; right:14px; display:grid; grid-template-columns:minmax(220px, 380px) 1fr; gap:12px; pointer-events:none; }
.panel { pointer-events:auto; background:rgba(16,25,30,.88); border:1px solid var(--line); border-radius:8px; padding:12px; backdrop-filter:blur(14px); box-shadow:0 12px 30px rgba(0,0,0,.22); }
h1 { margin:0 0 8px; font-size:18px; line-height:1.1; font-weight:700; letter-spacing:0; }
.meta { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.stat { border:1px solid var(--line); border-radius:7px; padding:8px; min-width:0; }
.stat b { display:block; font-size:17px; font-variant-numeric:tabular-nums; }
.stat span { color:var(--muted); font-size:10px; text-transform:uppercase; }
.legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; color:var(--muted); font-size:12px; }
.key { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.sw { width:10px; height:10px; border-radius:50%; background:var(--pink); }
.toolbar { justify-self:end; max-width:430px; display:flex; gap:8px; align-items:center; }
button { color:var(--ink); background:rgba(16,25,30,.9); border:1px solid var(--line); border-radius:7px; padding:10px 12px; font:inherit; cursor:pointer; }
button[aria-pressed=true] { border-color:var(--pink); color:#fff; background:rgba(255,77,143,.20); }
#tip { position:fixed; left:14px; bottom:14px; width:min(520px, calc(100vw - 28px)); color:var(--muted); font-size:12px; }
@media (max-width: 760px) { .hud { grid-template-columns:1fr; } .toolbar { justify-self:stretch; overflow-x:auto; } .meta { grid-template-columns:repeat(2, 1fr); } }
</style>
</head>
<body>
<canvas id="scene"></canvas>
<div class="hud">
  <div class="panel">
    <h1>Kerbside SF Corridor 3D</h1>
    <div class="meta">
      <div class="stat"><b id="obs">0</b><span>observations</span></div>
      <div class="stat"><b id="eligible">0</b><span>eligible</span></div>
      <div class="stat"><b id="seq">0</b><span>sequences</span></div>
      <div class="stat"><b id="cells">0</b><span>H3 cells</span></div>
    </div>
<div class="legend">
<span class="key"><span class="sw" style="background:#d6e7ea"></span>OSM street map</span>
<span class="key"><span class="sw" style="background:#9fb4bb"></span>covered 3D buildings</span>
<span class="key"><span class="sw" style="background:#ff4d8f"></span>curb bands</span>
<span class="key"><span class="sw"></span>metadata observations</span>
<span class="key"><span class="sw" style="background:var(--green)"></span>high coverage cells</span>
<span class="key"><span class="sw" style="background:var(--amber)"></span>crossings</span>
      <span class="key"><span class="sw" style="background:var(--cyan)"></span>sequence paths</span>
    </div>
  </div>
<div class="toolbar panel">
<button data-layer="streets" aria-pressed="true">Streets</button>
<button data-layer="mapped3d" aria-pressed="true">3D Artifact</button>
<button data-layer="coverage" aria-pressed="true">Coverage</button>
<button data-layer="observations" aria-pressed="true">Photos</button>
<button data-layer="sequences" aria-pressed="true">Sequences</button>
    <button data-layer="districts" aria-pressed="true">Districts</button>
    <button id="reset">Reset</button>
  </div>
</div>
<div id="tip">Drag to orbit, wheel or pinch to zoom. Uncovered blocks stay as the base map; covered blocks add OSM building massing and curb bands.</div>
<script type="application/json" id="payload">__PAYLOAD__</script>
<script type="module">
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const DATA = JSON.parse(document.getElementById("payload").textContent);
document.getElementById("obs").textContent = DATA.summary.observations.toLocaleString();
document.getElementById("eligible").textContent = DATA.summary.eligible.toLocaleString();
document.getElementById("seq").textContent = DATA.summary.sequences.toLocaleString();
document.getElementById("cells").textContent = DATA.summary.coverage_cells.toLocaleString();

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071013);
scene.fog = new THREE.Fog(0x071013, 650, 1900);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);
const root = new THREE.Group();
scene.add(root);
const groups = {
  streets: new THREE.Group(),
  mapped3d: new THREE.Group(),
  coverage: new THREE.Group(),
  observations: new THREE.Group(),
  sequences: new THREE.Group(),
  districts: new THREE.Group(),
};
Object.values(groups).forEach((g) => root.add(g));

const bbox = DATA.bbox;
const midLat = (bbox.south + bbox.north) / 2;
const midLon = (bbox.west + bbox.east) / 2;
const metersPerLat = 111320;
const metersPerLon = metersPerLat * Math.cos(midLat * Math.PI / 180);
function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }
function v3(lon, lat, z = 0) { const [x, y] = xy(lon, lat); return new THREE.Vector3(x, z, -y); }

const amb = new THREE.HemisphereLight(0xb7f5ff, 0x071013, 1.7);
scene.add(amb);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-420, 700, 300);
scene.add(sun);

const [westX, northY] = xy(bbox.west, bbox.north);
const [eastX, southY] = xy(bbox.east, bbox.south);
const width = eastX - westX;
const depth = northY - southY;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(width, depth, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x0c171b, roughness: 0.96, metalness: 0.02 })
);
ground.rotation.x = -Math.PI / 2;
root.add(ground);

function line(points, color, opacity = 1, y = 2, widthHint = 1) {
  const geom = new THREE.BufferGeometry().setFromPoints(points.map((p) => v3(p[0], p[1], y)));
  const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const obj = new THREE.Line(geom, mat);
  obj.userData.widthHint = widthHint;
  return obj;
}

function segmentRibbon(a, b, width, color, opacity, y, segmentHeight = 1.4) {
  const [x1, yy1] = xy(a[0], a[1]);
  const [x2, yy2] = xy(b[0], b[1]);
  const z1 = -yy1;
  const z2 = -yy2;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.8) return null;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, segmentHeight, width),
    new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.92, metalness: 0.02 })
  );
  mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  mesh.rotation.y = Math.atan2(-dz, dx);
  return mesh;
}

function ribbon(points, width, color, opacity, y, segmentHeight = 1.4) {
  const group = new THREE.Group();
  for (let i = 1; i < points.length; i += 1) {
    const segment = segmentRibbon(points[i - 1], points[i], width, color, opacity, y, segmentHeight);
    if (segment) group.add(segment);
  }
  return group;
}

function labelSprite(text, color = "#edf5f5", scale = 90) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(7, 16, 19, 0.70)";
  ctx.strokeStyle = "rgba(214, 231, 234, 0.26)";
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 22, 488, 76, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "600 42px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 28), 256, 62, 450);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(scale, scale * 0.25, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function labelAt(text, lon, lat, y, group, color = "#edf5f5", scale = 90) {
  const sprite = labelSprite(text, color, scale);
  const [x, yy] = xy(lon, lat);
  sprite.position.set(x, y, -yy);
  group.add(sprite);
}

function longestMidpoint(points) {
  let best = null;
  let bestLength = -1;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > bestLength) {
      bestLength = length;
      best = [(points[i - 1][0] + points[i][0]) / 2, (points[i - 1][1] + points[i][1]) / 2];
    }
  }
  return best;
}

function footprintShape(points) {
  if (!points || points.length < 4) return null;
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const [x, y] = xy(point[0], point[1]);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  return shape;
}

function footprintMesh(points, color, opacity, y) {
  const shape = footprintShape(points);
  if (!shape) return null;
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = y;
  return mesh;
}

function buildingMesh(feature) {
  const shape = footprintShape(feature.points);
  if (!shape) return null;
  const height = Math.max(4, Math.min(180, (feature.height_m || 10.5) * 1.8));
  const geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geom.rotateX(-Math.PI / 2);
  const measured = feature.height_source === "osm_height" || feature.height_source === "osm_levels";
  const mat = new THREE.MeshStandardMaterial({
    color: measured ? 0xb8ccd0 : 0x728a91,
    transparent: true,
    opacity: measured ? 0.76 : 0.52,
    roughness: 0.88,
    metalness: 0.03,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData = feature;
  return mesh;
}

const streetNames = new Set();
let streetLabelCount = 0;
for (const way of DATA.ways) {
  if (way.kind === "building") {
    const base = footprintMesh(way.points, way.covered ? 0x2b4148 : 0x1b2a2f, way.covered ? 0.42 : 0.18, 1.8);
    if (base) groups.streets.add(base);
    if (way.covered) {
      const building = buildingMesh(way);
      if (building) groups.mapped3d.add(building);
    }
    continue;
  }
  const isCrossing = way.kind === "crossing";
  const isSidewalk = way.kind === "sidewalk";
  const color = isCrossing ? 0xe0a84e : isSidewalk ? 0xb5c5c8 : 0xd6e7ea;
  const widthMeters = isCrossing ? 5.2 : isSidewalk ? 2.4 : 4.6;
  const opacity = isCrossing ? 0.94 : isSidewalk ? 0.62 : 0.72;
  groups.streets.add(ribbon(way.points, widthMeters, color, opacity, isCrossing ? 6 : isSidewalk ? 4.5 : 3.2));
  groups.streets.add(line(way.points, color, isCrossing ? 1 : 0.72, isCrossing ? 8 : 6));
  if (way.covered && (isCrossing || isSidewalk)) {
    groups.mapped3d.add(ribbon(way.points, isCrossing ? 6.4 : 3.2, 0xff4d8f, isCrossing ? 0.92 : 0.68, 10.5, isCrossing ? 7.5 : 5.5));
  }
  if (!isCrossing && !isSidewalk && way.name && !streetNames.has(way.name) && streetLabelCount < 90) {
    const midpoint = longestMidpoint(way.points);
    if (midpoint) {
      streetNames.add(way.name);
      streetLabelCount += 1;
      labelAt(way.name, midpoint[0], midpoint[1], 28, groups.streets, "#d6e7ea", 78);
    }
  }
}

const districtColors = [0x1d4d58, 0x355038, 0x4a3e61, 0x5a4930, 0x533749, 0x29475f];
DATA.districts.forEach((d, i) => {
  const [x1, y1] = xy(d.west, d.north);
  const [x2, y2] = xy(d.east, d.south);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.abs(x2 - x1), 6, Math.abs(y1 - y2)),
    new THREE.MeshStandardMaterial({ color: districtColors[i % districtColors.length], transparent: true, opacity: 0.2, roughness: 0.9 })
  );
  mesh.position.set((x1 + x2) / 2, 3, -(y1 + y2) / 2);
  groups.districts.add(mesh);
  labelAt(d.name, (d.west + d.east) / 2, (d.south + d.north) / 2, 54, groups.districts, "#ffffff", 145);
});

for (const c of DATA.coverage) {
  const height = 10 + 92 * Math.min(1, c.score || 0);
  const radius = 9 + Math.min(26, c.eligible * 1.1);
  const color = c.score > 0.58 ? 0x4fbe86 : c.score > 0.34 ? 0xe0a84e : 0x355866;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 6, 1),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.46, roughness: 0.64 })
  );
  const [x, y] = xy(c.lon, c.lat);
  mesh.position.set(x, height / 2, -y);
  mesh.userData = c;
  groups.coverage.add(mesh);
}

for (const o of DATA.observations) {
  const geom = new THREE.ConeGeometry(o.eligible ? 5 : 3.5, o.eligible ? 24 : 12, 8);
  const mat = new THREE.MeshStandardMaterial({ color: o.provider === "kartaview" ? 0xff4d8f : 0x54c8e8, transparent: true, opacity: o.eligible ? 0.85 : 0.35 });
  const cone = new THREE.Mesh(geom, mat);
  const [x, y] = xy(o.lon, o.lat);
  cone.position.set(x, 18, -y);
  cone.rotation.z = Math.PI;
  cone.rotation.y = ((o.heading || 0) * Math.PI) / 180;
  groups.observations.add(cone);
}

for (const s of DATA.sequence_paths) {
  groups.sequences.add(line(s.points, s.provider === "kartaview" ? 0xff4d8f : 0x54c8e8, 0.52, 32));
}

const state = { yaw: -0.45, pitch: 0.95, dist: 1180, target: new THREE.Vector3(0, 0, 0) };
function placeCamera() {
  const x = Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist;
  const z = Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist;
  const y = Math.sin(state.pitch) * state.dist;
  camera.position.copy(state.target).add(new THREE.Vector3(x, y, z));
  camera.lookAt(state.target);
}
placeCamera();

let dragging = false, last = [0, 0];
canvas.addEventListener("pointerdown", (e) => { dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - last[0], dy = e.clientY - last[1];
  state.yaw -= dx * 0.006;
  state.pitch = Math.max(0.25, Math.min(1.28, state.pitch + dy * 0.004));
  last = [e.clientX, e.clientY];
  placeCamera();
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  state.dist = Math.max(220, Math.min(2600, state.dist * Math.exp(e.deltaY * 0.001)));
  placeCamera();
}, { passive: false });
document.getElementById("reset").addEventListener("click", () => {
  Object.assign(state, { yaw: -0.45, pitch: 0.95, dist: 1180 });
  placeCamera();
});

document.querySelectorAll("button[data-layer]").forEach((button) => {
  button.addEventListener("click", () => {
    const layer = button.dataset.layer;
    groups[layer].visible = !groups[layer].visible;
    button.setAttribute("aria-pressed", String(groups[layer].visible));
  });
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--out", type=Path, default=Path("docs/sf-corridor-3d.html"))
    parser.add_argument("--osm-cache", type=Path, default=Path("data/sf_corridor/stats/osm_ways.json"))
    parser.add_argument("--reuse-osm", action="store_true")
    args = parser.parse_args()

    if args.reuse_osm and args.osm_cache.exists():
        ways = json.loads(args.osm_cache.read_text(encoding="utf-8"))
    else:
        ways = fetch_osm(SF_CORRIDOR.bbox)
        args.osm_cache.parent.mkdir(parents=True, exist_ok=True)
        args.osm_cache.write_text(json.dumps(ways, indent=2) + "\n", encoding="utf-8")

    payload = build_payload(args.catalog, ways)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        HTML.replace("__PAYLOAD__", json.dumps(payload, separators=(",", ":"), default=str)),
        encoding="utf-8",
    )
    print(f"{args.out} -> {args.out.stat().st_size / 1e6:.2f} MB")
    print(json.dumps(payload["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
