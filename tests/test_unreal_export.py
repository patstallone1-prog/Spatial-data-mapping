"""The corridor the page builds can be written as glTF tiles for Unreal, and read back."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
THREE = ROOT / "tools" / "unreal" / "node_modules" / "three"


@pytest.mark.skipif(NODE is None or not THREE.exists(), reason="node and tools/unreal/node_modules/three are needed")
def test_one_tile_exports_and_parses(tmp_path: Path) -> None:
    if not (ROOT / "docs" / "sf-corridor-3d.json").exists():
        pytest.skip("no built page")
    out = tmp_path / "unreal"
    run = subprocess.run([NODE, "--max-old-space-size=8000", str(ROOT / "tools/unreal/export_tiles.mjs"),
                          "--only", "0:0", "--out", str(out)], cwd=ROOT, capture_output=True, text=True, timeout=600)
    assert run.returncode == 0, run.stderr[-2000:]
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["tile_m"] == 250 and len(manifest["tiles"]) == 1
    tile = manifest["tiles"][0]
    assert tile["triangles"] > 10_000 and (out / tile["file"]).stat().st_size == tile["bytes"]
    # The frame travels with the tiles: a tile's corners are in longitude and latitude too.
    assert manifest["frame"]["mid_lon"] < -122 and tile["corners_lonlat"][0][1] > 37
    # Read back with the same loader Unreal's importer agrees with on the format.
    check = subprocess.run([NODE, "--input-type=module", "-e", f"""
import {{ readFileSync }} from "node:fs";
import {{ GLTFLoader }} from "{THREE.as_posix()}/examples/jsm/loaders/GLTFLoader.js";
globalThis.self = globalThis;
const buf = readFileSync({json.dumps(str(out / tile["file"]))});
new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (g) => {{
  let meshes = 0, tris = 0; const surfaces = new Set();
  g.scene.traverse((o) => {{ if (o.isMesh) {{ meshes += 1; tris += o.geometry.index.count / 3; surfaces.add(o.material.name); }} }});
  console.log(JSON.stringify({{ meshes, tris, surfaces: [...surfaces] }}));
}}, (e) => {{ console.error(e); process.exit(1); }});
"""], cwd=ROOT / "tools" / "unreal", capture_output=True, text=True, timeout=120)
    assert check.returncode == 0, check.stderr[-1000:]
    parsed = json.loads(check.stdout.strip().splitlines()[-1])
    assert parsed["tris"] == tile["triangles"], parsed
    assert {"road", "walk", "kerb", "building"} <= set(parsed["surfaces"]), parsed["surfaces"]
