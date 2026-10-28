"""Wet streets in Unreal: the weather collection the sky writes, and the decals that read it.

Run inside UE (setup_world.py calls it). The city's own materials are whatever the glTF importer
made, one per exported material, so rather than rebuild every one with a wetness term the city is
wetted from outside, the way a decal wets a floor:

* ``MPC_KerbsideWeather`` with ``Wetness``, 0 dry to 1 soaked, which AKerbsideCelestialSky
  writes as rain soaks and the sun dries;
* ``M_KerbsideWetGloss``, a DBuffer roughness decal: the surface goes from its own roughness
  toward a wet film's 0.08 as it soaks;
* ``M_KerbsideWetDarken``, a DBuffer colour decal: the surface darkens by up to 30 per cent, as
  wet asphalt, concrete, brick and wood do;
* one decal of each over the whole city, sized to the imported tiles.

What does not get wet is decided by the object catalogue (docs/object-catalogue.json): interiors,
water and glass are kept out of the decals (``receives_decals`` off) by setup_world.py.
"""

from __future__ import annotations

import unreal

FOLDER = "/Game/KerbsideRuntime/Weather"
MPC = f"{FOLDER}/MPC_KerbsideWeather"
#: Wet film roughness, and how dark a soaked porous surface goes.
WET_ROUGHNESS = 0.08
WET_DARKEN = 0.30
#: Catalogue families and materials that never get wet: indoors, water itself, glass.
DRY_FAMILIES = frozenset({"interior", "water", "view", "trigger"})
DRY_MATERIALS = frozenset({"glass", "water", "none"})


def _tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def _load(path: str):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def receives_wet(kind: dict) -> bool:
    """Whether a catalogue archetype (as setup_world.archetype returns it) is wetted by the rain."""
    return kind["id"].split(".")[0] not in DRY_FAMILIES and kind["material"] not in DRY_MATERIALS


def ensure_collection():
    mpc = _load(MPC)
    if mpc:
        return mpc
    mpc = _tools().create_asset("MPC_KerbsideWeather", FOLDER, unreal.MaterialParameterCollection,
                                unreal.MaterialParameterCollectionFactoryNew())
    wet = unreal.CollectionScalarParameter()
    wet.set_editor_property("parameter_name", "Wetness")
    wet.set_editor_property("default_value", 0.0)
    mpc.set_editor_property("scalar_parameters", [wet])
    unreal.EditorAssetLibrary.save_loaded_asset(mpc)
    return mpc


def _blend_mode(*words: str):
    """The DecalBlendMode member whose name has exactly these words (Python spells them its own way)."""
    names = [n for n in dir(unreal.DecalBlendMode) if n.isupper()]
    for name in names:
        parts = set(name.replace("DBM_", "").replace("D_BUFFER", "DBUFFER").split("_"))
        if parts == {"DBUFFER", *words}:
            return getattr(unreal.DecalBlendMode, name)
    raise RuntimeError(f"no decal blend mode DBuffer {words} among {names}")


def _decal_material(name: str, mpc, mode, *, roughness: float | None, darken: float | None):
    path = f"{FOLDER}/{name}"
    mat = _load(path)
    if mat:
        return mat
    mel = unreal.MaterialEditingLibrary
    mat = _tools().create_asset(name, FOLDER, unreal.Material, unreal.MaterialFactoryNew())
    mat.set_editor_property("material_domain", unreal.MaterialDomain.MD_DEFERRED_DECAL)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    mat.set_editor_property("decal_blend_mode", mode)
    wet = mel.create_material_expression(mat, unreal.MaterialExpressionCollectionParameter, -600, 0)
    wet.set_editor_property("collection", mpc)
    wet.set_editor_property("parameter_name", "Wetness")
    strength = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -600, 120)
    strength.set_editor_property("r", darken if darken is not None else 1.0)
    opacity = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -350, 40)
    mel.connect_material_expressions(wet, "", opacity, "A")
    mel.connect_material_expressions(strength, "", opacity, "B")
    mel.connect_material_property(opacity, "", unreal.MaterialProperty.MP_OPACITY)
    if darken is not None:
        # Blending toward black by the opacity is multiplying by (1 - opacity): darker, same hue.
        black = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -350, -160)
        black.set_editor_property("constant", unreal.LinearColor(0, 0, 0, 1))
        mel.connect_material_property(black, "", unreal.MaterialProperty.MP_BASE_COLOR)
    if roughness is not None:
        film = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -350, 200)
        film.set_editor_property("r", roughness)
        mel.connect_material_property(film, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    return mat


def ensure_assets() -> dict:
    mpc = ensure_collection()
    gloss = _decal_material("M_KerbsideWetGloss", mpc, _blend_mode("ROUGHNESS"), roughness=WET_ROUGHNESS, darken=None)
    darken = _decal_material("M_KerbsideWetDarken", mpc, _blend_mode("COLOR"), roughness=None, darken=WET_DARKEN)
    return {"collection": mpc, "gloss": gloss, "darken": darken}


def place_decals(actors, assets: dict, centre_cm, half_extent_cm) -> list:
    """Two decals over the whole city: one glosses, one darkens. A decal projects along its X, so
    it is turned to look straight down; walls take the same uniform film, which is what rain does."""
    placed = []
    for label, material in (("gloss", assets["gloss"]), ("darken", assets["darken"])):
        decal = actors.spawn_actor_from_class(unreal.DecalActor, centre_cm, unreal.Rotator(pitch=-90, yaw=0, roll=0))
        decal.set_actor_label(f"Kerbside — wet streets ({label})")
        decal.set_folder_path("Kerbside/Weather")
        component = decal.get_component_by_class(unreal.DecalComponent)
        component.set_decal_material(material)
        # X is the projection depth (up and down), Y and Z the plan.
        component.set_editor_property("decal_size", unreal.Vector(half_extent_cm[2], half_extent_cm[1], half_extent_cm[0]))
        component.set_editor_property("fade_screen_size", 0.0)
        placed.append(decal)
    return placed
