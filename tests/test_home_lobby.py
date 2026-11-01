"""The home screen: up at once, with the world loading behind it from the moment the app opens."""
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
        assert "needs-world" in line or "e.key === \"Enter\"" in line or "close: () =>" in line, line
    assert 'root.classList.remove("world-loading")' in lobby
