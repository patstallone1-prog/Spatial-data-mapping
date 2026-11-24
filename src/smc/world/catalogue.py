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
    claddings = catalogue.get("claddings", {})
    for name, c in claddings.get("classes", {}).items():
        if c.get("material") not in materials:
            problems.append(f"cladding {name}: unknown base material {c.get('material')!r}")
        f = c.get("friction", {})
        if not all(0 <= f.get(k, -1) <= 1.5 for k in ("static", "dynamic", "wet")) or f["static"] < f["dynamic"]:
            problems.append(f"cladding {name}: friction out of range")
        if not (0 <= c.get("roughness", -1) <= 1 and 0 <= c.get("metalness", -1) <= 1):
            problems.append(f"cladding {name}: roughness and metalness must be in [0, 1]")
        if c.get("density_kg_m3", -1) <= 0 or not c.get("failure"):
            problems.append(f"cladding {name}: needs a density and a failure mode")
    for part, material in claddings.get("fixed_parts", {}).items():
        if part != "about" and material not in materials:
            problems.append(f"fixed part {part}: unknown material {material!r}")
    surfaces = catalogue.get("surfaces", {})
    for table in ("exact", "prefix"):
        for surface, archetype in surfaces.get(table, {}).items():
            if archetype not in archetypes:
                problems.append(f"surface {table} {surface!r} names unknown archetype {archetype!r}")
    problems += mechanics_problems(catalogue)
    if problems:
        raise ValueError("object catalogue: " + "; ".join(problems))


#: What every solid substance in the mechanics section must state for the engine
#: (docs/city/mechanics.mjs); a fluid needs only its family, density and sources.
MECHANICS_REQUIRED = ("family", "density_kg_m3", "E_gpa", "nu", "surface", "sources")
MECHANICS_FLUID = ("family", "density_kg_m3", "sources")
#: What a contactor (a hand, a sole, a blade's face) states for friction.
CONTACTOR_REQUIRED = ("adhesion", "hysteresis", "base", "moisture", "area_m2", "sources")


#: The shapes an archetype meets a blow with (mechanics.forms; docs/62 "Object on object").
FORM_SHAPES = ("box", "beam", "post", "panel", "round", "wall", "ground")


def mechanics_problems(catalogue: dict[str, Any]) -> list[str]:
    """Inconsistencies in the ``mechanics`` section: every material's substance exists, every
    implement, contactor and strike kind names one that does, and every cited source is listed."""
    problems: list[str] = []
    mx = catalogue.get("mechanics")
    if not isinstance(mx, dict):
        return ["mechanics section missing"]
    subs, sources = mx.get("substances", {}), mx.get("sources", {})
    for name, m in catalogue.get("materials", {}).items():
        key = m.get("mechanics", "missing")
        if name == "none":
            if key is not None:
                problems.append("material none: mechanics must be null")
        elif key not in subs:
            problems.append(f"material {name}: unknown mechanics substance {key!r}")
    for name, s in subs.items():
        fluid = s.get("family") == "fluid"
        for field in MECHANICS_FLUID if fluid else MECHANICS_REQUIRED:
            if field not in s:
                problems.append(f"substance {name}: missing {field}")
        if not fluid and not s.get("E_gpa", 0) > 0:
            problems.append(f"substance {name}: E_gpa must be positive")
        if not fluid and not 0 <= s.get("nu", -1) < 0.5:
            problems.append(f"substance {name}: nu must be in [0, 0.5)")
        for src in s.get("sources", []):
            if src not in sources:
                problems.append(f"substance {name}: unlisted source {src!r}")
    for table in ("implements", "contactors"):
        for name, item in mx.get(table, {}).items():
            if name == "about":
                continue
            if table == "implements" and item.get("substance") not in subs:
                problems.append(f"implement {name}: unknown substance {item.get('substance')!r}")
            if table == "contactors":
                for field in CONTACTOR_REQUIRED:
                    if field not in item:
                        problems.append(f"contactor {name}: missing {field}")
            for src in item.get("sources", []):
                if src not in sources:
                    problems.append(f"{table[:-1]} {name}: unlisted source {src!r}")
    for kind, substance in mx.get("item_materials", {}).items():
        if kind != "about" and substance not in subs:
            problems.append(f"item material {kind}: unknown substance {substance!r}")
    implements = mx.get("implements", {})
    for kind, implement in mx.get("strike_kinds", {}).items():
        if kind != "about" and implement not in implements:
            problems.append(f"strike kind {kind}: unknown implement {implement!r}")
    # Coats are layers of their own (docs/city/mechanics-collide.mjs): each names a substance and
    # has a thickness and an adhesion; claddings and archetype forms name coats that exist.
    coats = mx.get("coatings", {})
    for name, coat in coats.items():
        if name == "about":
            continue
        if coat.get("substance") not in subs:
            problems.append(f"coat {name}: unknown substance {coat.get('substance')!r}")
        for field in ("thickness_um", "adhesion_mpa"):
            if not coat.get(field, 0) > 0:
                problems.append(f"coat {name}: {field} must be positive")
        for src in coat.get("sources", []):
            if src not in sources:
                problems.append(f"coat {name}: unlisted source {src!r}")
    classes = catalogue.get("claddings", {}).get("classes", {})
    for cladding, coat in mx.get("cladding_coats", {}).items():
        if cladding == "about":
            continue
        if cladding not in classes:
            problems.append(f"cladding coat {cladding}: unknown cladding class")
        if coat is not None and coat not in coats:
            problems.append(f"cladding coat {cladding}: unknown coat {coat!r}")
    archetypes = catalogue.get("archetypes", {})
    for arch, form in mx.get("forms", {}).items():
        if arch == "about":
            continue
        if arch not in archetypes:
            problems.append(f"form {arch}: unknown archetype")
        if form.get("shape") not in FORM_SHAPES:
            problems.append(f"form {arch}: unknown shape {form.get('shape')!r}")
        if form.get("shape") in ("beam", "post", "round", "panel", "box") and not form.get("section"):
            problems.append(f"form {arch}: a {form.get('shape')} needs a section")
        if "substance" in form and form["substance"] not in subs:
            problems.append(f"form {arch}: unknown substance {form['substance']!r}")
        if form.get("coat") is not None and form["coat"] not in coats:
            problems.append(f"form {arch}: unknown coat {form['coat']!r}")
    return problems


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


def cladding(wall_class: str, catalogue: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """What a wall of this photographed class is: its properties and the base material's id."""
    return (catalogue or load()).get("claddings", {}).get("classes", {}).get(wall_class)


def physical_material(material_id: str, catalogue: dict[str, Any] | None = None) -> dict[str, Any]:
    """An engine physical material: friction, restitution and density (g/cm^3 for Unreal)."""
    m = (catalogue or load())["materials"][material_id]
    return {"id": material_id, "friction": m["friction"]["dynamic"], "static_friction": m["friction"]["static"],
            "wet_friction": m["friction"]["wet"], "restitution": m["restitution"],
            "density_g_cm3": round(m["density_kg_m3"] / 1000, 4), "sound": m["sound"]}
