"""Reuse Kerbside's downloadable textured assets with role/style/scale matching."""

from __future__ import annotations

import json
from pathlib import Path

from smc.interiors.inference.model import seed_for

ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MANIFEST = ROOT / "docs/interior-assets/manifest.json"

# Prices are reproducible selection allowances, never represented as real product prices.
ROLE_COST = {
    "bed": 1100,
    "sofa": 1400,
    "dining_table": 650,
    "dining_chair": 120,
    "coffee_table": 260,
    "nightstand": 170,
    "dresser": 450,
    "desk": 450,
    "armchair": 450,
    "bookshelf": 320,
    "counter_item": 24,
    "table_item": 30,
    "ceiling_lamp": 150,
    "plant": 75,
    "picture": 90,
}


def asset_style(asset_id: str) -> str:
    return (
        "traditional"
        if asset_id.lower()
        in {
            "sofa_01",
            "sofa_02",
            "sofa_03",
            "painted_wooden_sofa",
            "khronos_sheenwoodleathersofa",
            "armchair_01",
            "coffeetable_01",
            "gallinera_table",
            "rockingchair_01",
        }
        or any(
            w in asset_id.lower()
            for w in ("gothic", "classic", "vintage", "chinese", "worn", "old_")
        )
        else "contemporary"
    )


class Catalog:
    def __init__(self, path: Path = DEFAULT_MANIFEST):
        self.path = path
        self.assets = json.loads(path.read_text())["assets"] if path.exists() else []
        self.assets = [
            a
            for a in self.assets
            if (path.parent / a["model"]).is_file() and a.get("license") in {"CC0-1.0", "CC-BY-4.0"}
        ]

    def choose(self, role: str, style: dict, size: tuple[float, float, float], key: str) -> dict:
        source_role = "dining_chair" if role == "office_chair" else role
        rows = [r for r in self.assets if r.get("role", r.get("kind")) == source_role]
        if style.get("usage") == "restaurant":
            if style["tier"] == "economy" and role in {"dining_chair", "dining_table"}:
                rows = [r for r in rows if "metal" in r["id"].lower()]
            elif role in {"dining_chair", "dining_table"}:
                rows = [r for r in rows if r.get("style", asset_style(r["id"])) == style["style"]]
        if role in {"sofa", "bed"}:
            # Do not force an ornate source model into a contemporary palette simply
            # because that role exists. A matching parametric piece is a valid fallback.
            rows = [r for r in rows if r.get("style", asset_style(r["id"])) == style["style"]]
        if not rows:
            return {
                "id": f"procedural:{role}",
                "role": role,
                "procedural": True,
                "license": "project",
                "source": "Kerbside parametric fixture",
                "estimated_cost_usd": round(
                    ROLE_COST.get(role, 300)
                    * {"economy": 0.65, "standard": 1, "premium": 1.9}[style["tier"]]
                ),
            }
        scored = []
        for row in rows:
            bounds = row.get("dimensions_m")
            distortion = 0.0
            if bounds and min(bounds) > 0:
                ratios = [a / b for a, b in zip(size, bounds, strict=True)]
                distortion = max(ratios) / min(ratios) - 1
            match = 0 if row.get("style", asset_style(row["id"])) == style["style"] else 2
            tier = row.get("tier", "standard")
            price = (
                ROLE_COST.get(role, 100) * {"economy": 0.65, "standard": 1, "premium": 1.9}[tier]
            )
            allowance = (
                ROLE_COST.get(role, 100)
                * {"economy": 0.8, "standard": 1.2, "premium": 2}[style["tier"]]
            )
            score = match + min(2, distortion) + max(0, price / allowance - 1)
            score += (seed_for(key + row["id"]) % 1000) / 5000
            scored.append((score, row, price))
        _, row, price = min(scored, key=lambda x: x[0])
        return {
            k: row[k]
            for k in (
                "id",
                "model",
                "license",
                "source",
                "attribution",
                "dimensions_m",
                "style",
                "tier",
            )
            if k in row
        } | {"role": role, "estimated_cost_usd": round(price), "procedural": False}
