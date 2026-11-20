"""The Unreal export of the near-ring NPC characters names what the page's build tool packs."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "unreal" / "export_npc_characters.py"


def load():
    spec = importlib.util.spec_from_file_location("export_npc_characters", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # no ``import unreal`` until main()
    return module


def test_meshes_and_clips_match_the_build_tool() -> None:
    m = load()
    build = (ROOT / "tools" / "build_npc_characters.mjs").read_text()
    packed = re.search(r"const MESHES = \[([^\]]+)\]", build).group(1)
    assert [name for name, _, _ in m.MESHES] == re.findall(r'"([^"]+)"', packed)
    assert [name for name, _ in m.CLIPS] == ["idle", "walk", "jog"]
    for name in ("idle", "walk", "jog"):
        assert f"clip-{name}.glb" in build
    # Lower detail than the game draws: no mesh at its full level except the hair cards (already LOD3).
    assert all(lod >= 1 for name, _, lod in m.MESHES if name != "ada-hair")


def test_options_tolerate_a_missing_property() -> None:
    m = load()

    class Opts:
        def __init__(self):
            self.set = {}

        def set_editor_property(self, key, value):
            if key == "export_cameras":
                raise AttributeError(key)
            self.set[key] = value

    fake = SimpleNamespace(GLTFExportOptions=Opts, GLTFMaterialBakeMode=SimpleNamespace(DISABLED="off"))
    o = m.options(fake, 2, False)
    assert o.set["default_level_of_detail"] == 2 and o.set["export_vertex_skin_weights"] is True
    assert o.set["bake_material_inputs"] == "off"


def test_publish_puts_a_stamped_build_and_current_last(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("publish_npc_characters", ROOT / "tools" / "publish_npc_characters.py")
    pub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pub)
    build = tmp_path / "npc"
    build.mkdir()
    for name in ("manifest.json", "clips.glb", "ada-body.jpg"):
        (build / name).write_bytes(name.encode())
    puts = []

    class Store:
        def put_file(self, key, source, **kw):
            puts.append(key)

        def put_json(self, key, body, **kw):
            puts.append((key, body))

    current = pub.publish(build, Store())
    assert puts[-1] == ("npc/current.json", current)
    assert all(k.startswith(f"npc/{current['build']}/") for k in puts[:-1]) and len(puts) == 4
    assert pub.stamp(build) == current["build"]
