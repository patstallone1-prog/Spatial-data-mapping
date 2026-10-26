"""A finished cell, tested automatically: passed into the release, or held for a person.

The tests are the project's own audit, read with the leniency a cell that is not the Marina
deserves:

1. The cell's journal shows every *required* stage of its chain done -- the base chain through
   ``audit``. An enrichment stage (colours, survey, ground, facades, rebuild, trees) that was
   skipped after its tries ran out is noted, not held: what it would have added is judged in 3.
2. The cell has a payload to publish.
3. The Marina parity audit (``scripts/audit_region_parity.py``), run on the cell's own build by
   the same rules as on a published region, against a floor scaled to the cell:

   * **leniency**: a share passes at 60 % of the Marina reference's, not the audit's 75 %
     (that screen ranks regions for more ingestion; it is not a publication bar);
   * **population**: a suburb is not the Marina. The cell's people per square kilometre (the
     2020 census blocks under its box, TIGERweb) against the Marina corridor's scales every
     floor by the square root of the ratio, never below 40 %: a street of houses with a tenth
     of the Marina's people is photographed, surveyed and textured far less, and is held to
     about a third of its bar. Where the census cannot be asked the Marina's floor stands.
   * a cell of a handful of buildings (parkland, a reservoir) has its shares noted, not judged.

   Issues the audit raises are of two kinds. A publication fault -- sampled colours not served,
   ground records in the source missing from the page -- holds the cell. What is simply absent
   -- no tree or yard records, a few lidar cells still to be read -- is noted.

A cell with no hold reason is published; the notes go with it. One with any is **held**, with
every reason, for a person to approve, reject or send back (``smc-cloud review``); nothing
downstream of it moves until then, and nothing else waits on it. The gate never edits the cell.
"""

from __future__ import annotations

import functools
import json
import math
import runpy
import urllib.parse
import urllib.request
from pathlib import Path

from .stages import BASE_CHAIN, OPTIONAL_STAGES

#: The audit's own screen (scripts/audit_region_parity.py audit()) ranks regions for ingestion;
#: the gate publishes at this share of the reference instead.
SHARE_SCREEN = 0.6
#: The Marina-to-FiDi corridor's people per km² of land: the 2020 census blocks under its
#: payload's box (932 blocks, 153,466 people, 11.99 km² of land; TIGERweb, 2026-10-26).
REFERENCE_PEOPLE_PER_KM2 = 12_801
#: The lowest a cell's floors are scaled to, however few live there.
MIN_DENSITY_FACTOR = 0.4
#: Fewer buildings than this and the shares are too few to judge.
MIN_BUILDINGS = 10
#: Lidar cells still failed or waiting, as a share of those read, before it holds the cell.
LIDAR_RETRY_SHARE = 0.10
CENSUS_BLOCKS = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
                 "tigerWMS_Census2020/MapServer/10/query")


@functools.cache
def _parity(root: str) -> dict:
    return runpy.run_path(str(Path(root) / "scripts/audit_region_parity.py"))


@functools.cache
def reference_metrics(root: str) -> dict:
    """The Marina-to-FiDi corridor's shares, from the committed payload in ``docs/``."""
    parity = _parity(root)
    row = parity["audit_region"](Path(root), Path(root), "sf-corridor")
    if "metrics" not in row:
        raise RuntimeError("the reference corridor payload is missing; cannot gate a cell")
    return row["metrics"]


def census_density(bbox: dict, *, timeout: float = 60) -> dict:
    """People per km² of land in the 2020 census blocks under ``bbox``."""
    query = urllib.parse.urlencode({
        "geometry": f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}",
        "geometryType": "esriGeometryEnvelope", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "outFields": "POP100,AREALAND",
        "returnGeometry": "false", "f": "json", "resultRecordCount": 10000})
    with urllib.request.urlopen(f"{CENSUS_BLOCKS}?{query}", timeout=timeout) as response:
        body = json.loads(response.read())
    if "error" in body:
        raise RuntimeError(f"census: {body['error']}")
    rows = [f["attributes"] for f in body.get("features", [])]
    people = sum(r.get("POP100") or 0 for r in rows)
    land_km2 = sum(r.get("AREALAND") or 0 for r in rows) / 1e6
    return {"blocks": len(rows), "people": people, "land_km2": round(land_km2, 3),
            "people_per_km2": round(people / land_km2) if land_km2 else None,
            "source": "US Census 2020 blocks (TIGERweb)"}


def population(base: Path, site: Path, lookup=census_density) -> dict | None:
    """The cell's census density, kept in its folder (``population.json``) once asked."""
    cached = base / "population.json"
    if cached.is_file():
        try:
            return json.loads(cached.read_text())
        except ValueError:
            pass
    try:
        bbox = json.loads((site / "sf-corridor-3d.json").read_text()).get("bbox")
    except (OSError, ValueError):
        return None
    if not bbox:
        return None
    try:
        found = lookup(bbox)
    except Exception as exc:  # the census down is a floor not scaled, not a failed gate
        return {"error": f"{type(exc).__name__}: {exc}"}
    if found.get("people_per_km2") is not None:
        cached.write_text(json.dumps(found))
    return found


def density_factor(found: dict | None) -> float:
    density = (found or {}).get("people_per_km2")
    if not density:
        return 1.0
    ratio = density / REFERENCE_PEOPLE_PER_KM2
    return round(min(1.0, max(MIN_DENSITY_FACTOR, math.sqrt(ratio))), 3)


def _sort_issues(row: dict) -> tuple[list[str], list[str]]:
    """The audit's issues as (holds, notes)."""
    holds, notes = [], []
    read = row.get("lidar_latest_cells") or 0
    for issue in row.get("issues", []):
        if issue.startswith("no ") and issue.endswith("records in served ground sidecar"):
            notes.append(issue)
        elif "latest lidar cells failed or await retry" in issue:
            failed = row.get("lidar_failed_cells") or 0
            (notes if read and failed / read <= LIDAR_RETRY_SHARE else holds).append(issue)
        else:
            holds.append(issue)
    return holds, notes


def evaluate(root: Path, cell: str, chain: tuple[str, ...] | list[str], *,
             lookup=census_density) -> dict:
    """The verdict on ``data/regions/<cell>`` as it stands under ``root``."""
    root = Path(root)
    base = root / "data/regions" / cell
    reasons: list[str] = []
    notes: list[str] = []
    try:
        journal = json.loads((base / "ingest.json").read_text())
    except (OSError, ValueError):
        journal = {}
    stages = journal.get("stages", {})
    unfinished = [s for s in chain if stages.get(s, {}).get("status") != "done"]
    required = [s for s in unfinished if s not in OPTIONAL_STAGES]
    skipped = [s for s in unfinished if s in OPTIONAL_STAGES]
    if required:
        reasons.append(f"stages not done: {', '.join(required)}")
    if skipped:
        notes.append(f"skipped after their tries ran out: {', '.join(skipped)}")
    site = base / "site"
    if not (site / "sf-corridor-3d.json").is_file():
        reasons.append("no payload (site/sf-corridor-3d.json)")
        return {"decision": "hold", "reasons": reasons, "notes": notes, "cell": cell}
    parity = _parity(str(root))
    row = parity["audit_region"](root, root, cell, site=site)
    reference = reference_metrics(str(root))
    found = population(base, site, lookup)
    factor = density_factor(found)
    if found is None or "error" in (found or {}):
        notes.append("population unknown"
                     + (f" ({found['error']})" if found else "") + "; the Marina's floors apply")
    buildings = row.get("counts", {}).get("buildings", 0)
    floors = {}
    for name, value in row.get("metrics", {}).items():
        ref = reference[name]["share"]
        share = value["share"]
        if not ref or share is None:
            continue
        floor = round(ref * SHARE_SCREEN * factor, 4)
        floors[name] = floor
        if share < floor:
            text = (f"{name}: {share:.3f} against a floor of {floor:.3f} (Marina {ref:.3f} x "
                    f"{SHARE_SCREEN:.0%} x population {factor:.2f})")
            (reasons if buildings >= MIN_BUILDINGS else notes).append(text)
    holds, issue_notes = _sort_issues(row)
    reasons.extend(holds)
    notes.extend(issue_notes)
    return {
        "decision": "pass" if not reasons else "hold",
        "reasons": reasons,
        "notes": notes,
        "cell": cell,
        "metrics": row.get("metrics", {}),
        "reference": {k: v["share"] for k, v in reference.items()},
        "floors": floors,
        "population": found,
        "density_factor": factor,
        "kerb_grades": row.get("kerb_grades", {}),
        "counts": row.get("counts", {}),
        "payload_sha256": row.get("payload", {}).get("sha256"),
        "rule": (f"every share at least {SHARE_SCREEN:.0%} of the Marina reference scaled by "
                 f"population (factor {factor:.2f}), no publication fault, every required "
                 f"stage done ({', '.join(s for s in BASE_CHAIN)})"),
    }
