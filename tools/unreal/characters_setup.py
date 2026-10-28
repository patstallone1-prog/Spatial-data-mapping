"""The default characters: ten, one given to each player at random. Run inside UE.

Prebuilt, not made here. Two of Epic's sources, in order:

* **MetaHumans** -- the presets that ship with the MetaHumanCharacter plugin (Ada, Bo, Celeste,
  ...), rigged and textured by Epic's cloud service and assembled in the editor (the
  scratchpad's mh_build.py; that step needs the editor with a GPU, not a commandlet). Each built
  one is a Blueprint whose body, face and clothes follow the walker's animated mesh.
* **Epic's mannequins** -- Manny and Quinn from the third-person template, the same skeleton and
  animation, in different colours, filling whatever places the MetaHumans have not.

Customisation is left out on purpose: Epic's character customiser (Mutable) is beta in 5.8 and
ships no MetaHuman setup to plug in; building one is from-scratch work.

Writes ``[/Script/KerbsideWorld.KerbsideWalker]`` in the project's DefaultGame.ini (Roster,
RosterNames, Animation), which AKerbsideWalker reads. ``-KerbsideCharacter=<name>`` picks one.
"""

from __future__ import annotations

import json
from pathlib import Path

import unreal

#: The presets wanted first, chosen to be varied in age, build and appearance.
METAHUMANS = ("Ada", "Bo", "Celeste", "Isaiah", "Jorge", "Lani", "Omari", "Sunita", "Trey", "Vivian")
BUILT = "/Game/Characters/MetaHumans/Built"
MANNEQUINS = "/Game/Characters/Mannequins"
VARIANTS = "/Game/Characters/Roster"
ANIMATION = "/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed.ABP_Unarmed_C"
#: (name, base mesh, base material instance, colour): clothing-like tints, not skin tones.
MANNEQUIN_VARIANTS = (
    ("Manny Slate", "SKM_Manny_Simple", "Manny/MI_Manny_01_New", (0.20, 0.24, 0.30)),
    ("Quinn Coral", "SKM_Quinn_Simple", "Quinn/MI_Quinn_01", (0.80, 0.33, 0.27)),
    ("Manny Olive", "SKM_Manny_Simple", "Manny/MI_Manny_01_New", (0.35, 0.40, 0.20)),
    ("Quinn Teal", "SKM_Quinn_Simple", "Quinn/MI_Quinn_01", (0.12, 0.45, 0.48)),
    ("Manny Rust", "SKM_Manny_Simple", "Manny/MI_Manny_01_New", (0.55, 0.28, 0.14)),
    ("Quinn Plum", "SKM_Quinn_Simple", "Quinn/MI_Quinn_01", (0.42, 0.20, 0.40)),
    ("Manny Sand", "SKM_Manny_Simple", "Manny/MI_Manny_01_New", (0.72, 0.62, 0.45)),
    ("Quinn Navy", "SKM_Quinn_Simple", "Quinn/MI_Quinn_01", (0.10, 0.14, 0.32)),
    ("Manny Moss", "SKM_Manny_Simple", "Manny/MI_Manny_01_New", (0.22, 0.34, 0.24)),
    ("Quinn Ochre", "SKM_Quinn_Simple", "Quinn/MI_Quinn_01", (0.78, 0.58, 0.18)),
)
ROSTER_SIZE = 10


def _exists(path: str) -> bool:
    return unreal.EditorAssetLibrary.does_asset_exist(path)


def built_metahumans() -> list[tuple[str, str]]:
    """(name, class path) for each preset whose assembled Blueprint is in the project."""
    found = []
    for name in METAHUMANS:
        for candidate in (f"{BUILT}/{name}/BP_{name}", f"{BUILT}/BP_{name}"):
            if _exists(candidate):
                found.append((name, f"{candidate}.BP_{name}_C"))
                break
    return found


def mannequin_variant(name: str, mesh: str, material: str, colour: tuple) -> str | None:
    """A copy of Manny or Quinn wearing its own tint of the mannequin material; its asset path."""
    slug = name.replace(" ", "")
    target = f"{VARIANTS}/SKM_{slug}"
    if _exists(target):
        return f"{target}.SKM_{slug}"
    source_mesh, source_mi = f"{MANNEQUINS}/Meshes/{mesh}", f"{MANNEQUINS}/Materials/{material}"
    if not (_exists(source_mesh) and _exists(source_mi)):
        return None
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mi = tools.create_asset(f"MI_{slug}", VARIANTS, unreal.MaterialInstanceConstant,
                            unreal.MaterialInstanceConstantFactoryNew())
    parent = unreal.EditorAssetLibrary.load_asset(source_mi)
    unreal.MaterialEditingLibrary.set_material_instance_parent(mi, parent.get_editor_property("parent") or parent)
    unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(mi, "Base Color", unreal.LinearColor(*colour, 1))
    unreal.EditorAssetLibrary.save_loaded_asset(mi)
    copy = unreal.EditorAssetLibrary.duplicate_asset(source_mesh, target)
    materials = copy.get_editor_property("materials")
    for slot in materials:
        slot.set_editor_property("material_interface", mi)
    copy.set_editor_property("materials", materials)
    unreal.EditorAssetLibrary.save_loaded_asset(copy)
    return f"{target}.SKM_{slug}"


def roster() -> list[tuple[str, str]]:
    chosen = built_metahumans()[:ROSTER_SIZE]
    for name, mesh, material, colour in MANNEQUIN_VARIANTS:
        if len(chosen) >= ROSTER_SIZE:
            break
        path = mannequin_variant(name, mesh, material, colour)
        if path:
            chosen.append((name, path))
    return chosen


def config_block(entries: list[tuple[str, str]]) -> str:
    lines = ["[/Script/KerbsideWorld.KerbsideWalker]", "!Roster=ClearArray", "!RosterNames=ClearArray"]
    lines += [f"+Roster={path}" for _, path in entries]
    lines += [f"+RosterNames={name}" for name, _ in entries]
    lines.append(f"Animation={ANIMATION}")
    return "\n".join(lines) + "\n"


def main() -> None:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from install_runtime import managed_config

    entries = roster()
    if not entries:
        raise RuntimeError("no MetaHuman built and no mannequin in /Game/Characters; nothing to give players")
    config = Path(unreal.Paths.project_dir()) / "Config/DefaultGame.ini"
    original = config.read_text() if config.exists() else ""
    config.write_text(managed_config(original, config_block(entries)))
    report = Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/characters.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"roster": [{"name": n, "asset": p} for n, p in entries],
                                  "metahumans": sum(1 for _, p in entries if "/MetaHumans/" in p)}, indent=1))
    unreal.log(f"Kerbside roster: {', '.join(n for n, _ in entries)}")


if __name__ == "__main__":
    main()
