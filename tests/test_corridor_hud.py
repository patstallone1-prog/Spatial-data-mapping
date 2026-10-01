"""The desktop viewer exposes every control in one collapsible sidebar."""

from html.parser import HTMLParser
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "build_sf_corridor_3d.py"
DOCS = SOURCE.parents[1] / "docs"


def test_map_controls_live_in_collapsible_sidebar():
    source = SOURCE.read_text()
    start = source.index('<div class="hud" id="hud"')
    end = source.index('<!-- The payload is fetched', start)
    hud = source[start:end]
    menu = hud.index('class="collapsible" id="controls"')
    sidebar = hud.index('class="panel" id="map-sidebar"')
    assert 'data-open="false"' in hud[:80]
    assert hud.index('id="fold"') < sidebar
    for control in ('id="region"', 'id="find"', 'id="firstperson"', 'id="reset"'):
        assert sidebar < hud.index(control) < menu
    for detail in ('id="obs"', 'id="eligible"', 'id="seq"', 'id="cells"',
                   'id="surfaces"', 'id="measured"', 'data-layer="observations"'):
        assert hud.index(detail) > menu
    assert 'aria-controls="map-sidebar"' in hud
    assert hud.count('id="firstperson"') == 1

    class LayerNesting(HTMLParser):
        def __init__(self):
            super().__init__()
            self.divs = []
            self.photo_in_menu = False
            self.tip_in_menu = False

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "div":
                self.divs.append(attrs.get("id"))
            if tag == "button" and attrs.get("data-layer") == "observations":
                self.photo_in_menu = "controls" in self.divs
            if tag == "div" and attrs.get("id") == "tip":
                self.tip_in_menu = "controls" in self.divs

        def handle_endtag(self, tag):
            if tag == "div":
                self.divs.pop()

    tree = LayerNesting()
    tree.feed(hud)
    assert tree.photo_in_menu
    assert tree.tip_in_menu
    assert hud.index('id="regionnote"') > menu


def test_hud_has_light_palette_and_menu_state_labels():
    source = SOURCE.read_text()
    assert 'color-scheme: light' in source
    assert 'fold.textContent = open ?' in source
    assert '"Close map controls"' in source
    assert '.hud[data-open="false"] .panel { display:none; }' in source
    assert '#addr .sub { color:#fff; }' in source


def test_click_moves_and_right_click_has_distant_safe_landing():
    source = SOURCE.read_text()
    assert 'goTo(landing, { travel: true });' in source
    assert 'goTo(landing, { travel: true, zoom: true });' in source
    assert 'const distant = !state.firstPerson && state.dist > 1200;' in source
    assert 'const feature = distant ? null : pickedFeature' in source
    assert 'if (d2 >= bestD2 || buildingAt(x, z)) continue;' in source
    assert 'const mappedWet = apron > 0 ? null : mappedWaterAt(x, z);' in source
    assert 'ground.clone().lerp(TERRAIN_LAND, Math.exp(-apron / TERRAIN_APRON_COLOUR_M))' in source


def test_published_app_viewers_and_shell_have_the_new_controls():
    viewers = [DOCS / "app-model.html", *sorted((DOCS / "app-regions").glob("*/app-model.html"))]
    assert len(viewers) >= 2
    for path in viewers:
        page = path.read_text()
        assert 'aria-controls="map-sidebar"' in page
        assert 'const landing = eligibleLanding(groundAt(e.clientX, e.clientY), distant);' in page
        assert 'if (zoom) state.dist = ARRIVAL_DIST;' in page
        assert '#addr .sub { color:#fff; }' in page
    app = (DOCS / "app.html").read_text()
    assert 'height: 100dvh; min-height: 0; border: 0; border-radius: 0;' in app
