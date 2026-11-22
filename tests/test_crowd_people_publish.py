"""The near ring's MakeHuman crowd: its build names what the page reads, and a publish is whole."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


#: The scripts under test, by path (so the CI's test selection sees them).
SCRIPTS = {"publish_crowd_people": "tools/avatars/publish_crowd_people.py", "build_crowd_people": "tools/avatars/build_crowd_people.py"}


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / SCRIPTS[name])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_text() -> str:
    return (ROOT / "tools" / "avatars" / "build_crowd_people.py").read_text()


def test_the_build_makes_the_morphs_and_clips_the_page_reads() -> None:
    page = (ROOT / "docs" / "city" / "npc-figures.mjs").read_text()
    text = build_text()
    morphs = re.findall(r'^\s+"([a-z+-]+)": \("macro"', text, re.M)
    assert morphs == ["weight-", "weight+", "muscle+", "old"]
    # The shader reads them in that order: weight- weight+ muscle+ old.
    assert (
        "kbM0 * max(-kbW, 0.0) + kbM1 * max(kbW, 0.0) + kbM2 * kbShape.y + kbM3 * kbShape.z" in page
    )
    for clip in ("Idle", "Walk", "Run"):
        assert f'"{clip}"' in page
    # Only MakeHuman's CC0 assets: none of the AGPL beards.
    assert "sigmund" not in text and "scruffy" not in text


def test_every_part_has_a_crowd_budget() -> None:
    text = build_text()
    rows = re.findall(r'\("(\w+)", "\w+", [^,]+, "\w+", \[[^\]]+\], (\d+), (True|False)\)', text)
    assert rows, "the PARTS table"
    for slot, budget, _ in rows:
        if slot in ("eyebrows", "eyes"):
            continue
        assert 0 < int(budget) <= 2600, (slot, budget)


def build_folder(tmp_path: Path) -> Path:
    b = tmp_path / "crowd"
    (b / "male" / "tex").mkdir(parents=True)
    (b / "skins").mkdir()
    manifest = {
        "version": 1,
        "morphs": [],
        "clips": ["Idle"],
        "bodies": {
            "male": {
                "file": "male.glb",
                "skins": ["skins/young.jpg"],
                "parts": [
                    {"id": "hair__short01", "slot": "hair", "texture": "tex/hair__short01.png"}
                ],
            }
        },
    }
    (b / "crowd.json").write_text(json.dumps(manifest))
    (b / "male.glb").write_bytes(b"glTF")
    (b / "skins" / "young.jpg").write_bytes(b"jpg")
    (b / "male" / "tex" / "hair__short01.png").write_bytes(b"png")
    (b / "_soldier.glb").write_bytes(b"not published")
    return b


class Store:
    def __init__(self):
        self.puts = []

    def put_file(self, key, source, content_type, cache_control):
        self.puts.append((key, content_type, cache_control))

    def put_json(self, key, value, cache_control):
        self.puts.append((key, value, cache_control))


def test_publish_puts_a_stamped_build_and_current_last(tmp_path: Path) -> None:
    pub = load("publish_crowd_people")
    store = Store()
    out = pub.publish(build_folder(tmp_path), store)
    keys = [k for k, *_ in store.puts]
    assert keys[-1] == "crowd/current.json" and store.puts[-1][1]["build"] == out["build"]
    assert all(k.startswith(f"crowd/{out['build']}/") for k in keys[:-1])
    assert f"crowd/{out['build']}/male/tex/hair__short01.png" in keys
    assert not any("_soldier" in k for k in keys), "scratch files stay home"
    assert store.puts[0][2].endswith("immutable") and store.puts[-1][2] == "no-cache"


def test_publish_refuses_half_a_build(tmp_path: Path) -> None:
    pub = load("publish_crowd_people")
    b = build_folder(tmp_path)
    (b / "male" / "tex" / "hair__short01.png").unlink()
    with pytest.raises(SystemExit, match=re.escape("missing male/tex/hair__short01.png")):
        pub.publish(b, Store())
