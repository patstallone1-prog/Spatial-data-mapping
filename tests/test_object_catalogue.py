"""The object catalogue: every drawn thing has a material, a way past it and a way it breaks."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.world import catalogue

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
THREE = ROOT / "tools/unreal/node_modules/three/build/three.module.js"
MODULE = ROOT / "docs/object-catalogue.mjs"


def _named_surfaces() -> set[str]:
    """Every surface name the page and the landscape write as a literal."""
    sources = [ROOT / "scripts/build_sf_corridor_3d.py", *sorted((ROOT / "docs").glob("*.mjs"))]
    names: set[str] = set()
    patterns = [r"userData\.surface\s*=\s*[\"'`]([a-z0-9_: ]+)[\"'`]",
                r"\bsurface\s*:\s*[\"'`]([a-z0-9_: ]+)[\"'`]",
                r"addGround\([^;]*?,\s*\"([a-z0-9_:]+)\"\)",
                r"placeParkModule\([^;]*?,\s*\"([a-z0-9_:]+)\"\)",
                r"[\"'](furniture:[a-z_]+)[\"']\s*:",
                # The exterior editor's drawing helpers take the surface as their last argument.
                r"\b(?:box|plane|shapeMesh)\([^;\n]*?,\s*\"([a-z0-9_:]+)\"(?:,\s*[^;\n]*)?\);"]
    for path in sources:
        text = path.read_text()
        for pattern in patterns:
            names.update(m.group(1) for m in re.finditer(pattern, text))
    return names


def test_catalogue_is_valid_and_complete() -> None:
    cat = catalogue.load()
    used = {a["material"] for a in cat["archetypes"].values()}
    assert used == set(cat["materials"]), "every material belongs to some archetype"
    assert {a["traversal"] for a in cat["archetypes"].values()} == catalogue.TRAVERSALS
    for name, a in cat["archetypes"].items():
        if a["durability"]["level"] == 2:
            assert a["durability"].get("break_energy_j", 0) > 0, name
        if a["family"] == "vegetation" and a["traversal"] != "walk_on":
            assert a["durability"].get("dies") or a["id" if "id" in a else "family"], name
    assert cat["player"]["step_height_m"] < cat["player"]["head_clearance_m"]


def test_every_surface_the_renderer_names_is_catalogued() -> None:
    names = _named_surfaces()
    assert len(names) > 80, "the surface scan found too little; the patterns have drifted"
    missing = sorted(n for n in names if catalogue.resolve(n) is None)
    assert not missing, missing


def test_every_surface_an_unreal_export_named_is_catalogued() -> None:
    manifests = sorted((ROOT / "build").glob("unreal*/**/manifest.json"))
    if not manifests:
        pytest.skip("no local Unreal export")
    missing = set()
    for path in manifests:
        missing |= {s for s in json.loads(path.read_text()).get("surfaces", {}) if catalogue.resolve(s) is None}
    assert not missing, sorted(missing)


def test_trees_measured_or_inferred_and_logs_are_solid_and_leaves_are_not() -> None:
    for surface in ("tree:street", "tree:broad", "tree:palm", "nature_tree", "tree street"):
        a = catalogue.archetype(surface)
        assert a["id"] == "vegetation.tree" and a["traversal"] == "go_around", surface
        assert catalogue.blocks_player(surface), surface
    for surface in ("nature_log", "nature_stump", "nature_rock"):
        assert catalogue.blocks_player(surface), surface
    for surface in ("foliage:street", "nature_foliage", "understorey:fern", "nature_wild_grass", "litter:oak"):
        assert not catalogue.blocks_player(surface), surface
    # Soft things slow the walker; a stick is stepped over.
    assert catalogue.archetype("understorey:fern")["speed"] < 1
    assert catalogue.archetype("deadwood:stick")["traversal"] == "step_over"


def test_spellings_resolve_alike() -> None:
    assert catalogue.resolve("furniture street_light") == catalogue.resolve("furniture:street_light")
    assert catalogue.resolve("awning:band|abc|o") == "building.awning"
    assert catalogue.resolve("fence:chainlink_post") == "barrier.fence_chainlink"
    assert catalogue.resolve("furniture:signal_lens:2") == "furniture.traffic_signal"
    assert catalogue.resolve("no_such_thing") is None


def test_physical_material_is_what_an_engine_takes() -> None:
    steel = catalogue.physical_material("steel")
    assert steel["static_friction"] >= steel["friction"] > steel["wet_friction"]
    assert steel["density_g_cm3"] == 7.85


@pytest.mark.skipif(NODE is None, reason="node is needed")
def test_the_page_resolves_every_name_as_python_does() -> None:
    names = sorted(_named_surfaces() | {"tree:street", "foliage:street", "fence:chainlink_post", "furniture:signal_lens:2",
                                        "awning:band|abc|o", "furniture street_light", "no_such_thing", "ground:box"})
    data = (ROOT / "docs/object-catalogue.json").read_text()
    script = (f"import {{createCatalogue}} from {json.dumps(MODULE.as_uri())};\n"
              f"const c = createCatalogue({data});\n"
              f"console.log(JSON.stringify({json.dumps(names)}.map((n) => c.resolve(n))));")
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == [catalogue.resolve(n) for n in names]


@pytest.mark.skipif(NODE is None or not THREE.exists(), reason="node and tools/unreal/node_modules/three are needed")
def test_the_walker_goes_round_poles_and_trunks_under_arms_and_through_shrubs() -> None:
    data = (ROOT / "docs/object-catalogue.json").read_text()
    script = f"""
import * as THREE from {json.dumps(THREE.as_uri())};
import {{createCatalogue, createProximity}} from {json.dumps(MODULE.as_uri())};
globalThis.performance ??= {{now: () => Date.now()}};
const root = new THREE.Group(), dummy = new THREE.Object3D();
function instanced(geometry, surface, places, extra = {{}}) {{
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(extra.material || {{}}), places.length);
  places.forEach(([x, y, z, sx, sy, sz], i) => {{ dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); }});
  mesh.userData = {{surface, ...(extra.userData || {{}})}};
  root.add(mesh);
  return mesh;
}}
// A street light's pole at (2, 0), its arm 6 m up over (0, 0); a measured street tree at (0, 3)
// and an inferred forest tree at (-3, 0); a shrub round (0, -3); a pole 20 m off.
const unit = new THREE.CylinderGeometry(1, 1, 1, 8);
instanced(unit, "furniture:street_light", [[2, 4, 0, .12, 8, .12], [20, 4, 0, .12, 8, .12]], {{userData: {{source: "sfpuc_streetlights"}}}});
instanced(new THREE.BoxGeometry(1, 1, 1), "furniture:street_light", [[0, 6, 0, 4, .2, .3]]);
const tree = instanced(unit, "tree:street", [[0, 4, 3, .2, 8, .2]]);
tree.userData.instanceBasis = ["measured (lidar canopy)"];
instanced(unit, "nature_tree", [[-3, 5, 0, .25, 10, .25]], {{userData: {{inferred: true}}}});
instanced(new THREE.SphereGeometry(1, 8, 6), "understorey:fern", [[0, .5, -3, 1, .5, 1]]);
instanced(new THREE.BoxGeometry(1, 1, 1), "parking_wheel_stop", [[0, .07, 1.5, 1.8, .14, .2]]);
// A signal's mast arm reaching over the walker, its pole out of reach.
instanced(new THREE.BoxGeometry(1, 1, 1), "furniture:traffic_signal", [[0, 5.5, -1.2, 3, .25, .25]]);
root.updateMatrixWorld(true);
const catalogue = createCatalogue({data});
const p = createProximity({{THREE, catalogue, roots: () => [root]}});
p.update(0, 0, 0, true);
const r = .3;
const out = {{
  pole: Boolean(p.blocked(2, 0, r)), poleClose: Boolean(p.blocked(1.65, 0, r)), clearOfPole: Boolean(p.blocked(1.5, 0, r)),
  underArm: Boolean(p.blocked(0, 0, r)), streetTree: Boolean(p.blocked(0, 3, r)), inferredTree: Boolean(p.blocked(-3, 0, r)),
  wheelStop: Boolean(p.blocked(0, 1.5, r)), farPole: Boolean(p.blocked(20, 0, r)),
  shrubSpeed: p.speedAt(0, -3, r), openSpeed: p.speedAt(0, 1, r),
  nearby: p.nearby(10).map((n) => [n.archetype, n.traversal, n.basis]),
}};
console.log(JSON.stringify(out));
"""
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    assert result["pole"] and result["poleClose"] and not result["clearOfPole"]
    assert not result["underArm"], "a lamp arm 6 m up is walked under"
    assert result["streetTree"] and result["inferredTree"], "measured and inferred trunks alike are solid"
    assert not result["wheelStop"], "a 14 cm wheel stop is stepped over"
    assert not result["farPole"], "nothing beyond the interaction radius is gathered"
    assert result["shrubSpeed"] < 1 and result["openSpeed"] == 1
    nearby = {tuple(n) for n in result["nearby"]}
    assert ("vegetation.tree", "go_around", "inferred") in nearby
    assert ("vegetation.tree", "go_around", "measured (lidar canopy)") in nearby
    # The light's pole and its arm overhead are one light, gone round; an arm alone is walked under.
    assert ("furniture.street_light", "go_around", "mapped") in nearby
    assert ("furniture.traffic_signal", "walk_under", "mapped") in nearby
    assert ("furniture.wheel_stop", "step_over", "mapped") in nearby
    assert all(n[0] != "furniture.street_light" or n[2] != "inferred" for n in nearby)


def test_every_wall_class_has_a_cladding_and_every_building_a_wall() -> None:
    cat = catalogue.load()
    walls = json.loads((ROOT / "docs/sf-corridor-materials.json").read_text())
    bases = walls["wall_bases"]
    for cls, confidence, basis in walls["walls"].values():
        assert catalogue.cladding(cls, cat) is not None, cls
        assert 0 < confidence <= 1 and basis in bases
    assert len(walls["walls"]) == sum(1 for w in json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())["ways"]
                                      if w.get("kind") == "building" and w.get("osm_id") is not None)
    # Untextured is read as smooth render; windows and garage doors are never guessed.
    assert catalogue.cladding("stucco_render", cat)["texture"] == "smooth"
    assert cat["claddings"]["fixed_parts"]["window"] == "glass"
    assert cat["claddings"]["fixed_parts"]["garage_door"] == "lumber"
