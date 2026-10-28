"""The object catalogue: what each kind of thing in a world is made of, how it is passed and how it breaks.

``docs/object-catalogue.json`` is the one copy. The page reads it (``docs/object-catalogue.mjs``),
the Unreal importer reads it (``tools/unreal/setup_world.py``), and this module validates it and
answers the same questions in Python. Three layers:

* a **material** -- density, shoe friction (static, dynamic, wet), restitution, sound, and how it
  fails;
* an **archetype** -- what a street light or a tree generally is: its material, what it blocks,
  how a player passes it, its durability and the interactions it supports;
* the **instance** the renderer draws, named by its surface. The instance keeps its own basis
  (measured, mapped, inferred); the archetype never depends on it, so an inferred tree is as
  solid as a surveyed one and is still reported as inferred.

The values are archetype estimates from typical published figures, not measurements of any
particular object.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

SCHEMA = "kerbside.object_catalogue/1"
CATALOGUE_PATH = Path(__file__).resolve().parents[3] / "docs" / "object-catalogue.json"

TRAVERSALS = frozenset({"walk_on", "step_over", "climb_over", "go_around", "walk_under",
                        "pass_through", "swim", "enter"})
COLLISION_SOURCES = frozenset({"ground", "footprint", "mesh", "explicit", "host", "none"})
BLOCKABLE = frozenset({"character", "vehicle", "projectile", "vision"})
#: What a player cannot walk through at body height.
SOLID_TRAVERSALS = frozenset({"climb_over", "go_around", "enter"})
#: What a player passes through, under or swims in.
SOFT_TRAVERSALS = frozenset({"pass_through", "walk_under", "swim"})


def validate(catalogue: dict[str, Any]) -> None:
    """Raise ValueError naming every inconsistency; return quietly when there are none."""
    problems: list[str] = []
    if catalogue.get("schema") != SCHEMA:
        problems.append(f"schema is {catalogue.get('schema')!r}, not {SCHEMA}")
    player = catalogue.get("player", {})
    for key in ("interaction_radius_m", "walker_radius_m", "step_height_m", "head_clearance_m"):
        if not isinstance(player.get(key), (int, float)) or player[key] <= 0:
            problems.append(f"player.{key} must be a positive number")
    materials, archetypes = catalogue.get("materials", {}), catalogue.get("archetypes", {})
    for name, m in materials.items():
        f = m.get("friction", {})
        for key in ("static", "dynamic", "wet"):
            if not 0 <= f.get(key, -1) <= 1.5:
                problems.append(f"material {name}: friction.{key} out of range")
        if name != "none" and f.get("static", 0) < f.get("dynamic", 0):
            problems.append(f"material {name}: static friction below dynamic")
        if not 0 <= m.get("restitution", -1) <= 1:
            problems.append(f"material {name}: restitution out of range")
        if m.get("density_kg_m3", -1) < 0 or not m.get("failure"):
            problems.append(f"material {name}: needs a density and a failure mode")
    for name, a in archetypes.items():
        if a.get("material") not in materials:
            problems.append(f"archetype {name}: unknown material {a.get('material')!r}")
        if a.get("traversal") not in TRAVERSALS:
            problems.append(f"archetype {name}: unknown traversal {a.get('traversal')!r}")
        collision = a.get("collision", {})
        if collision.get("source") not in COLLISION_SOURCES:
            problems.append(f"archetype {name}: unknown collision source {collision.get('source')!r}")
        if set(collision.get("blocks", [])) - BLOCKABLE:
            problems.append(f"archetype {name}: blocks something unknown")
        durability = a.get("durability", {})
        if durability.get("level") not in (0, 1, 2, 3) or not durability.get("breaks"):
            problems.append(f"archetype {name}: durability needs a level and how it breaks")
        if not 0 < a.get("speed", 0) <= 1:
            problems.append(f"archetype {name}: speed must be in (0, 1]")
        # Solid at body height stops a player; soft, overhead or water never does.
        stops = "character" in collision.get("blocks", [])
        if a.get("traversal") in SOLID_TRAVERSALS and not stops:
            problems.append(f"archetype {name}: {a.get('traversal')} but does not block a character")
        if a.get("traversal") in SOFT_TRAVERSALS and stops:
            problems.append(f"archetype {name}: {a.get('traversal')} but blocks a character")
        if "casts" not in a.get("shadow", {}):
            problems.append(f"archetype {name}: shadow.casts missing")
    surfaces = catalogue.get("surfaces", {})
    for table in ("exact", "prefix"):
        for surface, archetype in surfaces.get(table, {}).items():
            if archetype not in archetypes:
                problems.append(f"surface {table} {surface!r} names unknown archetype {archetype!r}")
    if problems:
        raise ValueError("object catalogue: " + "; ".join(problems))


@lru_cache(maxsize=4)
def load(path: str | Path = CATALOGUE_PATH) -> dict[str, Any]:
    catalogue = json.loads(Path(path).read_text())
    validate(catalogue)
    return catalogue


def normalise(surface: str) -> str:
    """The catalogue's spelling of a renderer surface name.

    Drops a ``|`` suffix (the exporter's material key), reads the first space as ``:`` (the page
    writes both ``furniture street_light`` and ``furniture:street_light``), and lowercases.
    """
    name = str(surface).split("|")[0].strip().lower()
    return name.replace(" ", ":", 1)


def resolve(surface: str, catalogue: dict[str, Any] | None = None) -> str | None:
    """The archetype id for a surface name: exact first, then the longest prefix; else None."""
    cat = catalogue or load()
    exact, prefix = cat["surfaces"]["exact"], cat["surfaces"]["prefix"]
    name = normalise(surface)
    if name in exact:
        return exact[name]
    if name.endswith("_post") and name[:-5] in exact:
        return exact[name[:-5]]
    best = max((p for p in prefix if name.startswith(p)), key=len, default=None)
    return prefix[best] if best else None


def archetype(surface: str, catalogue: dict[str, Any] | None = None) -> dict[str, Any] | None:
    cat = catalogue or load()
    key = resolve(surface, cat)
    return {"id": key, **cat["archetypes"][key]} if key else None


def blocks_player(surface: str, catalogue: dict[str, Any] | None = None) -> bool:
    """Whether the surface is solid to a walking player in a world that draws it as a mesh.

    The walkable ground (``walk_on``) blocks too: it is what the player stands on.
    """
    a = archetype(surface, catalogue)
    if a is None:
        raise ValueError(f"surface {surface!r} is not in the object catalogue")
    return "character" in a["collision"]["blocks"]


def physical_material(material_id: str, catalogue: dict[str, Any] | None = None) -> dict[str, Any]:
    """An engine physical material: friction, restitution and density (g/cm^3 for Unreal)."""
    m = (catalogue or load())["materials"][material_id]
    return {"id": material_id, "friction": m["friction"]["dynamic"], "static_friction": m["friction"]["static"],
            "wet_friction": m["friction"]["wet"], "restitution": m["restitution"],
            "density_g_cm3": round(m["density_kg_m3"] / 1000, 4), "sound": m["sound"]}
