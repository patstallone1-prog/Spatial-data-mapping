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
