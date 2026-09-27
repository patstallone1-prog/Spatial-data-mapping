"""Where a region's inputs and outputs live.

The corridor was built first and its paths are the project's originals: the page in ``docs/``,
the photographs in ``data/sf_corridor/``, the derived records in ``data/sf_public_works/``.
Every region since keeps the same files under ``data/regions/<name>/``. Three builders --
the building colours, the facade fingerprints and the ground cover -- were written against
the corridor's paths directly and so could only ever describe the corridor, which is why
every other city has been drawn without a sampled colour, without a facade and without a
garden, on photographs that were harvested years ago and never looked at.

One function, so a builder takes ``--region`` and nothing else changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from smc.imagery.region import SF_CORRIDOR, Region, get_region

ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class RegionPaths:
    """The files a builder reads and writes for one region."""

    region: Region
    site: Path
    """Where the region's page and its sidecars are written."""
    catalog: Path
    """The observation catalogue: the photographs harvested for this region."""
    official: Path
    """The derived records a build reads: colours, fingerprints, ground cover, kerbs."""
    work: Path
    """Scratch for a builder's own checkpoints, one directory per region."""

    @property
    def page(self) -> Path:
        return self.site / "sf-corridor-3d.json"

    @property
    def observations(self) -> Path:
        return self.catalog / "observations" / "external-000.parquet"

    def bbox(self) -> dict[str, float]:
        box = self.region.bbox
        return {"south": box.south, "west": box.west, "north": box.north, "east": box.east}


def region_paths(name: str, *, work: str = "region-work") -> RegionPaths:
    """The paths for ``name``; the corridor keeps the originals it was built with."""
    region = get_region(name)
    corridor = region.name == SF_CORRIDOR.name
    base = ROOT / "data" / "regions" / region.name
    return RegionPaths(
        region=region,
        site=ROOT / "docs" if corridor else base / "site",
        catalog=ROOT / "data" / "sf_corridor" if corridor else base / "catalog",
        official=ROOT / "data" / "sf_public_works" if corridor else base / "official",
        work=ROOT / "build" / work / region.name,
    )


def region_city(name: str) -> str | None:
    """Which city a region belongs to, as the registry records it; None for the corridor's
    own entry, which is San Francisco by construction."""
    import json

    if name == SF_CORRIDOR.name:
        return "san-francisco"
    registry = ROOT / "data" / "regions" / "regions.json"
    if not registry.exists():
        return None
    for row in json.loads(registry.read_text()).get("regions", []):
        if row.get("name") == name:
            return row.get("city")
    return None
