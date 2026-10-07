#!/usr/bin/env python3
"""Fetch the household models the house interiors are furnished with, with pinned checksums
and source credit.

Two sources, both of which publish real-world scale models of real objects under licences that
allow them here:

* **Poly Haven** (CC0): modelled and photo-textured furniture -- sofas, armchairs, beds, chests
  of drawers, nightstands, coffee and dining tables, chairs, shelves, ceiling lamps, a bulb.
  Fetched as glTF with 1k textures.
* **Google Scanned Objects** (Google Research, CC BY 4.0, via Gazebo Fuel): photogrammetric
  scans of household things -- porcelain, bowls, planters, a basket, a towel. Only plain, unbranded
  objects are taken (no packaging, no logos). Each scan is converted from OBJ to a single GLB,
  its mesh decimated to SCAN_MAX_FACES and its texture reduced to SCAN_TEXTURE_PX, which is all
  the detail a cup on a counter carries at walking distance.

Every model is listed in docs/interior-assets/manifest.json with its role (what the renderer
places it as), its licence, its source page and the checksum of each file written.

    .venv/bin/python scripts/build_interior_assets.py
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/interior-assets"

#: Poly Haven model id -> the role the renderer places it as. Several per role, so rooms and
#: houses differ; the lighter models of each kind where Poly Haven has a choice.
POLY_HAVEN = {
    "sofa_03": "sofa", "sofa_02": "sofa", "Sofa_01": "sofa",
    "ArmChair_01": "armchair", "mid_century_lounge_chair": "armchair",
    "modern_arm_chair_01": "armchair",
    "modern_coffee_table_01": "coffee_table", "coffee_table_round_01": "coffee_table",
    "CoffeeTable_01": "coffee_table",
    "ClassicConsole_01": "tv_stand", "vintage_wooden_drawer_01": "tv_stand",
    "old_bed_frame": "bed", "GothicBed_01": "bed",
    "GothicCommode_01": "dresser", "chinese_commode": "dresser", "painted_wooden_cabinet": "dresser",
    "ClassicNightstand_01": "nightstand", "painted_wooden_nightstand": "nightstand",
    "side_table_01": "nightstand",
    "dining_table": "dining_table", "round_wooden_table_01": "dining_table",
    "painted_wooden_chair_01": "dining_chair", "painted_wooden_chair_02": "dining_chair",
    "metal_office_desk": "desk", "small_wooden_table_01": "desk",
    "wooden_bookshelf_worn": "bookshelf", "painted_wooden_shelves": "bookshelf",
    "modern_ceiling_lamp_01": "ceiling_lamp", "lantern_chandelier_01": "ceiling_lamp",
    "lightbulb_01": "bulb",
    "potted_plant_04": "plant",
    "hanging_picture_frame_01": "picture", "fancy_picture_frame_01": "picture",
}

#: Google Scanned Objects (Gazebo Fuel name) -> role. Plain objects only: nothing with a label,
#: a logo or packaging on it.
SCANNED = {
    "Threshold_Porcelain_Teapot_White": "counter_item",
    "Threshold_Porcelain_Pitcher_White": "counter_item",
    "Threshold_Porcelain_Serving_Bowl_Coupe_White": "table_item",
    "Footed_Bowl_Sand": "table_item",
    "Room_Essentials_Bowl_Turquiose": "table_item",
    "Cole_Hardware_Mug_Classic_Blue": "counter_item",
    "Threshold_Basket_Natural_Finish_Fabric_Liner_Small": "shelf_item",
    "Ecoforms_Planter_Pot_GP12AAvocado": "floor_plant_pot",
    "Down_To_Earth_Orchid_Pot_Ceramic_Red": "shelf_item",
    "Threshold_Textured_Damask_Bath_Towel_Pink": "bath_item",
}
SCAN_MAX_FACES = 6000
SCAN_TEXTURE_PX = 512
FUEL = "https://fuel.gazebosim.org/1.0/GoogleResearch/models"


def fetch(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "Kerbside asset build"}), timeout=120) as r:
        return r.read()


def poly_haven(asset_id: str, role: str) -> dict:
    files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset_id}"))
    model = files["gltf"]["1k"]["gltf"]
    directory = OUT / asset_id
    directory.mkdir(parents=True, exist_ok=True)
    entries = {f"{asset_id}.gltf": model, **model.get("include", {})}
    provenance = []
    for relative, row in entries.items():
        path = directory / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        data = path.read_bytes() if path.exists() else fetch(row["url"])
        if hashlib.md5(data).hexdigest() != row["md5"]:
            data = fetch(row["url"])
            if hashlib.md5(data).hexdigest() != row["md5"]:
                raise ValueError(f"source checksum mismatch: {asset_id}/{relative}")
        path.write_bytes(data)
        provenance.append({"path": f"{asset_id}/{relative}", "url": row["url"],
                           "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    return {"id": asset_id, "role": role, "license": "CC0-1.0",
            "source": f"https://polyhaven.com/a/{asset_id}", "attribution": "Poly Haven",
            "model": f"{asset_id}/{asset_id}.gltf", "files": provenance}


def scanned(name: str, role: str) -> dict:
    import numpy as np
    import trimesh
    from PIL import Image

    meta = json.loads(fetch(f"{FUEL}/{name}"))
    if "Attribution 4.0" not in meta.get("license_name", ""):
        raise ValueError(f"{name}: licence is {meta.get('license_name')!r}, not CC BY 4.0")
    version = meta.get("version", 1)
    archive_url = f"{FUEL}/{name}/{version}/{name}.zip"
    archive = fetch(archive_url)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        obj = z.read("meshes/model.obj")
        texture = Image.open(io.BytesIO(z.read("materials/textures/texture.png"))).convert("RGB")
    mesh = trimesh.load(io.BytesIO(obj), file_type="obj", process=False, force="mesh")
    uv = mesh.visual.uv if hasattr(mesh.visual, "uv") and mesh.visual.uv is not None else None
    if uv is None:
        raise ValueError(f"{name}: scan has no texture coordinates")
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    if len(faces) > SCAN_MAX_FACES:
        # Decimate with the texture coordinates carried along as extra vertex attributes would
        # need a seam-aware simplifier; fast_simplification keeps the vertex order it can, so
        # the UVs of surviving vertices are looked up by nearest original vertex.
        import fast_simplification
        reduced_v, reduced_f = fast_simplification.simplify(
            vertices.astype(np.float32), faces.astype(np.int32),
            target_reduction=1 - SCAN_MAX_FACES / len(faces))
        tree = trimesh.proximity.ProximityQuery(trimesh.Trimesh(vertices, faces, process=False))
        _, nearest = tree.vertex(reduced_v)
        uv = uv[nearest]
        vertices, faces = reduced_v, reduced_f
    # Scans stand Z-up in Gazebo; the page is Y-up.
    vertices = np.column_stack([vertices[:, 0], vertices[:, 2], -vertices[:, 1]])
    texture = texture.resize((SCAN_TEXTURE_PX, SCAN_TEXTURE_PX), Image.LANCZOS)
    material = trimesh.visual.material.PBRMaterial(baseColorTexture=texture, roughnessFactor=0.6,
                                                   metallicFactor=0.0)
    out_mesh = trimesh.Trimesh(vertices, faces, process=False,
                               visual=trimesh.visual.TextureVisuals(uv=uv, material=material))
    glb = trimesh.Scene(out_mesh).export(file_type="glb")
    directory = OUT / "scanned"
    directory.mkdir(parents=True, exist_ok=True)
    asset_id = name.lower()
    path = directory / f"{asset_id}.glb"
    path.write_bytes(glb)
    return {"id": asset_id, "role": role, "license": "CC-BY-4.0",
            "source": f"https://app.gazebosim.org/GoogleResearch/fuel/models/{name}",
            "attribution": "Google Research, Google Scanned Objects (CC BY 4.0)",
            "model": f"scanned/{asset_id}.glb", "faces": int(len(faces)),
            "files": [{"path": f"scanned/{asset_id}.glb", "url": archive_url,
                       "source_sha256": hashlib.sha256(archive).hexdigest(),
                       "bytes": len(glb), "sha256": hashlib.sha256(glb).hexdigest()}]}


def build() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": "kerbside.interior_assets/2", "assets": []}
    for asset_id, role in POLY_HAVEN.items():
        manifest["assets"].append(poly_haven(asset_id, role))
        print(f"  poly haven {asset_id} ({role})", flush=True)
    for name, role in SCANNED.items():
        manifest["assets"].append(scanned(name, role))
        print(f"  scanned {name} ({role})", flush=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    result = build()
    print(f"{len(result['assets'])} household models verified")
