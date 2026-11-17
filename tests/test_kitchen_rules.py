"""The kitchen's rules are written by ``tools/build_kitchen_rules.py``: the line in rules.json is its output."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _tool():
    spec = importlib.util.spec_from_file_location("build_kitchen_rules", ROOT / "tools/build_kitchen_rules.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_kitchen_block_in_the_rules_is_what_the_script_writes(tmp_path, monkeypatch):
    tool = _tool()
    before = (ROOT / "docs/city/rules.json").read_text()
    copy = tmp_path / "rules.json"
    copy.write_text(before)
    monkeypatch.setattr(tool, "RULES", copy)
    tool.main()
    assert copy.read_text() == before, "rerun tools/build_kitchen_rules.py: rules.json is out of date with it"
    kitchen = json.loads(before)["kitchen"]
    assert kitchen["ingredients"] and kitchen["processes"]
