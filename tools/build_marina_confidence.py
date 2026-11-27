"""Write docs/marina-confidence.json: a confidence for every Marina intersection and kerb island,
and for the ground round each (smc.facts.marina_confidence; docs/74)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.facts.marina_confidence import build  # noqa: E402


def main() -> None:
    out = build(ROOT)
    path = ROOT / "docs" / "marina-confidence.json"
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(json.dumps({"summary": out["summary"], "calibration": out["calibration"]}, indent=1))


if __name__ == "__main__":
    main()
