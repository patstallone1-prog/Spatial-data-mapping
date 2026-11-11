"""The world's ground truth kept apart from players' edits; the exterior editor on Shift + right
click; the avatar creator close on the face (tools/record_ground_truth.py, page modules, docs)."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOT = ROOT / "src/smc/renderer/page/module/00-boot.js"
SETTINGS = ROOT / "src/smc/renderer/page/module/27-detail-by-zoom-the-city.js"
HEADSET = ROOT / "src/smc/renderer/page/module/28-the-headset.js"
EXPLORE = ROOT / "src/smc/renderer/page/module/22-explore-the-view-without-the.js"
LOBBY = ROOT / "docs/home-lobby.mjs"
TRUTH = ROOT / "docs/ground-truth.json"
TOOL = ROOT / "tools/record_ground_truth.py"
PUBLISH = ROOT / "tools/publish_chunks.py"


def test_the_ground_truth_is_recorded_apart_from_the_edits():
    truth = json.loads(TRUTH.read_text())
    assert truth["schema"] == "kerbside.ground_truth/1"
    assert truth["asset_map"]["copy"].startswith("ground-truth/asset-map-")
    assert truth["site_files"]["sf-corridor-3d.json"].startswith("chunks/")
    assert set(truth["edits_kept_apart"]) == {"exterior_edits", "city_world"}
    tool = TOOL.read_text()
    assert "store.put_file(map_key, tmp" in tool
    # The record stays on the site: publishing the data into the bucket never takes it away.
    assert '"envelopes.json", "ground-truth.json"}' in PUBLISH.read_text()


def test_ground_truth_only_draws_no_ones_edits():
    boot = BOOT.read_text()
    assert 'const GROUND_TRUTH_KEY = "kerbside:ground-truth";' in boot
    assert "GROUND_TRUTH ? [null, {}] : await Promise.all([" in boot
    assert "const local = META || GROUND_TRUTH ? {} : localExteriorEdits();" in boot
    settings = SETTINGS.read_text()
    assert '<label class="row">Ground truth only<input type="checkbox" name="truth" /></label>' in settings
    assert "localStorage.setItem(GROUND_TRUTH_KEY, settingsForm.truth.checked" in settings


def test_the_exterior_editor_opens_on_shift_and_a_right_click_only():
    headset = HEADSET.read_text()
    assert "if (e.shiftKey) {\n      if (feature?.kind === \"building\") openExteriorEditor(feature);" in headset
    assert '(e.key !== "e" && e.key !== "E")' not in headset, "E is Explore's free view"
    assert "if (!e.shiftKey && cityGame()" in EXPLORE.read_text()


def test_the_creator_frames_the_face_while_the_face_is_changed():
    lobby = LOBBY.read_text()
    assert 'focus(kind) { framing = kind === "head" ? "head" : "body"; },' in lobby
    assert 'stageFocus(!soldierOn && (creatorTab === "Face" || creatorTab === "Hair") ? "head" : "body");' in lobby
    assert "const want = head ? { y: tall - 0.14, z: 1.25, at: tall - 0.15, fov: 26 }" in lobby
