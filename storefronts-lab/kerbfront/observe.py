"""Photo observations: what a person (or a later automatic stage) read off named frames.

``observations/<model id>.json`` holds changes to a model, each with the frame it was read
from. They are applied on top of the pipeline defaults every time a model is rebuilt, so a
rebuild after a new sweep keeps what the photographs said. A path is a dotted path into the
model (``storefronts.0.awnings``, ``walls.3.colour``); ``value`` replaces what is there and
``evidence`` (required) is stored in ``model["evidence"][path]``.

    {"model": "a16", "observations": [
       {"path": "walls.4.colour", "value": "#e8dcc8",
        "evidence": {"frame": "123", "how": "rectified facade, median of wall pixels"}}]}
"""

from __future__ import annotations

import json
from pathlib import Path

from .config import LAB

OBS = LAB / "observations"


def _set(obj, path: str, value):
    keys = path.split(".")
    for k in keys[:-1]:
        obj = obj[int(k)] if isinstance(obj, list) else obj.setdefault(k, {})
    last = keys[-1]
    if isinstance(obj, list):
        obj[int(last)] = value
    else:
        obj[last] = value


def apply_observations(model: dict, path: Path | None = None) -> int:
    path = path or OBS / f"{model['id']}.json"
    if not path.exists():
        return 0
    rows = json.loads(path.read_text())["observations"]
    ev = model.setdefault("evidence", {})
    for r in rows:
        if "evidence" not in r:
            raise ValueError(f"observation {r['path']} has no evidence")
        _set(model, r["path"], r["value"])
        ev[r["path"]] = {"kind": "observed", **r["evidence"]}
    model["observations_applied"] = len(rows)
    return len(rows)
