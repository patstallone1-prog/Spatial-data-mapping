"""The home screen: up at once on a still of the world, the world loading out of sight behind it."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDERER = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()


def test_home_opens_before_the_world_streams_in():
    opens = RENDERER.index("home.openHome({ ...homeContext(), account })")
    streaming = RENDERER.index('await import(sharedAsset("world-streaming.mjs')
    assert opens < streaming


def test_world_is_staged_behind_the_home_screen():
    # The camera goes to where Explore world lands while the lobby is up, so its detail streams.
    assert "if (document.body.classList.contains(\"home-open\")) stageWorld();" in RENDERER
    body = RENDERER[RENDERER.index("function stageWorld()"):]
    body = body[:body.index("\n}\n")]
    assert "applySpawn()" in body and "ARRIVAL_DIST" in body
    # Explore world takes the same placement, so a staged world does not move again.
    assert "if (enter) WORLD_READY.then(stageWorld)" in RENDERER


def test_app_shell_uncovers_the_model_for_its_home_screen():
    for path in ("tools/app_template.html", "docs/app.html"):
        page = (ROOT / path).read_text()
        assert 'w.document.getElementById("home")' in page
        assert "if ((done || home) && !completed)" in page
        assert "body.model-home:has(#v-map.on) nav.tabs { display: none; }" in page
    assert 'postMessage({ kerbside: "home", open }, location.origin)' in RENDERER


def test_first_install_does_not_reopen_the_loading_world():
    for path in ("tools/pwa/sw.js", "docs/sw.js"):
        worker = (ROOT / path).read_text()
        assert "upgrade = old.length > 0;" in worker
        assert '(upgrade ? self.clients.matchAll({ type: "window" }) : [])' in worker


def test_no_way_into_the_world_until_it_is_loaded_through():
    # Drawn is not loaded: the lobby waits for everything round the spawn, held for a moment.
    assert "whenReady: () => WORLD_LOADED," in RENDERER
    waiting = RENDERER[RENDERER.index("function worldLoadWaiting()"):]
    waiting = waiting[:waiting.index("\n}\n")]
    for need in ("attaching || attachWanted", "activeGuest && !activeGuest.ready", "cells.active || cells.queued",
                 "tileInFlight || tileQueue.length", "facadeQueue.length || facadeInFlight",
                 "demoCharacterLoaded === undefined", "!catalogueSettled"):
        assert need in waiting, need
    assert "now - settledSince >= SETTLED_FOR_MS" in RENDERER
    # The lobby opens long before the page's end: the promise it waits on must exist by then.
    assert RENDERER.index("const WORLD_LOADED = new Promise") < RENDERER.index("home.openHome({ ...homeContext()")
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    assert "if (!open || !loaded) return false;" in lobby
    # Every button that leaves the lobby for the world waits with it, and says so.
    leaving = [line for line in lobby.splitlines() if "closeHome(" in line and "function closeHome" not in line]
    assert len(leaving) >= 5
    for line in leaving:
        assert ("needs-world" in line or "e.key === \"Enter\"" in line or "close: () =>" in line
                or "if (loaded) { closeHome(true)" in line or "if (loading)" in line), line
    assert 'root.classList.remove("world-loading")' in lobby


def test_enter_world_goes_in_or_to_the_loading_screen():
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    # One big way in, never disabled: in at once when ready, else the loading screen, which goes
    # in by itself once the world is loaded.
    assert '"Enter world"' in lobby and '"Explore world"' not in lobby
    go = next(line for line in lobby.splitlines() if '"Enter world"' in line)
    assert "aria-disabled" not in go and "needs-world" not in go and "enter()" in go
    enter = lobby[lobby.index("function enter()"):]
    enter = enter[:enter.index("\n  }\n")]
    assert "if (loaded) { closeHome(true); return; }" in enter and "loadscreen" in enter
    assert "if (loading) setTimeout(() => closeHome(true)" in lobby
    # The bar is drawn every frame toward the world's fraction, and says how far it is.
    assert "loading.frame = requestAnimationFrame(drawBar)" in lobby and "loading.pct.textContent" in lobby
    assert "fraction: loadFraction" in RENDERER


def _load_fraction(script):
    """Run the page's loadFraction on a fake clock and progress line."""
    code = RENDERER[RENDERER.index("const BOOT_STAGES"):RENDERER.index("window.kerbsideLoadFraction")]
    prelude = """
let clock = 0, line = "", worldReadyNow = false, worldLoadedNow = false, waiting = [];
const performance = { now: () => clock };
const document = { getElementById: () => ({ textContent: line }) };
const worldLoadWaiting = () => waiting;
"""
    out = subprocess.run(["node", "-e", prelude + code + script], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_the_loading_bar_moves_evenly_through_the_build():
    # The stages as an app boot ran them (2026-11-03), sampled every quarter second.
    seen = _load_fraction("""
const timeline = [[0, "Loading the corridor…"], [9000, "Building the streets: 40%"], [11000, "Building the streets: 90%"],
  [13000, "Standing the streets on the ground: 10%"], [18000, ""], [19000, "Standing the ground cover on the hill: 5%"],
  [22000, "Standing the streets on the ground: 60%"], [27000, "Setting the pads on the pavement"],
  [27500, "Painting the crossings and lanes on the road"]];
const out = [];
for (clock = 0; clock <= 40000; clock += 250) {
  for (const [at, text] of timeline) if (clock >= at) line = text;
  if (clock === 31000) { worldReadyNow = true; waiting = ["map cells (12)"]; }
  if (clock === 34000) waiting = ["map cells (3)"];
  if (clock === 38000) worldLoadedNow = true;
  out.push(loadFraction());
}
process.stdout.write(JSON.stringify(out));
""")
    steps = [b - a for a, b in zip(seen, seen[1:])]
    assert min(steps) >= 0                          # never back
    assert max(steps[:-1]) < 0.06                   # no jumps: under 6% in a quarter second
    assert seen[4 * 8] > 0.12                       # the fetch moves the bar, no figure needed
    assert 0.7 <= seen[4 * 30] <= 0.8               # most of the bar is the build before the first frame
    assert seen[-1] == 1


def test_the_loading_bar_is_readable_before_the_build_reaches_the_page_end():
    # The lobby opens early and polls: its state must exist before the home screen opens, or the
    # read throws and the bar stands still for the whole build.
    assert RENDERER.index("function loadFraction()") < RENDERER.index("home.openHome({ ...homeContext(), account })")
    assert RENDERER.index("const bootLoad =") < RENDERER.index("home.openHome({ ...homeContext(), account })")


def test_the_home_screen_is_a_still_of_the_world_not_the_world_loading():
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    assert "backdrop-filter" not in lobby          # nothing of the loading world shows through
    assert "var(--shot,none) center/cover" in lobby
    names = re.findall(r'\["([a-z-]+)", "[^"]+"\]', lobby[lobby.index("export const HOME_SHOTS"):lobby.index("const SHOT_KEY")])
    assert len(names) == 10
    for name in names:
        shot = ROOT / "docs/home-shots" / f"{name}.jpg"
        assert shot.is_file() and shot.stat().st_size < 600_000, name
    # The next still each opening, wrapping round.
    out = subprocess.run(["node", "--input-type=module", "-e", f"""
      import {{ nextShot, HOME_SHOTS }} from {json.dumps((ROOT / "docs/home-lobby.mjs").as_uri())};
      const kept = new Map(); const storage = {{ getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) }};
      const seen = Array.from({{ length: HOME_SHOTS.length + 2 }}, () => nextShot(storage));
      console.log(JSON.stringify(seen));"""], capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]
