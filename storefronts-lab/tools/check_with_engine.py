"""Run Kerbside's own exterior engine on the lab's hand-off programs (contract check).

    ../.venv/bin/python tools/check_with_engine.py out/marina-union/exterior_programs_chestnut.json

This is the one place the lab touches ``smc``, and only to *consume* its output the way the
engine would: every program must parse (``ExteriorInput.from_json``), infer and validate.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kerbfront.config import kerbside_root  # noqa: E402

sys.path.insert(0, str(kerbside_root() / "src"))
from smc.exteriors.engine import infer_exterior  # noqa: E402
from smc.exteriors.model import ExteriorInput  # noqa: E402
from smc.exteriors.validate import validate_exterior  # noqa: E402


def main(path: str) -> None:
    progs = json.loads(Path(path).read_text())
    outcome: Counter = Counter()
    errors: Counter = Counter()
    cats: Counter = Counter()
    for p in progs:
        try:
            plan = infer_exterior(ExteriorInput.from_json(p))
            validate_exterior(plan)
            outcome["ok"] += 1
            for t in plan.get("tenants", []) if isinstance(plan, dict) else []:
                cats[t.get("category") or t.get("profile")] += 1
        except Exception as e:  # noqa: BLE001 - tallying every refusal is the point
            outcome["refused"] += 1
            errors[str(e)[:90]] += 1
    print(json.dumps({"programs": len(progs), **outcome, "refusals": errors.most_common(8),
                      "categories": cats.most_common(12)}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
