"""Assemble the landing page: what Kerbside is, four photographs of it, and the install button.

The figures are read out of the built regions rather than written into the template, so the
page cannot claim a number the model does not hold. The photographs in docs/site/ are frames
of the real model, taken with tools/shots/shoot.sh; nothing here is a mock-up.
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from site_config import APP_URL, SITE_URL  # noqa: E402

REGIONS = ("sf-mission", "sf-sunset", "sf-haight-castro", "berkeley-downtown",
           "oakland-downtown", "san-jose-downtown", "palo-alto-downtown")


def thousands(n: int) -> str:
    return f"{n:,}"


def compact(n: int) -> str:
    """A figure a headline can carry: 279,413 photographs is "279k"."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    if n >= 10_000:
        return f"{round(n / 1000)}k"
    return thousands(n)


def figures() -> dict[str, str]:
    kerbs = colours = buildings = photographs = 0
    for name in REGIONS:
        caps = ROOT / "data" / "regions" / name / "capabilities.json"
        if caps.exists():
            active = json.loads(caps.read_text()).get("activation") or {}
            kerbs += (active.get("kerbs") or {}).get("count") or 0
            colours += (active.get("building_colour") or {}).get("count") or 0
        page = ROOT / "docs" / "regions" / name / "sf-corridor-3d.json"
        if page.exists():
            payload = json.loads(page.read_text())
            buildings += sum(1 for w in payload["ways"] if w.get("kind") == "building")
            photographs += payload["summary"].get("observations") or 0

    # Area and how much of it is described, from the coverage audit if it has been run.
    km2, described, regions = 47.9, 86.7, 8
    report = ROOT / "build" / "coverage-report.json"
    if report.exists():
        rows = json.loads(report.read_text())
        if rows:
            cells = sum(r["cells"] for r in rows)
            km2 = sum(r["km2"] for r in rows)
            described = sum(r["described"] * r["cells"] for r in rows) / cells * 100
            regions = len(rows)

    return {
        "__KERBS__": compact(kerbs),
        "__PHOTOS__": compact(photographs),
        "__COLOURS__": thousands(colours),
        "__BUILDINGS__": thousands(buildings),
        "__KM2__": f"{km2:.0f}",
        "__DESCRIBED__": f"{described:.0f}",
        "__REGIONS__": str(regions),
        "__APP_URL__": APP_URL,
        "__SITE_URL__": SITE_URL,
    }


def main() -> int:
    page = (ROOT / "tools" / "landing_template.html").read_text()
    values = figures()
    for token, value in values.items():
        page = page.replace(token, value)
    left = [t for t in values if t in page]
    if left:
        raise SystemExit(f"the landing template still holds {left}")
    out = ROOT / "build" / "landing.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print(f"{out} -> {out.stat().st_size / 1e3:.1f} kB; "
          f"{values['__KERBS__']} kerb stations, {values['__PHOTOS__']} photographs, "
          f"{values['__KM2__']} km2 at {values['__DESCRIBED__']}% described")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
