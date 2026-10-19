"""A finished cell, tested automatically: passed into the release, or held for a person.

The tests are the project's own, unchanged:

1. The cell's journal shows every stage of its chain done -- including ``audit``, the render
   audit (``scripts/audit_corridor_render.py``) the ingester runs against the cell's baseline.
2. The cell has a payload to publish.
3. The Marina parity audit (``scripts/audit_region_parity.py``), run on the cell's own build by
   the same rules as on a published region: every evidence share at least 75 % of the Marina
   reference's (the audit's own screen, not loosened here) and no issue raised -- missing
   sampled colours, ground records not served, failed or retrying lidar cells, no trees or
   yards.

A cell that passes all three is published. One that fails any is **held**, with every reason,
for a person to approve, reject or send back (``smc-cloud review``); nothing downstream of it
moves until then, and nothing else waits on it. The gate never edits the cell.
"""

from __future__ import annotations

import functools
import json
import runpy
from pathlib import Path

#: The audit's own screen (scripts/audit_region_parity.py audit()): a share under 75 % of the
#: Marina reference's is a gap. Kept equal to it; a test holds the two together.
SHARE_SCREEN = 0.75


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


def evaluate(root: Path, cell: str, chain: tuple[str, ...] | list[str]) -> dict:
    """The verdict on ``data/regions/<cell>`` as it stands under ``root``."""
    root = Path(root)
    base = root / "data/regions" / cell
    reasons: list[str] = []
    try:
        journal = json.loads((base / "ingest.json").read_text())
    except (OSError, ValueError):
        journal = {}
    stages = journal.get("stages", {})
    unfinished = [s for s in chain if stages.get(s, {}).get("status") != "done"]
    if unfinished:
        reasons.append(f"stages not done: {', '.join(unfinished)}")
    site = base / "site"
    if not (site / "sf-corridor-3d.json").is_file():
        reasons.append("no payload (site/sf-corridor-3d.json)")
        return {"decision": "hold", "reasons": reasons, "cell": cell}
    parity = _parity(str(root))
    row = parity["audit_region"](root, root, cell, site=site)
    reference = reference_metrics(str(root))
    gaps = {}
    for name, value in row.get("metrics", {}).items():
        ref = reference[name]["share"]
        share = value["share"]
        if ref and share is not None and share < ref * SHARE_SCREEN:
            gaps[name] = {"share": share, "reference": ref}
    for name, gap in gaps.items():
        reasons.append(f"{name}: {gap['share']:.3f} against Marina's {gap['reference']:.3f} "
                       f"(under {SHARE_SCREEN:.0%})")
    reasons.extend(row.get("issues", []))
    return {
        "decision": "pass" if not reasons else "hold",
        "reasons": reasons,
        "cell": cell,
        "metrics": row.get("metrics", {}),
        "reference": {k: v["share"] for k, v in reference.items()},
        "kerb_grades": row.get("kerb_grades", {}),
        "counts": row.get("counts", {}),
        "payload_sha256": row.get("payload", {}).get("sha256"),
        "rule": f"every share at least {SHARE_SCREEN:.0%} of the Marina reference, no issues, "
                "every stage done",
    }
