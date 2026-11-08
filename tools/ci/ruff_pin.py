"""Print the ruff requirement pinned in pyproject's dev extra (e.g. ``ruff==0.16.4``).

CI installs it and ``make lint`` runs it, so the linter's version is set in one place.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def ruff_pin() -> str:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    pins = [dep for dep in config["project"]["optional-dependencies"]["dev"] if dep.startswith("ruff")]
    if len(pins) != 1 or "==" not in pins[0]:
        raise SystemExit("pyproject's dev extra must pin ruff exactly once (ruff==X.Y.Z)")
    return pins[0]


if __name__ == "__main__":
    print(ruff_pin())
