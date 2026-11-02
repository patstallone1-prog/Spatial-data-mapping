"""The avatar creator: a kept avatar made safe, sliders as morphs, the parts worn, how a build
is published, and the home screen and walker using it."""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.cloud.store import LocalStore

ROOT = Path(__file__).resolve().parents[1]
RENDERER = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
LOBBY = (ROOT / "docs/home-lobby.mjs").read_text()

CATALOGUE = {
    "version": 1, "credit": "test",
    "bodies": {"male": {"file": "male/body.glb", "morphs": ["weight+"]}, "female": {"file": "female/body.glb", "morphs": []}},
    "skins": {"male": ["young_caucasian_male", "old_african_male"], "female": ["young_caucasian_female"]},
    "skin_files": {"young_caucasian_male": "skins/a.jpg", "old_african_male": "skins/b.jpg", "young_caucasian_female": "skins/c.jpg"},
    "eye_files": {"brown": "eyes/brown.jpg", "green": "eyes/green.jpg"},
    "items": [
        {"id": "eyes/low-poly", "slot": "eyes", "label": "Eyes", "files": {"male": "male/e.glb", "female": "female/e.glb"}},
        {"id": "eyelashes/eyelashes01", "slot": "eyelashes", "label": "Lashes", "files": {"male": "male/l.glb", "female": "female/l.glb"}},
        {"id": "eyebrows/eyebrow001", "slot": "eyebrows", "label": "Natural", "default": True, "files": {"male": "male/b.glb", "female": "female/b.glb"}},
        {"id": "hair/short02", "slot": "hair", "label": "Short", "files": {"male": "male/h.glb", "female": "female/h.glb"}},
        {"id": "hair/bob01", "slot": "hair", "label": "Bob", "files": {"male": "male/bob.glb", "female": "female/bob.glb"}},
        {"id": "facial_hair/beard", "slot": "facial_hair", "label": "Beard", "files": {"male": "male/f.glb"}},
        {"id": "outfit/male_casualsuit01", "slot": "outfit", "label": "Casual", "files": {"male": "male/o.glb"},
         "covers": {"male": [[1, 4]]}},
        {"id": "outfit/female_casualsuit01", "slot": "outfit", "label": "Casual", "files": {"female": "female/o.glb"}},
        {"id": "shoes/shoes01", "slot": "shoes", "label": "Shoes", "files": {"male": "male/s.glb", "female": "female/s.glb"}},
    ],
}


def node(code: str):
    if not shutil.which("node"):
        pytest.skip("node is needed for the shared modules")
    preamble = f"import * as a from {json.dumps((ROOT / 'docs/avatar-builder.mjs').as_uri())};\n"
    preamble += f"const CAT = {json.dumps(CATALOGUE)};\n"
    out = subprocess.run(["node", "--input-type=module", "-e", preamble + code], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_a_kept_avatar_is_made_safe_to_build():
    out = node("""
    const wild = a.sanitizeAvatar({ body: "female", height: 9, sliders: { weight: -5, belly: -1, nope: 1 },
      head: "head_cube", hair: "hair/short02", facial_hair: "facial_hair/beard", outfit: "outfit/male_casualsuit01",
      skin: "old_african_male", eyes: "violet", hair_colour: "red", extra: 1 }, CAT);
    console.log(JSON.stringify({ wild, soldier: a.sanitizeAvatar({ model: "soldier", hair: "x" }),
      none: a.sanitizeAvatar(null), noCat: a.sanitizeAvatar({ hair: "hair/whatever" }) }));
    """)
    wild = out["wild"]
    assert wild["body"] == "female" and wild["height"] == 1.12           # clamped to the range
    assert wild["sliders"] == {"weight": -1, "belly": 0}                 # one-ended: 0..1
    assert wild["head"] == "" and "extra" not in wild and wild["hair_colour"] == ""
    assert wild["hair"] == "hair/short02"                                 # offered to both
    assert wild["facial_hair"] == "facial_hair/beard" or wild["facial_hair"] == ""
    assert wild["outfit"] == "outfit/female_casualsuit01"                 # a male outfit is not hers
    assert wild["skin"] == "young_caucasian_female" and wild["eyes"] == "brown"
    assert out["soldier"] == {"v": 1, "model": "soldier"}
    assert out["none"]["model"] == "creator" and out["none"]["body"] == "male"
    assert out["noCat"]["hair"] == "hair/whatever"                         # checked once the catalogue is in


def test_a_part_one_body_cannot_wear_is_dropped():
    out = node("""
    console.log(JSON.stringify(a.sanitizeAvatar({ body: "female", facial_hair: "facial_hair/beard" }, CAT).facial_hair));
    """)
    assert out == ""


def test_sliders_become_morph_weights_and_worn_parts_are_listed():
    out = node("""
    const av = a.sanitizeAvatar({ body: "male", sliders: { weight: 0.5, muscle: -0.25, belly: 0.4 },
      head: "head_round", head_amount: 0.7, facial_hair: "facial_hair/beard", shoes: "" }, CAT);
    console.log(JSON.stringify({ w: a.morphWeights(av), worn: a.wornItems(av, CAT).map((i) => i.id) }));
    """)
    assert out["w"] == {"weight+": 0.5, "muscle-": 0.25, "belly+": 0.4, "head_round+": 0.7}
    assert out["worn"] == ["eyes/low-poly", "eyelashes/eyelashes01", "hair/short02", "facial_hair/beard",
                           "eyebrows/eyebrow001", "outfit/male_casualsuit01"]


def _publisher():
    spec = importlib.util.spec_from_file_location("publish_avatars", ROOT / "tools/avatars/publish_avatars.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_a_build_is_published_under_its_stamp_with_the_catalogue_last(tmp_path):
    build = tmp_path / "build"
    for path in _publisher().files_of(CATALOGUE):
        (build / path).parent.mkdir(parents=True, exist_ok=True)
        (build / path).write_bytes(path.encode())
    (build / "catalogue.json").write_text(json.dumps(CATALOGUE))
    store = LocalStore(tmp_path / "store")
    out = _publisher().publish(build, store)
    prefix = out["build"]
    assert len(prefix) == 12
    assert out["bodies"]["male"]["file"] == f"{prefix}/male/body.glb"
    assert out["items"][6]["files"] == {"male": f"{prefix}/male/o.glb"} and out["items"][6]["covers"] == {"male": [[1, 4]]}
    assert store.get(f"avatars/{prefix}/skins/a.jpg") == b"skins/a.jpg"
    assert json.loads(store.get("avatars/catalogue.json"))["build"] == prefix
    # The same build again: the same stamp, so nothing a page has cached goes stale.
    assert _publisher().publish(build, store)["build"] == prefix


def test_the_home_screen_and_the_walker_build_from_the_creator():
    assert "avatars: avatarBuilder" in RENDERER
    assert 'avatar-builder.mjs?rev=__AVATAR_BUILDER_HASH__' in RENDERER
    assert '("AVATAR_BUILDER", "avatar-builder.mjs")' in RENDERER
    # The walker takes the figure, and the Soldier stays behind it as the fallback.
    look = RENDERER[RENDERER.index("function applyWalkerLook"):]
    assert "showWalkerFigure(look)" in look[:2000]
    assert 'soldier.name = "soldier-figure"' in RENDERER
    # The creator's tabs, and the Soldier still on offer.
    for tab in ("Body:", "Face:", "Hair:", "Outfit:", "Name:"):
        assert tab in LOBBY
    assert "Use the Soldier" in LOBBY and "Randomise" in LOBBY
    assert "lastCreator" in LOBBY
