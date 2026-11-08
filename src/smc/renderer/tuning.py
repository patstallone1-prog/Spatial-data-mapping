"""How the page is cut for where it is read, and the code a released window runs.

Moved out of ``scripts/build_sf_corridor_3d.py`` with the page itself (``smc.renderer.template``)
so the deploy build can tune the page without the data pipeline's packages.
"""

from __future__ import annotations

import hashlib
import re

from smc.renderer.template import ROOT

#: How finely the ground is cut, by where the page is going to be read.
#:
#: The site build has to arrive over the network into a browser tab and stay interactive there,
#: so its lattice stops at four metres: past that the corridor went to 83 ms a frame for a last
#: few centimetres nobody can see. The app is a mirror already on the device with no page weight
#: to keep to and no tab to share a GPU with, so it is cut as finely as the two-metre terrain
#: grid can justify -- and the covers the site leaves on one spacing, the pavement underlay and
#: the parking lots, follow the ground there too.
DETAIL_TUNING = {
    "app": {
        "const LATTICE_BY_INCLINE = [\n  [600, 4.0],   // a cliff, a stair, a retaining wall\n"
        "  [300, 6.0],\n  [150, 8.0],\n  [60, 12.0],\n  [0, 16.0],    // flat ground: as it was\n];":
        # The fine cut at High and Max; Low and Medium keep the site's (QUALITY_PRESETS.fineGround),
        # so a machine that cannot hold the fine ground can be told to load the lighter one.
        "const LATTICE_BY_INCLINE = QUALITY().fineGround ? [\n  [300, 1.5],   // finer than the terrain grid, where the grid earns it\n"
        "  [150, 2.0],\n  [60, 3.0],\n  [20, 4.0],\n  [0, 8.0],     // flat ground, still cut four times finer\n] : [\n"
        "  [600, 4.0],\n  [300, 6.0],\n  [150, 8.0],\n  [60, 12.0],\n  [0, 16.0],\n];",
        "const LATTICE_DRAWN_MAX_M = 12.0;": "const LATTICE_DRAWN_MAX_M = QUALITY().fineGround ? 6.0 : 12.0;",
        "const LATTICE_BUSY_RINGS = 6;": "const LATTICE_BUSY_RINGS = QUALITY().fineGround ? 3 : 6;",
        "  walk_underlay: [TERRAIN_REFINE_M, TERRAIN_UNDER_CHORD_M],":
        "  walk_underlay: QUALITY().fineGround ? [TERRAIN_REFINE_M, TERRAIN_UNDER_CHORD_M, undefined, false, true]"
        " : [TERRAIN_REFINE_M, TERRAIN_UNDER_CHORD_M],",
        "  parking_lot: [12.0, 0], front_walk: [12.0, 0],":
        "  parking_lot: QUALITY().fineGround ? [12.0, 0, undefined, false, true] : [12.0, 0],"
        " front_walk: QUALITY().fineGround ? [12.0, 0, undefined, false, true] : [12.0, 0],",
    },
    "site": {},
}


def release_module_scope(html: str) -> str:
    """What a released window runs to let go of its module's top-level names.

    A window's code is a module and is never unloaded, so whatever its top-level names point at
    stays for as long as the page does. Read from the module's own declarations (at the left
    margin): each `let` and `var` is pointed at nothing, and each Map, Set and list made there is
    emptied. Each in its own try: a name read wrongly costs nothing."""
    at = html.find("/*__RELEASE_MODULE_SCOPE__*/")
    if at < 0:
        return ""
    # The script element round it: its tags at the left margin (the code itself mentions them).
    starts = [m.start() for m in re.finditer(r"^<script\b[^>]*>", html[:at], re.M)]
    end = re.compile(r"^</script>", re.M).search(html, at)
    module = html[starts[-1] if starts else 0:end.start() if end else len(html)]
    keep = {"ATTACH", "META", "metaLibrary"}
    names, emptied = [], []
    for match in re.finditer(r"^(?:let|var) ([A-Za-z_$][\w$]*)", module, re.M):
        if match.group(1) not in keep and match.group(1) not in names:
            names.append(match.group(1))
    for match in re.finditer(r"^const ([A-Za-z_$][\w$]*) = (new (?:Map|Set)\(|\[\];)", module, re.M):
        emptied.append((match.group(1), "clear()" if match.group(2).startswith("new") else "length = 0"))
    lines = [f"try {{ {name} = null; }} catch (error) {{ /* kept */ }}" for name in names]
    lines += [f"try {{ {name}.{how}; }} catch (error) {{ /* kept */ }}" for name, how in emptied]
    return "\n  ".join(lines)


def tuned(html: str, detail: str) -> str:
    """The page, cut for where it is going to be read."""
    streaming_hash = hashlib.sha256((ROOT / "docs/world-streaming.mjs").read_bytes()).hexdigest()[:16]
    html = html.replace("__WORLD_STREAMING_HASH__", streaming_hash)
    for key, filename in (("GRASS_STRANDS", "grass-strands.mjs"), ("NATURE_RUNTIME", "nature-runtime.mjs"),
                          ("FOLIAGE_MOTION", "foliage-motion.mjs"), ("FOREST_FLOOR", "forest-floor.mjs"),
                          ("GLOBE", "globe.mjs"), ("TELEPORT_MAP", "teleport-map.mjs"), ("META_XR", "meta-xr.mjs"),
                          ("OBJECT_CATALOGUE", "object-catalogue.mjs"), ("OBJECT_CATALOGUE_DATA", "object-catalogue.json"),
                          ("EXTERIOR_EDITOR", "exterior-editor.mjs"), ("MULTIPLAYER", "multiplayer.mjs"),
                          ("KERBSIDE_ACCOUNT", "kerbside-account.mjs"), ("HOME_LOBBY", "home-lobby.mjs"),
                          ("AVATAR_BUILDER", "avatar-builder.mjs")):
        html = html.replace(f"__{key}_HASH__", hashlib.sha256((ROOT / "docs" / filename).read_bytes()).hexdigest()[:16])
    # The living city is several modules and its rules: one revision for all of them.
    city = hashlib.sha256()
    for path in sorted((ROOT / "docs" / "city").glob("*")):
        city.update(path.name.encode())
        city.update(path.read_bytes())
    html = html.replace("__CITY_HASH__", city.hexdigest()[:16])
    html = html.replace("/*__RELEASE_MODULE_SCOPE__*/", release_module_scope(html), 1)
    swaps = DETAIL_TUNING.get(detail) or {}
    for old, new in swaps.items():
        if old not in html:
            raise SystemExit(f"--detail {detail}: the page no longer contains {old[:60]!r}; "
                             "the tuning has drifted from the renderer it tunes")
        html = html.replace(old, new, 1)
    if swaps:
        html = html.replace("<title>Kerbside", "<title>Kerbside", 1)
    return html
