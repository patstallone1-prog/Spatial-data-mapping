"""Play together: other people's walkers in the same world, with no server of Kerbside's own."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
THREE = ROOT / "tools/unreal/node_modules/three/build/three.module.js"
MODULE = ROOT / "docs/multiplayer.mjs"


def _node(script: str) -> dict:
    if NODE is None or not THREE.exists():
        pytest.skip("node and three.js are needed")
    result = subprocess.run([NODE, "--input-type=module", "-e", script, MODULE.as_uri(), THREE.as_uri()],
                            capture_output=True, text=True, timeout=60, check=True)
    return json.loads(result.stdout)


def test_two_walkers_in_one_room_see_each_other_and_a_leaver_is_gone() -> None:
    out = _node("""
const m = await import(process.argv[1]);
const THREE = await import(process.argv[2]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Two pages of the same world, a metre a degree to keep the arithmetic plain.
const page = (start) => {
  const me = { ...start };
  const ctx = { THREE, root: new THREE.Group(), avatarScale: 1, standY: 0.9, page: "/app-model.html",
    buildAvatar: () => { const g = new THREE.Group(); g.userData.leftLeg = new THREE.Object3D(); g.userData.rightLeg = new THREE.Object3D(); return g; },
    me: () => me, toLonLat: (x, z) => [x / 1e5, -z / 1e5], fromLonLat: (lon, lat) => [lon * 1e5, -lat * 1e5],
    groundAt: () => 0, requestFrame: () => {} };
  return { me, ctx };
};
const a = page({ x: 10, z: -20, feet: 0, yaw: 1, moving: true, stairs: false });
const b = page({ x: 0, z: 0, feet: 0, yaw: 0, moving: false, stairs: false });
let t = 1000;
const A = await m.join(a.ctx, { room: "test-42", name: "Ana", online: false, now: () => t });
const B = await m.join(b.ctx, { room: "TEST42", name: "Ben", online: false, now: () => t });
A.tick(t); B.tick(t);
await wait(50);
t += 120; a.me.x = 11;
A.tick(t);
await wait(50);
t += 400;
B.tick(t);
const seen = B.players();
const walker = b.ctx.root.children[0];
const out = { room: A.room, link: A.link("https://kerbside.example/app-model.html?x=1"),
  seenByB: seen.map((p) => p.name), seenByA: A.players().map((p) => p.name),
  at: walker && [walker.position.x, walker.position.y, walker.position.z].map((v) => +v.toFixed(2)), yaw: walker?.rotation.y,
  rejected: [m.readState({ v: 1, id: "x", lon: 999, lat: 0 }), m.readState({ v: 2, id: "x", lon: 0, lat: 0 }), m.readState(null)],
  badRoom: await m.join(a.ctx, { room: "ab", online: false }).then(() => "joined", (e) => e.message) };
A.leave();
await wait(50);
B.tick(t);
out.afterLeave = B.players().length;
out.childrenAfterLeave = b.ctx.root.children.length;
B.leave();
console.log(JSON.stringify(out));
""")
    assert out["room"] == "TEST42"
    assert out["link"] == "https://kerbside.example/app-model.html?x=1&room=TEST42"
    assert out["seenByB"] == ["Ana"] and out["seenByA"] == ["Ben"]
    assert out["at"] == [11, 0.9, -20] and out["yaw"] == 1  # the latest place, at standing height
    assert out["rejected"] == [None, None, None]
    assert out["badRoom"].startswith("a room code is")
    assert out["afterLeave"] == 0 and out["childrenAfterLeave"] == 0


def test_a_remote_walker_is_drawn_between_samples_never_ahead_of_them() -> None:
    out = _node("""
const m = await import(process.argv[1]);
const samples = [{ t: 0, x: 0, y: 0, z: 0, yaw: 3.0 }, { t: 100, x: 10, y: 1, z: 0, yaw: -3.0, moving: true }];
console.log(JSON.stringify({ mid: m.sampleAt(samples, 50), after: m.sampleAt(samples, 500), before: m.sampleAt(samples, -5),
  codes: [m.newRoomCode(() => 0), m.cleanRoomCode(" ab-cd 9 "), m.cleanRoomCode("x")], name: m.cleanName("  <b>Zoë</b>  ") }));
""")
    assert out["mid"]["x"] == 5 and out["mid"]["y"] == 0.5
    # Turning from 3.0 to -3.0 rad goes the short way, through pi, not back through zero.
    assert abs(out["mid"]["yaw"]) > 3.0
    assert out["after"]["x"] == 10 and out["before"]["x"] == 0
    assert out["codes"] == ["AAAAAA", "ABCD9", None]
    assert out["name"] == "bZoë/b"


def test_the_page_offers_play_together_and_ticks_it_each_frame() -> None:
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert '<button id="play-together"' in source
    assert 'import(sharedAsset("multiplayer.mjs?rev=__MULTIPLAYER_HASH__"))' in source
    assert "if (multiplayer?.session?.tick(now)) lastMovedAt = now;" in source
    assert 'new URLSearchParams(location.search).get("room")' in source
    # Peer to peer: a pinned library from the CDN, the room code as the handshake's password.
    module = MODULE.read_text()
    assert "@trystero-p2p/nostr@0.25.4/+esm" in module and "password: room" in module
