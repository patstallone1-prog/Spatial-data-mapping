"""Keep the map navigation visible and the data-rich controls accessible."""

from pathlib import Path
from html.parser import HTMLParser


SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "build_sf_corridor_3d.py"


def test_compact_hud_keeps_search_and_view_controls_outside_more_menu():
    source = SOURCE.read_text()
    start = source.index('<div class="hud" id="hud"')
    end = source.index('<!-- The payload is fetched', start)
    hud = source[start:end]
    menu = hud.index('class="collapsible" id="controls"')
    assert 'data-open="false"' in hud[:80]
    for control in ('id="region"', 'id="find"', 'id="firstperson"',
                    'id="reset"', 'id="fold"'):
        assert hud.index(control) < menu
    for detail in ('id="obs"', 'id="eligible"', 'id="seq"', 'id="cells"',
                   'id="surfaces"', 'id="measured"', 'data-layer="observations"'):
        assert hud.index(detail) > menu
    assert 'More controls</button>' in hud
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
    assert 'fold.textContent = open ? "More controls" : "Hide controls"' in source
    assert '.hud[data-open="false"] .collapsible { display:none; }' in source
