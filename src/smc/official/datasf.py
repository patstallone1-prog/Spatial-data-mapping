"""Fetching San Francisco's published records, and remembering exactly what was fetched.

This talks to the city's Socrata endpoints. It is deliberately not a general client: it knows
which tables carry geometry worth having, how to ask for only the corridor, and how to record
what came back well enough that a later run can prove the numbers have not moved.

What is *not* here is the map-research archive -- the Q maps, A maps, grade maps and street
improvement plans. Those are scanned sheets behind a viewer with no bulk interface, and the
curb elevations that would give a true top-of-curb minus flow-line height live only there. The
schema in this package has room for them; nothing in this module pretends to have them.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from smc.official.schema import DocumentStatus, OfficialDocument

ENDPOINT = "https://data.sfgov.org/resource"
USER_AGENT = "spatial-mapping-crowdsource/official (+non-commercial research)"
PAGE = 10_000


@dataclass(frozen=True)
class Dataset:
    """One published table, and what kind of claim it is making."""

    dataset_id: str
    name: str
    geometry_column: str | None
    record_type: str
    status: DocumentStatus
    #: What the publisher says about how the numbers were obtained. Kept because the difference
    #: between a survey and a policy is a sentence in the metadata, not a column type.
    methodology: str = ""


#: The tables worth reading, and only those. Each was checked against its own metadata before
#: being listed; the statuses are the publisher's claim, not a guess from the name.
DATASETS: dict[str, Dataset] = {
    "sidewalk_widths": Dataset(
        "4g86-grxu", "Sidewalk Widths (2014)", "shape", "sidewalk_survey",
        DocumentStatus.EXISTING_SURVEY,
        "Widths from a 2014 AECOM study, joined to the street centreline network. The actual "
        "width is the sidewalk_f column; width_min and width_reco are Better Streets Plan "
        "policy and are extracted separately as design standards.",
    ),
    "right_of_way": Dataset(
        "h8n7-e4ns", "Right of Way Polygons", "the_geom", "right_of_way",
        DocumentStatus.RECORDED,
        "Right of way apportioned into street segment and intersection areas, from a 2014 "
        "analysis. The publisher states it 'is not provided at engineering levels of spatial "
        "accuracy' and that changes after 2014 are not reflected, so widths read off it are "
        "carried with a metre-scale uncertainty rather than a surveyed one.",
    ),
    "street_acceptance": Dataset(
        "abvp-arbf", "Street Acceptance Data", None, "acceptance",
        DocumentStatus.ACCEPTED,
        "Board of Supervisors ordinance accepting a street into the city system.",
    ),
    "curb_ramps": Dataset(
        "ch9w-7kih", "Curb Ramps", None, "curb_ramp_inventory",
        DocumentStatus.EXISTING_SURVEY,
        "Public Works curb ramp inventory, with per-ramp condition findings.",
    ),
    "curbs_islands": Dataset(
        "emxt-b6yg", "Curbs and Islands", "the_geom", "curb_line",
        DocumentStatus.RECORDED,
        "Curb and island linework from the city basemap. Partial coverage.",
    ),
    "streets": Dataset(
        "3psu-pn9h", "Streets - Active and Retired", "line", "centreline",
        DocumentStatus.RECORDED,
        "The street centreline network. Reference geometry and the CNN join key.",
    ),
    "parcels": Dataset(
        "acdm-wktn", "Parcels - Active and Retired", "shape", "parcel",
        DocumentStatus.RECORDED,
        "Assessor parcels. Property lines, and whether Public Works holds a recorded map.",
    ),
}


class HarvestError(RuntimeError):
    pass


def _get(url: str, *, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            # A 400 is our query being wrong and will not improve with waiting.
            if exc.code < 500 and exc.code != 429:
                raise HarvestError(f"{url} -> HTTP {exc.code}: {exc.read()[:200]!r}") from exc
            last = exc
        except OSError as exc:
            last = exc
        time.sleep(2 ** attempt)
    raise HarvestError(f"{url} failed after {attempts} attempts: {last}")


def bbox_clause(column: str, bbox: dict) -> str:
    return (f"within_box({column}, {bbox['north']}, {bbox['west']}, "
            f"{bbox['south']}, {bbox['east']})")


def fetch(
    dataset: Dataset,
    *,
    bbox: dict | None = None,
    cache_dir: Path,
    refresh: bool = False,
    progress=lambda _m: None,
) -> tuple[list[dict], OfficialDocument]:
    """Every row of ``dataset`` inside ``bbox``, with a document record describing the fetch.

    The response is cached by dataset and query. A rerun reads the cache and does not touch the
    network, which keeps a build reproducible and keeps us off the city's servers; ``refresh``
    is the way to go and look again.
    """
    where = None
    if bbox is not None:
        if dataset.geometry_column:
            where = bbox_clause(dataset.geometry_column, bbox)
        else:
            where = (f"latitude between {bbox['south']} and {bbox['north']} "
                     f"and longitude between {bbox['west']} and {bbox['east']}")

    key = hashlib.blake2b(f"{dataset.dataset_id}|{where}".encode(), digest_size=8).hexdigest()
    cache_path = cache_dir / f"{dataset.dataset_id}-{key}.json"
    source_url = f"{ENDPOINT}/{dataset.dataset_id}.json"

    if cache_path.exists() and not refresh:
        blob = cache_path.read_bytes()
        payload = json.loads(blob)
        progress(f"{dataset.name}: {len(payload['rows'])} rows from cache")
        return payload["rows"], _document(dataset, source_url, payload["sha256"],
                                          payload["retrieved_at"], where)

    rows: list[dict] = []
    while True:
        params = {"$limit": PAGE, "$offset": len(rows), "$order": ":id"}
        if where:
            params["$where"] = where
        page = json.loads(_get(f"{source_url}?{urllib.parse.urlencode(params)}"))
        rows.extend(page)
        progress(f"{dataset.name}: {len(rows)} rows")
        if len(page) < PAGE:
            break

    # The digest is over the rows as they will be used, in a stable order, so that "has this
    # changed" is a question about the data and not about how Socrata happened to page it.
    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    sha256 = hashlib.sha256(canonical).hexdigest()
    retrieved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(
        {"dataset": dataset.dataset_id, "where": where, "sha256": sha256,
         "retrieved_at": retrieved_at, "rows": rows},
        separators=(",", ":")))
    return rows, _document(dataset, source_url, sha256, retrieved_at, where)


def _document(dataset: Dataset, source_url: str, sha256: str,
              retrieved_at: str, where: str | None) -> OfficialDocument:
    return OfficialDocument(
        document_id=f"datasf:{dataset.dataset_id}:{sha256[:12]}",
        record_type=dataset.record_type,
        source_url=source_url + (f"?$where={where}" if where else ""),
        sha256=sha256,
        retrieved_at=retrieved_at,
        status=dataset.status,
        crs="EPSG:4326",
        methodology=dataset.methodology or None,
    )
