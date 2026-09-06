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


def street_intersections(ways: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Named street crossings, for searching by the way people actually describe a place.

    OpenStreetMap splits a way where another meets it, so two streets that cross share a node.
    Hashing the vertices and looking for coordinates used by more than one name finds the
    junctions without any geometric intersection test -- and without inventing crossings where
    a bridge merely passes over a road, which share no node and correctly do not appear.
    """
    at: dict[tuple[float, float], set[str]] = defaultdict(set)
    for way in ways:
        name = way.get("name")
        if way.get("kind") != "street" or not name:
            continue
        for lon, lat in way.get("points") or []:
            at[(round(float(lon), 6), round(float(lat), 6))].add(name)

    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for (lon, lat), names in at.items():
        if len(names) < 2:
            continue
        ordered = sorted(names)
        for i, first in enumerate(ordered):
            for second in ordered[i + 1 :]:
                if (first, second) in seen:
                    continue
                seen.add((first, second))
                out.append({"a": first, "b": second, "lon": lon, "lat": lat})
    out.sort(key=lambda row: (row["a"], row["b"]))
    return out


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
    # The model's kerb height is the measured one. Hard-coding six inches would put a number in
    # the geometry that the catalogue spent nine thousand lidar slices disagreeing with.
    measured = [
        row["curb_height_m"]
        for row in pq.read_table(root / "depth" / "surfaces" / "surface_measurements.parquet").to_pylist()
        if row.get("curb_height_m") and row.get("provenance") == "measured"
    ] if (root / "depth" / "surfaces" / "surface_measurements.parquet").exists() else []
    measured.sort()
    kerb_height_m = measured[len(measured) // 2] if measured else 0.126

    depth_summary_path = root / "depth" / "stats" / "summary.json"
    depth_summary = (
        json.loads(depth_summary_path.read_text(encoding="utf-8"))
        if depth_summary_path.exists()
        else {}
    )
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
            "cv_depth": depth_summary,
        },
        "bbox": {
            "south": SF_CORRIDOR.bbox.south,
            "west": SF_CORRIDOR.bbox.west,
            "north": SF_CORRIDOR.bbox.north,
            "east": SF_CORRIDOR.bbox.east,
        },
        "kerb_height_m": round(kerb_height_m, 4),
        "intersections": street_intersections(ways),
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
        # A gap is a mapped street or footway whose ground nobody has photographed. It is
        # computed from the same cells the coverage layer uses, so the two cannot disagree: a
        # way is a gap exactly when none of the cells it passes through holds an eligible
        # observation. This is the layer that says where to send someone next.
        "gaps": [
            {"points": way["points"], "kind": way.get("kind"), "name": way.get("name")}
            for way in ways
            if way.get("kind") in ("street", "sidewalk", "crossing") and not way.get("covered")
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
.hud { position:fixed; top:14px; left:14px; bottom:14px; width:min(340px, calc(100vw - 28px)); display:flex; flex-direction:column; gap:10px; pointer-events:none; }
/* The panel takes the column it is given rather than shrinking to its contents, so the
   sections breathe instead of being packed against the title. */
.hud .panel { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:2px; }
.hud[data-open="false"] .panel { flex:0 0 auto; padding:12px 16px; }
#find { width:100%; padding:9px 10px; border-radius:7px; border:1px solid var(--line);
        background:rgba(7,16,19,.75); color:var(--ink); font:inherit; }
#find::placeholder { color:var(--muted); }
#hits { list-style:none; margin:6px 0 0; padding:0; max-height:190px; overflow:auto; }
#hits li { padding:7px 9px; border-radius:6px; cursor:pointer; font-size:13px; color:var(--muted); }
#hits li:hover, #hits li[aria-selected=true] { background:rgba(255,77,143,.16); color:var(--ink); }
/* Collapsing targets the sections themselves rather than one wrapper. The wrapper closes
   where the original panel did, which left the layer groups outside it and folding hid
   only the statistics. */
.hud[data-open="false"] .collapsible, .hud[data-open="false"] .group { display:none; }
.bar { pointer-events:auto; display:flex; align-items:center; gap:8px; }
.bar h1 { flex:1; margin:0; }
#fold { padding:6px 10px; line-height:1; }
.group { margin-top:12px; }
.group > h2 { margin:0 0 7px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600; }
.panel { pointer-events:auto; background:rgba(16,25,30,.88); border:1px solid var(--line); border-radius:8px; padding:12px; backdrop-filter:blur(14px); box-shadow:0 12px 30px rgba(0,0,0,.22); }
h1 { margin:0 0 8px; font-size:18px; line-height:1.1; font-weight:700; letter-spacing:0; }
.meta { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.stat { border:1px solid var(--line); border-radius:7px; padding:8px; min-width:0; }
.stat b { display:block; font-size:17px; font-variant-numeric:tabular-nums; }
.stat span { color:var(--muted); font-size:10px; text-transform:uppercase; }
.legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; color:var(--muted); font-size:12px; }
.key { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.sw { width:10px; height:10px; border-radius:50%; background:var(--pink); }
.toolbar { display:flex; flex-wrap:wrap; gap:7px; }
.toolbar button { padding:8px 10px; font-size:13px; }
button { color:var(--ink); background:rgba(16,25,30,.9); border:1px solid var(--line); border-radius:7px; padding:10px 12px; font:inherit; cursor:pointer; }
button[aria-pressed=true] { border-color:var(--pink); color:#fff; background:rgba(255,77,143,.20); }
#tip { position:fixed; left:14px; bottom:14px; width:min(520px, calc(100vw - 28px)); color:var(--muted); font-size:12px; }
@media (max-width: 760px) { .hud { width:calc(100vw - 28px); bottom:auto; max-height:70vh; } .meta { grid-template-columns:repeat(2, 1fr); } }
</style>
</head>
<body>
<canvas id="scene"></canvas>
<div class="hud" id="hud" data-open="true">
  <div class="panel">
    <div class="bar">
      <h1>Kerbside SF Corridor 3D</h1>
      <button id="fold" aria-expanded="true" aria-controls="hud" title="Collapse">&minus;</button>
    </div>
    <div class="collapsible">
    <div class="group" style="margin-top:4px">
      <h2>Go to a corner</h2>
      <input id="find" type="search" autocomplete="off" placeholder="Columbus &amp; Broadway" />
      <ul id="hits"></ul>
    </div>
    <div class="meta">
      <div class="stat"><b id="obs">0</b><span>observations</span></div>
      <div class="stat"><b id="eligible">0</b><span>eligible</span></div>
      <div class="stat"><b id="seq">0</b><span>sequences</span></div>
      <div class="stat"><b id="cells">0</b><span>H3 cells</span></div>
      <div class="stat"><b id="surfaces">0</b><span>surfaces</span></div>
      <div class="stat"><b id="measured">0</b><span>measured curb</span></div>
    </div>
<div class="legend">
<span class="key"><span class="sw" style="background:#d6e7ea"></span>OSM street map</span>
<span class="key"><span class="sw" style="background:#9fb4bb"></span>covered 3D buildings</span>
<span class="key"><span class="sw" style="background:#ff4d8f"></span>curb bands</span>
<span class="key"><span class="sw" style="background:#ffffff"></span>CV/depth backlog</span>
<span class="key"><span class="sw"></span>metadata observations</span>
<span class="key"><span class="sw" style="background:var(--green)"></span>high coverage cells</span>
<span class="key"><span class="sw" style="background:var(--amber)"></span>crossings</span>
      <span class="key"><span class="sw" style="background:var(--cyan)"></span>sequence paths</span>
    </div>
  </div>
    <div class="group">
      <h2>Layers</h2>
      <div class="toolbar">
        <button data-layer="streets" aria-pressed="true">Streets</button>
        <button data-layer="mapped3d" aria-pressed="true">3D Artifact</button>
        <button data-layer="coverage" aria-pressed="true">Coverage</button>
        <button data-layer="observations" aria-pressed="true">Photos</button>
        <button data-layer="sequences" aria-pressed="true">Sequences</button>
        <button data-layer="districts" aria-pressed="true">Districts</button>
      </div>
    </div>
    <div class="group">
      <h2>Where coverage is missing</h2>
      <div class="toolbar">
        <button data-layer="gaps" aria-pressed="false">Show gaps</button>
        <button id="reset">Reset view</button>
      </div>
      <p id="gapnote" style="margin:8px 0 0;color:var(--muted);font-size:12px;line-height:1.45"></p>
    </div>
    </div>
  </div>
</div>
<div id="tip"><b>Click anywhere to go there</b> &mdash; the grey sphere is you, and arriving brings the camera down to street level. Arrow keys walk it at 15&nbsp;mph, relative to the way you are facing. Drag to orbit, wheel or pinch to zoom. The survey layers are off by default: turn them on for where photographs were taken, which blocks are covered, and which streets nobody has captured yet.</div>
<!-- The payload is fetched rather than inlined. At ten megabytes it dominated the repository:
     eight rebuilds cost 82 MB of history, because a rewritten binary never deduplicates against
     its previous version. Fetched, the page is a few kilobytes, the data changes independently,
     and browsers cache it between visits. -->
<script type="module">
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const DATA = await fetch("sf-corridor-3d.json", { cache: "no-cache" }).then((r) => {
  if (!r.ok) throw new Error(`payload ${r.status}`);
  return r.json();
});
document.getElementById("obs").textContent = DATA.summary.observations.toLocaleString();
document.getElementById("eligible").textContent = DATA.summary.eligible.toLocaleString();
document.getElementById("seq").textContent = DATA.summary.sequences.toLocaleString();
document.getElementById("cells").textContent = DATA.summary.coverage_cells.toLocaleString();
document.getElementById("surfaces").textContent = (DATA.summary.cv_depth.surface_rows || 0).toLocaleString();
document.getElementById("measured").textContent = (DATA.summary.cv_depth.measured_curb_height_count || 0).toLocaleString();

const canvas = document.getElementById("scene");
// A logarithmic depth buffer, because this scene spans five orders of magnitude: a 126 mm kerb
// has to stay distinct from the road it sits on while a two-kilometre corridor is on screen. With
// the ordinary buffer, precision falls with the square of distance -- at a thousand metres it is
// about 0.6 m, and street markings separated by two centimetres flickered in and out as the
// depth test picked a different winner each frame.
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071013);
scene.fog = new THREE.Fog(0x071013, 650, 1900);

// The near plane is the other half of the depth problem: precision scales with it, and 0.1 m
// bought nothing since the camera never comes closer than a few metres to anything.
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 6000);
// The measured median kerb, in metres: 9,376 lidar slices, cross-checked against Waymo
// ground-level lidar to within 1 mm of median. The model is built to it rather than to nominal.
const KERB = DATA.kerb_height_m || 0.126;

const root = new THREE.Group();
scene.add(root);
const groups = {
  streets: new THREE.Group(),
  mapped3d: new THREE.Group(),
  coverage: new THREE.Group(),
  observations: new THREE.Group(),
  sequences: new THREE.Group(),
  districts: new THREE.Group(),
  gaps: new THREE.Group(),
};
// What opens is the city: streets, buildings, districts. The survey layers -- where photographs
// were taken, which cells are covered, which sequences ran, which ways are missing -- are all
// about the state of the dataset rather than about the place, and starting with them lit turns
// a map of San Francisco into a progress chart. They are one click away and they stay.
for (const off of ["coverage", "observations", "sequences", "gaps"]) groups[off].visible = false;
Object.values(groups).forEach((g) => root.add(g));

const bbox = DATA.bbox;
const midLat = (bbox.south + bbox.north) / 2;
const midLon = (bbox.west + bbox.east) / 2;
const metersPerLat = 111320;
const metersPerLon = metersPerLat * Math.cos(midLat * Math.PI / 180);
function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }
function v3(lon, lat, z = 0) { const [x, y] = xy(lon, lat); return new THREE.Vector3(x, z, -y); }

// A procedural sky, generated once into an environment map. Without one, a metallic material
// reflects nothing and renders black -- which is why "make it look like glass" is really "give
// it something to be a mirror of".
function skyEnvironment(renderer) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0.0, "#0a1620");
  sky.addColorStop(0.45, "#38566a");
  sky.addColorStop(0.52, "#8fa9b8");
  sky.addColorStop(1.0, "#141c20");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return environment;
}

scene.environment = skyEnvironment(renderer);
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
  const mat = new THREE.LineBasicMaterial({
    color, transparent: opacity < 1, opacity,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const obj = new THREE.Line(geom, mat);
  obj.userData.widthHint = widthHint;
  return obj;
}

const SLAB_CACHE = new Map();
function slabMap(length, width) {
  // Bucketed to the nearest metre, so a few dozen textures cover thousands of segments.
  const key = `${Math.round(length)}x${Math.round(width)}`;
  if (!SLAB_CACHE.has(key)) {
    const map = SIDEWALK.clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, length / SLAB_M), Math.max(1, width / SLAB_M));
    SLAB_CACHE.set(key, map);
  }
  return SLAB_CACHE.get(key);
}

function segmentRibbon(a, b, width, color, opacity, y, segmentHeight = 1.4, surface = null) {
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
    new THREE.MeshStandardMaterial({
      color, transparent: opacity < 1, opacity, roughness: 0.92, metalness: 0.02,
      // The footway map is cloned per segment so its slabs stay 1.52 m whatever the segment's
      // length. A box's UVs run 0..1 per face, so a shared texture would stretch the scoring by
      // however long that stretch of pavement happens to be -- squares on a short run, ribbons
      // on a long one. The clone shares the image; only the repeat differs.
      map: surface === "walk" ? slabMap(length, width) : surface === "road" ? ASPHALT : null,
    })
  );
  mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  mesh.rotation.y = Math.atan2(-dz, dx);
  return mesh;
}

function ribbon(points, width, color, opacity, y, segmentHeight = 1.4, surface = null) {
  const group = new THREE.Group();
  for (let i = 1; i < points.length; i += 1) {
    const segment = segmentRibbon(points[i - 1], points[i], width, color, opacity, y, segmentHeight, surface);
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

// ---- materials ----
//
// Textures are drawn into a canvas rather than shipped as images: the page is served from a
// repository where every megabyte of binary is a megabyte in every future clone, and a facade
// that is a grid of windows costs a few lines of code and nothing on disk.

function noiseTexture(base, speck, size = 128, density = 0.28) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = speck;
  for (let i = 0; i < size * size * density; i += 1) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.25;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// San Francisco's building stock, roughly. Wood-frame and stucco dominate the residential
// blocks, concrete the mid-century infill, brick the older commercial streets, and glass the
// downtown towers. These shares are approximate and are meant to make a street look inhabited
// rather than to describe any particular building -- nothing downstream measures them, and the
// provenance of a colour is "invented" wherever anyone asks.
// Every colour here is chosen to sit away from the ambient grey of the ground and the sky. A
// building painted the same value as the air around it reads as wireframe -- the eye takes it
// for the absence of a surface rather than the presence of one.
const MATERIALS = [
  { name: "stucco",   share: 0.40, grit: 0.10, rough: 0.92, metal: 0.02,
    colours: [0xe4d9c2, 0xd9c9a8, 0xcdbfa4, 0xe8dfd0, 0xc8b89c,
              0xb9c4a8,   // pale sage
              0xa8b5a0] },
  { name: "painted",  share: 0.16, grit: 0.14, rough: 0.85, metal: 0.03,
    colours: [0x3f5670,   // dark blue
              0x2f4858, 0x4a6b5a,   // green
              0x6b5744,   // brown
              0x7a4b42, 0x54606b] },
  { name: "concrete", share: 0.18, grit: 0.22, rough: 0.95, metal: 0.02,
    colours: [0xc6cac6, 0xaab0ae, 0x8d9694, 0xd2d6d1] },
  { name: "brick",    share: 0.14, grit: 0.26, rough: 0.94, metal: 0.02,
    colours: [0x9c5540, 0x8a4a38, 0xa9614a, 0x7d4433, 0xb06b52, 0x6f4a3c] },
  { name: "glass",    share: 0.07, grit: 0.03, rough: 0.06, metal: 0.85,
    colours: [0x8fb2c4, 0x7aa0b6, 0xa3c2d0, 0x6d93aa] },
  { name: "metal",    share: 0.05, grit: 0.06, rough: 0.24, metal: 0.95,
    colours: [0xb9c3c8, 0x9aa6ad, 0xc9d2d6, 0x8d989f] },
];

function pickMaterial(seed, height) {
  // Tall buildings are not stucco and short ones are not curtain wall, so the draw is nudged by
  // height before the shares are applied.
  const weights = MATERIALS.map((m) => {
    const modern = m.name === "glass" || m.name === "metal" || m.name === "concrete";
    if (height > 45) return modern ? m.share * 3.5 : m.share * 0.2;
    if (height < 12) return m.name === "glass" || m.name === "metal" ? m.share * 0.12 : m.share;
    return m.share;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random(seed) * total;
  for (let i = 0; i < MATERIALS.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return MATERIALS[i];
  }
  return MATERIALS[0];
}

// A stable pseudo-random from an integer, so a building keeps its colour between reloads. Math
// .random would repaint the city on every refresh, which reads as flicker rather than variety.
function random(seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function facadeTexture() {
  // One storey tall and one bay wide, tiled. Windows are lit at random so a street of identical
  // extrusions stops reading as identical.
  const w = 64, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8d9ea4";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, h - 6, w, 6);                      // the floor line between storeys
  for (const x of [10, 36]) {
    const lit = Math.random() < 0.22;
    ctx.fillStyle = lit ? "rgba(255,226,170,0.85)" : "rgba(24,38,44,0.9)";
    ctx.fillRect(x, 12, 18, 34);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(x + 0.5, 12.5, 17, 33);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function facadeFor(material, seed) {
  // One canvas per material, not per building: a few hundred buildings share four textures, and
  // the variation between them comes from the tint rather than from redrawing the windows.
  const w = 64, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  if (material.name === "brick") {
    // Courses, offset every other row. Coarse at this scale, but it is the pattern the eye
    // reads as brick from across a street.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
      const offset = (y / 4) % 2 ? 4 : 0;
      for (let x = offset; x < w; x += 8) ctx.fillRect(x, y, 1, 4);
    }
  } else if (material.name === "glass") {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 2);
  }

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, h - 5, w, 5);                     // the line between storeys
  if (material.name !== "glass" && material.name !== "metal") {
    // A window is not a dark rectangle. It is a recess with a frame, a sill catching light from
    // above, and a pane that is darker at the top than the bottom because it reflects sky at a
    // grazing angle and room at a steep one. Those three details are most of the realism.
    for (const x of [9, 35]) {
      const lit = random(seed + x) < 0.16;
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(x - 2, 10, 22, 36);                        // the reveal
      const pane = ctx.createLinearGradient(0, 12, 0, 44);
      if (lit) {
        pane.addColorStop(0, "rgba(255,224,168,0.92)");
        pane.addColorStop(1, "rgba(214,168,96,0.80)");
      } else {
        pane.addColorStop(0, "rgba(120,150,168,0.85)");       // sky at the top
        pane.addColorStop(0.5, "rgba(38,54,64,0.92)");
        pane.addColorStop(1, "rgba(20,30,36,0.95)");          // room at the bottom
      }
      ctx.fillStyle = pane;
      ctx.fillRect(x, 12, 18, 32);
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.fillRect(x - 2, 45, 22, 2);                         // the sill
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, 12.5, 17, 31);
      ctx.beginPath();                                        // the glazing bar
      ctx.moveTo(x + 9, 12); ctx.lineTo(x + 9, 44);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.stroke();
    }
  }

  // Grit. Weathering, soot and patching, which is most of what separates a real wall from a
  // flat fill at this distance.
  for (let i = 0; i < w * h * material.grit; i += 1) {
    ctx.fillStyle = random(seed + i) < 0.5 ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.13)";
    ctx.fillRect(random(seed + i * 3) * w, random(seed + i * 7) * h, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const FACADE_CACHE = new Map();
function facadeTextureFor(material, seed) {
  // Four variants per material is enough to break up a terrace without four hundred textures.
  const key = `${material.name}-${Math.floor(random(seed) * 4)}`;
  if (!FACADE_CACHE.has(key)) FACADE_CACHE.set(key, facadeFor(material, seed));
  return FACADE_CACHE.get(key);
}

const FACADE_TEXTURE = facadeTexture();
const ASPHALT = noiseTexture("#15191c", "#05080a", 128, 0.42);
ASPHALT.repeat.set(8, 8);

function sidewalkTexture() {
  // Scored concrete. San Francisco pours its footways in squares of about five feet, and the
  // joints between them are most of what tells you, at a glance, that you are looking at a
  // pavement rather than at a grey strip.
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#9fa8a6";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.30; i += 1) {
    ctx.fillStyle = random(i) < 0.5 ? "rgba(0,0,0,0.13)" : "rgba(255,255,255,0.10)";
    ctx.fillRect(random(i * 3) * size, random(i * 5) * size, 1, 1);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.34)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0.7, 0.7, size - 1.4, size - 1.4);   // one slab per tile
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const SIDEWALK = sidewalkTexture();
//: One scored square, in metres. Five feet is the usual San Francisco pour.
const SLAB_M = 1.52;

//: Storey height and bay width in metres, so one tile of the facade covers one real storey.
const STOREY_M = 3.2;
const BAY_M = 4.0;

// ExtrudeGeometry's default UVs come from the footprint's own coordinates, which stretches a
// facade by however large the building is in world space. This maps side walls to
// (distance along the wall, height) instead, so windows stay the same size on every building.
const FACADE_UV = {
  generateTopUV(geometry, vertices, a, b, c) {
    // Roofs carry no map, so these only need to exist and be finite.
    return [
      new THREE.Vector2(vertices[a * 3] / 20, vertices[a * 3 + 1] / 20),
      new THREE.Vector2(vertices[b * 3] / 20, vertices[b * 3 + 1] / 20),
      new THREE.Vector2(vertices[c * 3] / 20, vertices[c * 3 + 1] / 20),
    ];
  },
  generateSideWallUV(geometry, vertices, a, b, c, d) {
    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
    const cz = vertices[c * 3 + 2], dz = vertices[d * 3 + 2];
    const run = Math.hypot(bx - ax, by - ay) / BAY_M;
    return [
      new THREE.Vector2(0, az / STOREY_M),
      new THREE.Vector2(run, bz / STOREY_M),
      new THREE.Vector2(run, cz / STOREY_M),
      new THREE.Vector2(0, dz / STOREY_M),
    ];
  },
};

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
  // No exaggeration. This was multiplied by 1.8 to make massing read from a bird's eye, which
  // put every building eighty per cent taller than OpenStreetMap says it is -- fine as a
  // diagram, wrong the moment somebody walks down the street beside it.
  const height = Math.max(3, Math.min(260, feature.height_m || 10.5));
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: false, UVGenerator: FACADE_UV,
  });
  geom.rotateX(-Math.PI / 2);
  const measured = feature.height_source === "osm_height" || feature.height_source === "osm_levels";
  // Seeded from the footprint, so a building keeps its material and colour between reloads.
  const seed = Math.round((feature.points[0][0] * 1e5) + (feature.points[0][1] * 1e5) * 7919);
  const material = pickMaterial(seed, height);
  const palette = material.colours;
  const tint = palette[Math.floor(random(seed + 11) * palette.length)];
  // A building whose height was measured is drawn solid; an inferred default stays translucent,
  // so the difference between what is known and what is assumed survives the prettier textures.
  // Higher than it was. A translucent building reads as scaffolding; the distinction between a
  // measured height and an inferred one is still there, just no longer at the cost of the city
  // looking like a wireframe.
  const opacity = measured ? 1.0 : 0.82;
  // ExtrudeGeometry emits two material groups: the caps first, then the walls. Giving both the
  // facade map put a grid of windows across every rooftop -- which reads, from above, as though
  // the city were tiled in glass.
  // The roof takes the wall's colour, darkened. A fixed grey top on a coloured building looked
  // like a lid set on something else, and from above -- which is most of how this map is read --
  // the roof is the building.
  const roofTint = new THREE.Color(tint).multiplyScalar(0.68);
  const roof = new THREE.MeshStandardMaterial({
    color: roofTint, transparent: opacity < 1, opacity,
    roughness: 0.97, metalness: material.name === "metal" ? 0.5 : 0.03,
  });
  const walls = new THREE.MeshStandardMaterial({
    map: facadeTextureFor(material, seed),
    color: tint,
    transparent: opacity < 1,
    opacity,
    roughness: material.rough,
    metalness: material.metal,
    // Glass and metal are mirrors of the sky, so they need something to reflect. The tint alone
    // gives a flat blue rectangle; the environment map is what makes it read as a window.
    envMapIntensity: material.name === "glass" ? 1.6 : material.name === "metal" ? 1.1 : 0.35,
  });
  const mesh = new THREE.Mesh(geom, [roof, walls]);
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
  const color = isCrossing ? 0xe0a84e : 0xffffff;
  // Footways in this corridor run three to four and a half metres; 2.4 was a diagram width.
  const widthMeters = isCrossing ? 5.2 : isSidewalk ? 3.6 : 8.0;
  // Opaque, because these are surfaces rather than overlays. Once the kerb was built at its
  // measured 126 mm the old 0.62 made the footway a faint film on dark ground and it read as
  // missing -- the geometry was right and the material was still drawn like a diagram.
  const opacity = 1.0;
  // Heights are metres of actual street. They used to be chosen for legibility from above --
  // a footway was a 1.4 m slab floating 4.5 m up, and the measured-kerb band was a 5.5 m slab
  // three storeys in the air. Read from a bird's eye that was merely stylised; walked at street
  // level it made every footway taller than the person on it.
  const roadTop = 0.06;
  groups.streets.add(ribbon(way.points, widthMeters, color, opacity,
    isCrossing ? roadTop + 0.02 : isSidewalk ? roadTop + KERB / 2 : roadTop / 2,
    isCrossing ? 0.02 : isSidewalk ? KERB : roadTop,
    isCrossing ? null : isSidewalk ? "walk" : "road"));
  groups.streets.add(line(way.points, color, isCrossing ? 1 : 0.72,
    isCrossing ? roadTop + 0.05 : isSidewalk ? roadTop + KERB + 0.02 : roadTop + 0.02));
  if (way.covered && (isCrossing || isSidewalk)) {
    // The kerb face itself: as tall as it was measured, and narrow, because it is an edge.
    groups.mapped3d.add(ribbon(way.points, isCrossing ? 0.8 : 0.45, 0xff4d8f,
      isCrossing ? 0.92 : 0.8, roadTop + KERB / 2, KERB));
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
  state.dist = Math.max(8, Math.min(2600, state.dist * Math.exp(e.deltaY * 0.001)));
  placeCamera();
}, { passive: false });
document.getElementById("reset").addEventListener("click", () => {
  Object.assign(state, { yaw: -0.45, pitch: 0.95, dist: 1180 });
  if (typeof avatar !== "undefined") {
    avatar.position.set(0, AVATAR_RADIUS, 0);
    state.target.copy(avatar.position);
  }
  placeCamera();
});

// ---- gaps: mapped ways nobody has photographed ----
{
  const material = new THREE.LineBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.85 });
  let metres = 0;
  for (const gap of DATA.gaps || []) {
    const points = gap.points.map(([lon, lat]) => v3(lon, lat, 1.5));
    if (points.length < 2) continue;
    for (let i = 1; i < points.length; i += 1) metres += points[i].distanceTo(points[i - 1]);
    groups.gaps.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  const note = document.getElementById("gapnote");
  if (note) {
    const total = (DATA.gaps || []).length;
    note.textContent = total
      ? `${total.toLocaleString()} mapped ways, about ${(metres / 1000).toFixed(1)} km, have no eligible photograph over them.`
      : "Every mapped way in the region has at least one eligible photograph over it.";
  }
}

// ---- search by corner ----
//
// People say where they are by naming two streets, so that is what the field takes. Matching is
// per-word across both names, which lets "market 4th" and "4th & market" find the same corner
// without the searcher having to guess the order or the ampersand.
{
  const field = document.getElementById("find");
  const hits = document.getElementById("hits");
  const corners = DATA.intersections || [];
  let selected = -1;
  let showing = [];

  function search(query) {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    return corners
      .filter((c) => {
        const hay = `${c.a} ${c.b}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8);
  }

  function paint() {
    hits.replaceChildren();
    showing.forEach((corner, index) => {
      const item = document.createElement("li");
      item.textContent = `${corner.a} & ${corner.b}`;
      item.setAttribute("aria-selected", String(index === selected));
      item.addEventListener("click", () => travelTo(corner));
      hits.append(item);
    });
  }

  function travelTo(corner) {
    const [x, y] = xy(corner.lon, corner.lat);
    // A named corner is a destination, so this behaves like the two-finger gesture: it moves
    // the sphere and closes the distance rather than only turning the camera.
    goTo(new THREE.Vector3(x, 0, -y), { travel: true });
    field.value = `${corner.a} & ${corner.b}`;
    showing = [];
    selected = -1;
    paint();
  }

  field.addEventListener("input", () => {
    showing = search(field.value);
    selected = showing.length ? 0 : -1;
    paint();
  });
  field.addEventListener("keydown", (e) => {
    if (!showing.length) return;
    if (e.key === "ArrowDown") { selected = (selected + 1) % showing.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { selected = (selected - 1 + showing.length) % showing.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter") { travelTo(showing[Math.max(selected, 0)]); e.preventDefault(); }
    // Arrow keys inside the field steer the list, not the sphere; the walker's handler is on
    // the window and would otherwise start it moving while somebody is choosing a corner.
    e.stopPropagation();
  });
}

// ---- the sidebar folds, because on a phone it otherwise covers the map it describes ----
{
  const hud = document.getElementById("hud");
  const fold = document.getElementById("fold");
  fold.addEventListener("click", () => {
    const open = hud.dataset.open !== "false";
    hud.dataset.open = String(!open);
    fold.setAttribute("aria-expanded", String(!open));
    fold.innerHTML = open ? "&plus;" : "&minus;";
    fold.title = open ? "Expand" : "Collapse";
  });
}

document.querySelectorAll("button[data-layer]").forEach((button) => {
  // The control reads its state from the scene rather than from the markup, so a layer's
  // default can be changed in one place without the buttons quietly disagreeing with it.
  button.setAttribute("aria-pressed", String(groups[button.dataset.layer].visible));
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
// ---- a body to move through the city with ----
//
// Orbiting a model tells you its shape; walking it tells you its scale. The sphere is the
// cheapest possible stand-in for a person -- no shadow, no model, no physics -- but it is
// street-sized and it moves at a speed you can feel, which is enough to make a kerb read as
// something you would step off rather than a pink line on a diagram.
const STREET_SPEED = 8.94;     // 20 mph in metres per second, at street level
// Above that the speed scales with how far the camera has pulled back, so the sphere always
// crosses the screen at the same rate. Walking a block at 20 mph is right when you are standing
// in it; from two thousand metres up the same 20 mph is a stationary dot, and crossing the
// corridor would take four minutes. What stays constant is the apparent speed, not the metric.
const SPEED_REFERENCE_DIST = 45;
const AVATAR_RADIUS = 0.9;     // 1.8 m across: a person, so everything else has a scale to read against
const ARRIVAL_DIST = 45;       // close enough that a 126 mm kerb is a step rather than a line
const avatar = new THREE.Mesh(
  new THREE.SphereGeometry(AVATAR_RADIUS, 24, 16),
  // Faintly self-lit. Grey on grey buildings disappears the moment it rolls into shade, and
  // losing the thing you are steering is worse than it being slightly unrealistic.
  new THREE.MeshStandardMaterial({
    color: 0x4fd18b, roughness: 0.45, metalness: 0.05, emissive: 0x12452c,
  })
);
avatar.position.set(0, AVATAR_RADIUS, 0);
root.add(avatar);
state.target.copy(avatar.position);
placeCamera();

const held = new Set();
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
addEventListener("keydown", (e) => {
  if (!ARROWS.has(e.key)) return;
  // Typing in a field is not steering. Without this, choosing a corner walks the sphere away.
  if (e.target instanceof HTMLInputElement) return;
  held.add(e.key);
  e.preventDefault();   // otherwise the arrows scroll the page out from under the canvas
});
addEventListener("keyup", (e) => held.delete(e.key));
addEventListener("blur", () => held.clear());   // a key held while tabbing away would stick

// Click to go there. The ray is cast at the ground rather than at the geometry, so clicking a
// rooftop puts you on the street beneath it instead of on the roof.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pressedAt = [0, 0];
canvas.addEventListener("pointerdown", (e) => { pressedAt = [e.clientX, e.clientY]; });

function groundAt(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const landing = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, landing) ? landing : null;
}

// One finger looks, two fingers travel. Panning the focus without moving the sphere is how you
// survey a block you have not decided to walk to yet; committing to it should be the deliberate
// gesture, not the one you make by accident while orbiting.
function goTo(landing, { travel }) {
  if (!landing) return;
  if (travel) {
    avatar.position.set(landing.x, AVATAR_RADIUS, landing.z);
    state.dist = Math.min(state.dist, ARRIVAL_DIST);
  }
  state.target.set(landing.x, travel ? AVATAR_RADIUS : 0, landing.z);
  placeCamera();
}

canvas.addEventListener("pointerup", (e) => {
  // A drag is an orbit, not a destination. Only a press that barely moved counts as a click.
  if (Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > 5) return;
  if (e.button === 2) return;   // handled on contextmenu, which fires first on a two-finger tap
  goTo(groundAt(e.clientX, e.clientY), { travel: false });
});

canvas.addEventListener("contextmenu", (e) => {
  // A two-finger tap on a trackpad, or a right click. Both arrive here.
  e.preventDefault();
  goTo(groundAt(e.clientX, e.clientY), { travel: true });
});

let previous = performance.now();
function stepAvatar(now) {
  const dt = Math.min((now - previous) / 1000, 0.1);   // clamped: a backgrounded tab returns
  previous = now;                                       // with a huge delta and would teleport
  if (!held.size) return;
  // Forward is where the camera looks, so the arrows mean what they appear to mean however the
  // view has been orbited.
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).negate();
  const rightward = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();
  if (held.has("ArrowUp")) move.add(forward);
  if (held.has("ArrowDown")) move.sub(forward);
  if (held.has("ArrowRight")) move.add(rightward);
  if (held.has("ArrowLeft")) move.sub(rightward);
  if (!move.lengthSq()) return;
  const scaled = STREET_SPEED * Math.max(1, state.dist / SPEED_REFERENCE_DIST);
  move.normalize().multiplyScalar(scaled * dt);
  avatar.position.add(move);
  // Roll it the distance it travelled, about the axis across its direction of travel.
  const axis = new THREE.Vector3(move.z, 0, -move.x).normalize();
  avatar.rotateOnWorldAxis(axis, move.length() / AVATAR_RADIUS);
  state.target.copy(avatar.position);
  placeCamera();
}

function animate(now) {
  requestAnimationFrame(animate);
  stepAvatar(now || performance.now());
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
    # Data beside the page rather than inside it. The page is then a few kilobytes that rarely
    # change, and the payload is one file the browser caches -- where inlining rewrote ten
    # megabytes of undedupable HTML into the repository on every single build.
    data_path = args.out.with_suffix(".json")
    data_path.write_text(json.dumps(payload, separators=(",", ":"), default=str), encoding="utf-8")
    args.out.write_text(
        HTML,
        encoding="utf-8",
    )
    print(f"{args.out} -> {args.out.stat().st_size / 1e3:.1f} kB page")
    print(f"{data_path} -> {data_path.stat().st_size / 1e6:.2f} MB payload")
    print(json.dumps(payload["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
