"""The motion-captured moves (tools/avatars/build_moves.py -> docs/city/models/moves): CC0 clips
(Quaternius) and Mixamo captures retargeted onto the game's three skeletons, every one the page and
the crowd ask for present on each, the punches' reach measured (docs/71-animation-catalogue.md),
and the files thinned without changing how they play (tools/avatars/thin_moves.py)."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOVES = ROOT / "docs/city/models/moves"
SCRIPT = ROOT / "tools/avatars/build_moves.py"


def glb_json(path: Path) -> dict:
    data = path.read_bytes()
    assert data[:4] == b"glTF"
    length, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A
    return json.loads(data[20:20 + length])


def script_moves() -> set[str]:
    text = SCRIPT.read_text()
    block = text[text.index("MOVES = {"):text.index("\n}\n", text.index("MOVES = {"))]
    return set(re.findall(r'^\s+"(\w+)": \("(?:ual[12]|mixamo)"', block, re.M))


def crowd_moves() -> set[str]:
    text = (ROOT / "docs/city/npc-figures.mjs").read_text()
    return set(re.findall(r'"(\w+)"', re.search(r"export const CROWD_MOVES = \[([^\]]+)\]", text).group(1)))


def test_every_skeleton_has_every_move_and_only_mixamo_bones():
    manifest = json.loads((MOVES / "moves.json").read_text())
    assert "CC0" in manifest["source"] and "Quaternius" in manifest["source"] and "Mixamo" in manifest["source"]
    wanted = script_moves()
    assert crowd_moves() <= wanted and {"PunchJab", "PunchCross", "PunchHook", "SitDown"} <= wanted
    # The second pass's captures (the jump, the swim, sitting and leaning, held swings, dig, push).
    assert {"JumpUp", "JumpFall", "JumpLanding", "SwimStroke", "SwimTread", "SeatIdle", "LeanWall",
            "SwingHeld", "ChopHeld", "Dig", "PushObject"} <= wanted
    assert set(manifest["targets"]) == {"male", "female", "soldier"}
    for name, target in manifest["targets"].items():
        gltf = glb_json(MOVES / target["file"])
        clips = {a["name"] for a in gltf["animations"]}
        assert clips == wanted, (name, wanted ^ clips)
        assert set(target["moves"]) == wanted
        bound = {gltf["nodes"][c["target"]["node"]]["name"] for a in gltf["animations"] for c in a["channels"]}
        assert all(b.startswith("mixamorig:") for b in bound), name
        # Nothing but the skeleton and its one triangle: the page binds the clips by bone name.
        assert len(gltf.get("meshes", [])) == 1 and not gltf.get("images")
        assert (MOVES / target["file"]).stat().st_size < 3_000_000


def test_the_punches_reach_out_from_the_hips_in_time():
    manifest = json.loads((MOVES / "moves.json").read_text())
    for target in manifest["targets"].values():
        jab, cross = target["moves"]["PunchJab"], target["moves"]["PunchCross"]
        assert jab["reach"]["hand"] == "left" and cross["reach"]["hand"] == "right"
        for move in (jab, cross, target["moves"]["PunchHook"]):
            r = move["reach"]
            assert 0.05 < r["at_s"] < move["duration_s"]
            assert 0.4 < r["ahead_m"] < 1.2


def test_both_libraries_map_onto_the_mixamo_core():
    text = SCRIPT.read_text()
    core = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"] + [f"{s}{b}" for s in ("Left", "Right")
                                                                    for b in ("Shoulder", "Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot", "ToeBase")]
    for name in ("UAL1_TO_MIXAMO", "UAL2_TO_MIXAMO"):
        assert name in text
    # The maps are built in the script; their targets cover the core bones the clips drive.
    for bone in core:
        assert f'"{bone}"' in text or bone.startswith(("Left", "Right")), bone


def test_the_held_swings_land_at_their_strike():
    manifest = json.loads((MOVES / "moves.json").read_text())
    for target in manifest["targets"].values():
        for name in ("SwingHeld", "ChopHeld"):
            move = target["moves"][name]
            # Cut just past the blow (build_moves max_s), the hand furthest out mid-swing.
            assert move["duration_s"] <= 1.55
            assert 0.3 < move["reach"]["at_s"] < move["duration_s"] - 0.1


def test_thinning_keeps_every_key_it_drops_on_the_line():
    import math
    import sys
    sys.path.insert(0, str(ROOT / "tools/avatars"))
    from thin_moves import ROT_TOL, angle, slerp, thin

    times = [i / 30 for i in range(61)]
    # A turn about one axis: steady for a second, then a swing -- the steady keys go, the swing's stay.
    def q(t):
        a = 0.3 if t < 1 else 0.3 + 1.2 * math.sin((t - 1) * math.pi)
        return (math.sin(a / 2), 0.0, 0.0, math.cos(a / 2))
    values = [q(t) for t in times]
    kept = thin(times, values, "rotation", ROT_TOL)
    assert kept[0] == 0 and kept[-1] == len(times) - 1
    assert len(kept) < len(times) * 0.7
    for k in range(len(times)):
        # Every dropped key is within the tolerance of the line between the keys kept either side.
        a = max(i for i in kept if i <= k)
        b = min(i for i in kept if i >= k)
        if a == b:
            continue
        t = (times[k] - times[a]) / (times[b] - times[a])
        assert angle(slerp(values[a], values[b], t), values[k]) <= ROT_TOL + 1e-9
