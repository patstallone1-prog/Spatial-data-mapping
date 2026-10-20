"""The headset version (docs/meta.html, docs/meta-xr.mjs): first person, noon, a short view,
the controllers' buttons, and a memory budget it never crosses."""
from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GiB = 1024 ** 3


def node(code: str):
    if not shutil.which("node"):
        pytest.skip("Node required")
    preamble = f"import * as m from {json.dumps((ROOT / 'docs/meta-xr.mjs').as_uri())};\n"
    out = subprocess.run(["node", "--input-type=module", "-e", preamble + code],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_the_memory_governor_aims_at_four_gib_and_never_lets_five_be_reached():
    r = node("""const M=m.META_MEMORY,G=1024**3;
    console.log(JSON.stringify({M,low:m.metaMemoryPlan(2*G,150),grow:m.metaMemoryPlan(2*G,96),
      over:m.metaMemoryPlan(4.1*G,150),emergency:m.metaMemoryPlan(4.6*G,150),reload:m.metaMemoryPlan(4.6*G,80),floor:m.metaMemoryPlan(4.2*G,80),
      unknown:m.metaMemoryPlan(NaN,150)}))""")
    M = r["M"]
    assert M["aim"] == 4 * GiB and M["ceiling"] == 5 * GiB and M["aim"] < M["emergency"] < M["ceiling"]
    assert r["low"] == {"radius": 150, "shed": None, "level": "ok"}
    assert r["grow"]["level"] == "restore" and 96 < r["grow"]["radius"] <= 150
    assert r["over"]["level"] == "over" and r["over"]["radius"] < 150 and r["over"]["shed"] == "caches"
    assert r["emergency"] == {"radius": M["minRadius"], "shed": "all", "level": "emergency"}
    # Already at its smallest and still over: the page starts again where you stand.
    assert r["reload"] == {"radius": M["minRadius"], "shed": "all", "level": "reload"}
    assert r["floor"]["radius"] == M["minRadius"]
    assert r["unknown"]["level"] == "unknown"


def test_only_the_blocks_round_you_are_held_and_the_view_ends_in_haze():
    r = node("console.log(JSON.stringify({S:m.META_STREAM,V:m.META_VIEW,noon:m.META_NOON}))")
    S, V = r["S"], r["V"]
    # A 300 m square, a tenth of the desktop app's caches; seen to 240 m, hazed from 60 m.
    assert S["radius"] == 150 and S["cellBytes"] == 64 * 1024 ** 2 and S["tileBytes"] == 32 * 1024 ** 2
    assert S["keep"] < S["radius"] and S["arrival"] < S["radius"]
    assert V["fogNear"] < V["fogFar"] <= V["far"] <= 300
    assert r["noon"].startswith("2026-09-22T12:00")


def test_the_left_stick_walks_where_you_look_and_the_right_turns_in_steps():
    r = node("""const W=m.META_WALK;
    console.log(JSON.stringify({
      north:m.stickWalk(0,-1,0,1,1), east:m.stickWalk(1,0,0,1,1), turned:m.stickWalk(0,-1,Math.PI/2,1,1),
      dead:m.stickWalk(.1,-.1,0,1,1),
      turnRight:m.snapTurn(.9,true), held:m.snapTurn(.9,false), released:m.snapTurn(.1,false), W}))""")
    assert r["north"][0] == pytest.approx(0, abs=1e-9) and r["north"][1] == pytest.approx(-1)
    assert r["east"][0] == pytest.approx(1) and r["east"][1] == pytest.approx(0, abs=1e-9)
    # Facing west (yaw +90 degrees), stick forward walks west.
    assert r["turned"][0] == pytest.approx(-1) and r["turned"][1] == pytest.approx(0, abs=1e-9)
    assert r["dead"] == [0, 0]
    assert r["turnRight"]["turn"] == pytest.approx(-math.radians(r["W"]["snapDeg"])) and not r["turnRight"]["armed"]
    assert r["held"] == {"turn": 0, "armed": False}
    assert r["released"] == {"turn": 0, "armed": True}


def test_the_floor_is_moved_to_your_feet_and_heading():
    r = node("""
    // The offset's inverse applied to the floor's origin is where you stand, facing yaw.
    const o=m.rigOffset(10,2,-30,Math.PI/2),q=o.orientation,p=o.position;
    // Inverse of (rotate by q, then translate by p) at the origin: -(R^-1 p).
    const yaw=2*Math.atan2(q.y,q.w),c=Math.cos(-yaw),s=Math.sin(-yaw);
    const ox=-(c*p.x+s*p.z),oz=-(-s*p.x+c*p.z);
    console.log(JSON.stringify({origin:[ox,-p.y,oz],yaw,heading:m.headingOf([0,Math.sin(Math.PI/4),0,Math.cos(Math.PI/4)])}))""")
    assert r["origin"] == pytest.approx([10, 2, -30])
    assert r["yaw"] == pytest.approx(-math.pi / 2)
    assert r["heading"] == pytest.approx(math.pi / 2)


def test_the_menu_is_search_directions_and_reset_and_its_rows_are_hit_where_drawn():
    r = node("""const rows=m.menuRows({query:'600 mont',results:[{label:'600 Montgomery'},{label:'Pyramid Cafe'}],mode:'walk',route:true});
    const at=(id)=>{const row=rows.find(x=>x.id===id);const x0=(row.x0??0),x1=(row.x1??1);
      return m.menuHit(rows,((x0+x1)/2)*(m.MENU_PX[0]-80)/m.MENU_PX[0]+40/m.MENU_PX[0],1-(row.y+row.h/2)/m.MENU_PX[1])?.id;};
    console.log(JSON.stringify({ids:rows.map(x=>x.id),hits:['search','go:1','dir:0','mode:transit','end-route','reset','close'].map(at),
      miss:m.menuHit(rows,.5,.001)}))""")
    assert r["ids"][:1] == ["search"] and "reset" in r["ids"] and "end-route" in r["ids"]
    assert {"go:0", "dir:0", "go:1", "dir:1", "mode:walk", "mode:drive", "mode:transit"} <= set(r["ids"])
    # No explore mode and no switching views: the headset is first person only.
    assert not any(i.startswith(("explore", "view", "firstperson")) for i in r["ids"])
    assert r["hits"] == ["search", "go:1", "dir:0", "mode:transit", "end-route", "reset", "close"]
    assert r["miss"] is None


def test_the_page_puts_the_headset_mode_together():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "const META = !ATTACH && document.querySelector('meta[name=\"kerbside-mode\"]')?.content === \"meta\";" in source
    assert "const STREAM = META ? { ...metaLibrary.META_STREAM }" in source
    assert "logarithmicDepthBuffer: !META" in source
    # First person only, no explore, no teleport animation, no strip or region fill to hold.
    assert "if (META && !on) return;   // the headset is first person only" in source
    assert "if (META && on) return;   // no explore mode in the headset" in source
    assert "options.travel && !META && !state.explore" in source
    assert "if (META) return null;   // the headset holds only the blocks round you" in source
    assert "if (META) { tileFill.rect = null; return; }" in source
    # Always noon, whatever is asked of the sky later.
    assert 'environmentController.setTime(metaLibrary.META_NOON);' in source
    # A, B and X; the session drives the frames and every one is drawn.
    for hook in ("describeCentre: () => describeAhead()", "enterOrLeave: () => enterOrLeave()",
                 "directionsTo: (place, mode) => window.kerbsideRoute.directionsTo(place, mode)",
                 "renderer.setAnimationLoop(animate)", "applyMemoryPlan: applyMetaMemoryPlan"):
        assert hook in source
    assert "if (!xrFrame && interval && now - lastFrameDrawnAt < interval - 2) return;" in source
    xr = (ROOT / "docs/meta-xr.mjs").read_text()
    assert 'requestSession("immersive-vr", { requiredFeatures: ["local-floor"] })' in xr
    assert "META_BUTTONS.a" in xr and "META_BUTTONS.b" in xr and "META_BUTTONS.x" in xr
    # The headset's keyboard opens over a focused text field, pressed from a select event.
    assert 'session.addEventListener("select"' in xr and "field.focus()" in xr


def test_the_headset_page_is_built_and_installable():
    page = (ROOT / "docs/meta.html").read_text()
    assert '<meta name="kerbside-mode" content="meta" />' in page
    assert '<link rel="manifest" href="meta.webmanifest" />' in page
    assert "__META_XR_HASH__" not in page and "meta-xr.mjs?rev=" in page
    manifest = json.loads((ROOT / "docs/meta.webmanifest").read_text())
    assert manifest["start_url"].startswith("./meta.html") and manifest["display"] == "standalone"
    assert {icon["sizes"] for icon in manifest["icons"]} >= {"512x512"}
    release = json.loads((ROOT / "docs/runtime-release.json").read_text())
    assert "meta.html" in release["consumers"] and "meta-xr.mjs" in release["runtime_assets_sha256"]
