#!/usr/bin/env python3
"""Material labels in the reconstruction vocabulary, for every region, from the evidence there is.

``smc.reconstruction.contracts`` names the materials a reconstructed surface can be:
``FACADE_MATERIALS`` (10), ``GROUND_MATERIALS`` (9), ``ROOF_MATERIALS`` (8). The renderer knows
six, and the photograph matcher five. This writes, per region, the label each surface gets in
the richer vocabulary and *where the label came from*, so the renderer's table can grow into it
(docs/24 §B5) without anything being relabelled by guesswork:

* **facades** -- the photograph fingerprint matched to the closest catalogue render
  (``smc.facades.match``), mapped across; grade ``image``. Below the matcher's confidence
  threshold the label is ``unknown``, not the nearest guess. The catalogue is fitted to 39
  labelled walls (26 right in leave-one-out) and knows no stone, wood, tile or ceramic: those
  classes cannot be produced from this evidence, and are left for a trained classifier.
* **ground** -- the mapped categories of the ground-cover layer (parks and lawns are
  vegetation; plazas and front walks paved; service yards asphalt), grade ``mapped`` where a
  city or OSM layer drew the polygon, and the material itself ``inferred`` from the category.
* **roofs** -- ``unknown`` unless OpenStreetMap tags one: nothing measured has seen a roof's
  material yet.

Output: ``<official>/material_labels.json``.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.facades.match import Fingerprint, closest_render  # noqa: E402
from smc.reconstruction.contracts import (  # noqa: E402
    FACADE_MATERIALS,
    GROUND_MATERIALS,
    ROOF_MATERIALS,
)
from smc.regions.paths import region_paths  # noqa: E402

#: The matcher's five renders, in the reconstruction vocabulary.
FACADE_FROM_MATCH = {"stucco": "stucco_render", "concrete": "concrete", "brick": "brick",
                     "glass": "glass_curtain_wall", "metal": "metal_panel"}
#: Classes the matcher has no labelled examples of (smc.facades.match.CATALOGUE_STATUS).
UNFITTED = {"glass", "metal"}
#: Below this the matcher's own verdict is too close to a coin toss to be a label
#: (the renderer uses the same threshold, FACADE_MATCH_MIN_CONFIDENCE).
MIN_CONFIDENCE = 0.6
GROUND_FROM_COVER = {"parks": "grass_vegetation", "lawns": "grass_vegetation",
                     "yards": "grass_vegetation", "backyards": "grass_vegetation",
                     "plazas": "concrete", "front_walks": "concrete",
                     "service_yards": "asphalt"}
OSM_SURFACE = {"asphalt": "asphalt", "concrete": "concrete", "paving_stones": "brick_paver",
               "sett": "stone_cobble", "cobblestone": "stone_cobble", "bricks": "brick_paver",
               "gravel": "gravel_soil", "dirt": "gravel_soil", "grass": "grass_vegetation",
               "rubber": "rubber"}
OSM_ROOF = {"tar_paper": "membrane", "asphalt": "shingle_bitumen", "metal": "metal",
            "roof_tiles": "tile", "gravel": "gravel", "grass": "green_roof", "glass": "glass"}

REGIONS = ["sf-corridor", "sf-mission", "sf-sunset", "sf-haight-castro", "oakland-downtown",
           "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown"]


def build(region: str) -> dict:
    paths = region_paths(region)
    out: dict = {"region": region, "vocabulary": {"facade": list(FACADE_MATERIALS),
                                                  "ground": list(GROUND_MATERIALS),
                                                  "roof": list(ROOF_MATERIALS)},
                 "facades": {}, "ground": {}, "roofs": {}, "counts": {}}
    fp_path = paths.official / "facade_fingerprints.json"
    counts: Counter = Counter()
    if fp_path.exists():
        for osm_id, row in json.loads(fp_path.read_text()).get("buildings", {}).items():
            match = closest_render(Fingerprint.from_json(row))
            if match.material in UNFITTED:
                # The matcher has never been shown a labelled glass or metal wall; its verdict
                # for those is where a fingerprint falls, not what the wall is made of.
                label, why = "unknown", "unfitted class"
            elif match.confidence < MIN_CONFIDENCE:
                label, why = "unknown", "low confidence"
            else:
                label, why = FACADE_FROM_MATCH[match.material], ""
            out["facades"][osm_id] = [label, round(match.confidence, 2), "image"] + \
                ([why] if why else [])
            counts[f"facade:{label}" + (f" ({why})" if why else "")] += 1
    if paths.page.exists():
        for way in json.loads(paths.page.read_text()).get("ways", []):
            osm_id = way.get("osm_id")
            if osm_id is None:
                continue
            if way.get("kind") == "building":
                roof = OSM_ROOF.get(str(way.get("roof_material") or ""))
                if roof:
                    out["roofs"][str(osm_id)] = [roof, 1.0, "mapped"]
                    counts[f"roof:{roof}"] += 1
                else:
                    counts["roof:unknown"] += 1
            elif way.get("kind") in ("street", "sidewalk", "path", "parking_lot",
                                     "parking_aisle", "cycleway"):
                surface = OSM_SURFACE.get(str(way.get("surface") or ""))
                if surface:
                    out["ground"][str(osm_id)] = [surface, 1.0, "mapped"]
                else:
                    surface = "asphalt" if way.get("kind") in ("street", "parking_lot",
                                                               "parking_aisle", "cycleway") \
                        else "concrete"
                    out["ground"][str(osm_id)] = [surface, 0.6, "inferred"]
                counts[f"ground:{surface}"] += 1
    cover = paths.official / "ground_cover.json"
    if cover.exists():
        data = json.loads(cover.read_text())
        out["ground_cover_categories"] = {
            category: {"material": GROUND_FROM_COVER[category], "grade": "inferred",
                       "polygons": len(data.get(category) or [])}
            for category in GROUND_FROM_COVER if data.get(category)}
    out["counts"] = dict(sorted(counts.items()))
    (paths.official / "material_labels.json").write_text(json.dumps(out, separators=(",", ":")))
    return {"region": region, **out["counts"]}


def main() -> int:
    for region in sys.argv[1:] or REGIONS:
        print(json.dumps(build(region)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
