"""Solved camera orientations for the frames a facade job uses, fetched once and kept.

The catalogue carries each frame's position and compass heading, and for most Mapillary frames
those are already the structure-from-motion solution. What it does not carry is the rest of
the orientation -- pitch and roll -- or the solved lens, and a facade rectified with a camera
assumed level comes out slanted, or upside down for a panorama whose seam lands in the wrong
place. Mapillary publishes the full solved rotation (``computed_rotation``, an angle-axis vector,
world-to-camera in OpenSfM's convention) and the lens (``camera_parameters``: focal as a
fraction of the larger dimension, then k1, k2).

Fetched in batches of fifty and appended to a journal as they arrive, so an interrupted run
loses nothing and a rerun asks only for what it has not seen. A frame Mapillary has no solution
for is journaled as missing, so it is not asked for again.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from smc.curbmeasure.geometry import rodrigues
from smc.net import fetch

API = "https://graph.mapillary.com/images"
FIELDS = "id,computed_rotation,camera_type,camera_parameters,width,height,merge_cc"
BATCH = 50
ATTEMPTS = 5


@dataclass(frozen=True)
class SolvedPose:
    rotation: tuple[float, ...]   # 3x3 world-to-camera, row-major
    spherical: bool
    focal_fraction: float | None
    k1: float
    k2: float
    width: int | None
    height: int | None
    #: The reconstruction this frame was solved in. Poses are mutually consistent only within
    #: one: two frames from different components were never registered to each other.
    merge_cc: str | None = None

    def focal_px(self, width: int, height: int) -> float | None:
        if self.focal_fraction is None:
            return None
        return self.focal_fraction * max(width, height)


#: Per read, and for the whole response (see smc.net.read_by for why both).
READ_TIMEOUT_S = 60
DEADLINE_S = 120


def _token() -> str:
    for name in ("MAPILLARY_TOKEN", "MAPILLARY_ACCESS_TOKEN"):
        if os.environ.get(name):
            return os.environ[name]
    raise RuntimeError("set MAPILLARY_TOKEN (in .env.local) to fetch solved orientations")


def _pose(row: dict) -> SolvedPose | None:
    rotation = row.get("computed_rotation")
    if not rotation or len(rotation) != 3:
        return None
    params = row.get("camera_parameters") or []
    spherical = row.get("camera_type") in ("spherical", "equirectangular")
    return SolvedPose(tuple(float(v) for v in rodrigues(tuple(rotation)).ravel()), spherical,
                      float(params[0]) if params and not spherical else None,
                      float(params[1]) if len(params) > 1 else 0.0,
                      float(params[2]) if len(params) > 2 else 0.0,
                      row.get("width"), row.get("height"),
                      str(row["merge_cc"]) if row.get("merge_cc") is not None else None)


class PoseStore:
    """A journal of solved orientations by Mapillary image id."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.poses: dict[str, SolvedPose | None] = {}
        self.lock = threading.Lock()
        if path.exists():
            for line in path.read_text().splitlines():
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self.poses[str(row["id"])] = None if row.get("missing") else _pose(row)

    def get(self, image_id: str) -> SolvedPose | None:
        return self.poses.get(str(image_id))

    def fetch(self, ids: list[str], progress=print) -> int:
        """Ask for every id not yet journaled. Returns how many were solved."""
        wanted = sorted({str(i) for i in ids} - set(self.poses))
        if not wanted:
            return 0
        token = _token()
        solved = 0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for start in range(0, len(wanted), BATCH):
            chunk = wanted[start:start + BATCH]
            rows = self._request(chunk, token)
            found = {str(r["id"]): r for r in rows}
            lines = []
            for image_id in chunk:
                row = found.get(image_id)
                pose = _pose(row) if row else None
                self.poses[image_id] = pose
                solved += pose is not None
                lines.append(json.dumps(row if pose is not None else {"id": image_id,
                                                                      "missing": True}))
            with self.lock, self.path.open("a") as fh:
                fh.write("\n".join(lines) + "\n")
            if (start // BATCH) % 40 == 0:
                progress(f"  orientations: {start + len(chunk)}/{len(wanted)} asked, "
                         f"{solved} solved")
        return solved

    @staticmethod
    def _request(ids: list[str], token: str) -> list[dict]:
        query = urllib.parse.urlencode({"image_ids": ",".join(ids), "fields": FIELDS})
        request = urllib.request.Request(f"{API}?{query}",
                                         headers={"Authorization": f"OAuth {token}"})
        last: Exception | None = None
        for attempt in range(ATTEMPTS):
            if attempt:
                time.sleep(2.0 * 2 ** (attempt - 1))
            try:
                return json.loads(fetch(request, DEADLINE_S, READ_TIMEOUT_S)).get("data", [])
            except urllib.error.HTTPError as exc:
                if exc.code < 500 and exc.code != 429:
                    raise
                last = exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = exc
        raise RuntimeError(f"orientation lookup failed after {ATTEMPTS} attempts: {last}")
