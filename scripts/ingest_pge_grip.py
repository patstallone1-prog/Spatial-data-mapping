"""Download PG&E GRIP LineDetail line sections for each region, as a local network reference.

The layer is PG&E's public Integration Capacity Analysis service ("to make the ICA and DIDF
data available for general public consumption"). It is the electrical-network *backbone*:
which way each distribution line section runs, its feeder, phase count and voltage. It has no
overhead/underground field, so it never by itself puts a wire in the air.

Only the attributes the connectivity build needs are kept, and the snapshot stays local
(data/electrical/grip is not versioned): what is published is pole-to-pole adjacency between
Kerbside's own observed poles, never PG&E's line geometry or capacity figures.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import time
import urllib.parse
from datetime import UTC, datetime
from pathlib import Path

from smc.official.datasf import _get

ROOT = Path(__file__).resolve().parents[1]
SERVICE = (
    "https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/"
    "DRPComplianceRelProd/FeatureServer/3"
)
FIELDS = ("OBJECTID", "FeederId", "CSV_LineSection", "voltage_kv", "phase_cnt",
          "Last_Update_On_Map", "Division")
#: Palo Alto's distribution belongs to the City of Palo Alto Utilities, not PG&E.
PGE_REGIONS = ("sf-corridor", "sf-haight-castro", "sf-mission", "sf-sunset",
               "oakland-downtown", "berkeley-downtown", "san-jose-downtown")
PAGE = 2000


def payload_for(region: str) -> Path:
    if region == "sf-corridor":
        return ROOT / "docs/sf-corridor-3d.json"
    return ROOT / "docs/regions" / region / "sf-corridor-3d.json"


def fetch(box: dict, margin: float = 0.002) -> list[dict]:
    envelope = ",".join(str(v) for v in (box["west"] - margin, box["south"] - margin,
                                         box["east"] + margin, box["north"] + margin))
    out, offset = [], 0
    while True:
        query = {
            "where": "1=1", "geometry": envelope, "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects",
            "outFields": ",".join(FIELDS), "returnGeometry": "true", "f": "json",
            "resultOffset": offset, "resultRecordCount": PAGE, "orderByFields": "OBJECTID",
        }
        doc = json.loads(_get(f"{SERVICE}/query?{urllib.parse.urlencode(query)}"))
        if "error" in doc:
            raise RuntimeError(f"GRIP query failed: {doc['error']}")
        features = doc.get("features", [])
        for feature in features:
            attributes = feature.get("attributes", {})
            for path_index, path in enumerate((feature.get("geometry") or {}).get("paths", [])):
                if len(path) < 2:
                    continue
                out.append({
                    # A multipart section is split into separate routes: no connection may
                    # bridge the gap between two parts even with the same section ID.
                    "path_id": f"grip:{attributes['OBJECTID']}:{path_index}",
                    "id": f"grip:{attributes['OBJECTID']}",
                    "feeder_id": attributes.get("FeederId"),
                    "line_section": attributes.get("CSV_LineSection"),
                    "voltage_kv": attributes.get("voltage_kv"),
                    "phase_count": attributes.get("phase_cnt"),
                    "mapped_at": attributes.get("Last_Update_On_Map"),
                    "points": [[round(x, 7), round(y, 7)] for x, y in path],
                })
        if not doc.get("exceededTransferLimit") and len(features) < PAGE:
            break
        offset += len(features)
        time.sleep(0.3)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", action="append", help="default: every PG&E region")
    args = parser.parse_args()
    folder = ROOT / "data/electrical/grip"
    folder.mkdir(parents=True, exist_ok=True)
    for region in args.region or PGE_REGIONS:
        box = json.loads(payload_for(region).read_text())["bbox"]
        lines = fetch(box)
        body = json.dumps({"schema": "kerbside.grip_line_detail/1", "service": SERVICE,
                           "retrieved_at": datetime.now(UTC).isoformat(), "bbox": box,
                           "license_note": "PG&E GRIP public ICA service; local reference only",
                           "lines": lines}, separators=(",", ":")).encode()
        (folder / f"{region}.json.gz").write_bytes(gzip.compress(body, mtime=0))
        print(f"{region}: {len(lines)} line-section paths, sha256 "
              f"{hashlib.sha256(body).hexdigest()[:12]}", flush=True)


if __name__ == "__main__":
    main()
