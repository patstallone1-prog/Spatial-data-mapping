"""The native foliage setup's offline parts: its textures, grass clump and slot routing."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def setup():
    spec = importlib.util.spec_from_file_location("foliage_setup", ROOT / "tools/unreal/foliage_setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_each_plant_surface_takes_its_foliage_material_and_city_surfaces_keep_theirs():
    f = setup()
    assert f.kind_for("foliage:conifer") == "leaf_needle"
    assert f.kind_for("foliage:palm") == "leaf_palm"
    assert f.kind_for("foliage:street") == "leaf_broad"
    assert f.kind_for("tree:broad") == "bark"
    assert f.kind_for("understorey:coastal_scrub") == "shrub"
    assert f.kind_for("litter:needle_duff") == "litter_needle"
    assert f.kind_for("litter:eucalyptus_litter") == "litter_eucalyptus"
    assert f.kind_for("litter:leaf_litter") == "litter_leaf"
    for city in ("road", "building", "park", "walk", "furniture:post"):
        assert f.kind_for(city) is None
    assert set(f.KINDS) >= {"leaf_broad", "leaf_needle", "leaf_palm", "bark", "shrub", "grass"}


def test_grass_clump_carries_the_bend_inputs_the_material_reads(tmp_path):
    f = setup()
    gltf = json.loads(f.write_grass_clump(tmp_path / "clump.gltf").read_text())
    attrs = gltf["meshes"][0]["primitives"][0]["attributes"]
    assert {"POSITION", "COLOR_0", "TEXCOORD_0", "TEXCOORD_1", "TEXCOORD_2"} <= set(attrs)
    position = gltf["accessors"][attrs["POSITION"]]
    assert 0.3 <= position["max"][1] <= 0.56 and position["min"][1] == 0  # blades 30-55 cm, from the ground
    assert gltf["accessors"][attrs["TEXCOORD_2"]]["count"] == position["count"]


def test_textures_are_cut_out_leaves_not_squares(tmp_path):
    from PIL import Image
    f = setup()
    made = f.paint_textures(tmp_path)
    for kind in ("leaf_broad", "leaf_needle", "leaf_palm", "leaf_litter", "needle_duff", "eucalyptus_litter"):
        alpha = Image.open(made[kind]).getchannel("A")
        covered = 1 - alpha.histogram()[0] / (alpha.width * alpha.height)
        assert 0.05 < covered < 0.9, kind


def test_the_sway_matches_the_web_shader_law():
    f = setup()
    # The same 0.22 % of height per m/s as docs/foliage-motion.mjs, in centimetres.
    assert "hm * 100.0 * 0.0022 * v" in f.WPO_HLSL
    web = (ROOT / "docs/foliage-motion.mjs").read_text()
    assert "fmHeight * .0022 * fmV" in web
