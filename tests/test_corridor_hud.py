"""The viewer's sidebar holds what is wanted at once; everything else is on the settings page."""

from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "build_sf_corridor_3d.py"
DOCS = SOURCE.parents[1] / "docs"


def test_the_sidebar_holds_only_what_is_wanted_at_once_and_the_rest_is_in_settings():
    source = SOURCE.read_text()
    start = source.index('<div class="hud" id="hud"')
    end = source.index('<!-- The payload is fetched', start)
    page = source[start:end]
    sidebar = page[page.index('class="panel" id="map-sidebar"'):page.index('<form class="panel sheet" id="settings-page"')]
    settings = page[page.index('id="settings-page"'):]
    assert 'data-open="false"' in page[:80] and page.index('id="fold"') < page.index('id="map-sidebar"')
    # At once: where to go, how to get there, how to look.
    for control in ('id="region"', 'id="find"', 'id="route-panel"', 'id="route-go"', 'id="firstperson"', 'id="reset"'):
        assert control in sidebar, control
    # Everything else: the numbers, the layers, the legend, the notes and how to get around.
    for detail in ('id="obs"', 'id="eligible"', 'id="seq"', 'id="cells"', 'id="surfaces"', 'id="measured"',
                   'data-layer="observations"', 'data-layer="gaps"', 'id="tip"', 'id="regionnote"',
                   'id="gapnote"', 'class="legend"', 'id="settings-display"'):
        assert detail in settings and detail not in sidebar, detail
    assert 'aria-controls="map-sidebar"' in page
    assert page.count('id="firstperson"') == 1
    # The quality and frame-rate choices are on the settings page; its button ends the sidebar.
    assert 'settingsPart("settings-display", "section").insertAdjacentHTML' in source
    assert sidebar.index('id="settings-toggle"') > sidebar.index('id="reset"')
    assert 'const settingsButton = document.getElementById("settings-toggle");' in source
    # The compass, a third smaller, at the top right.
    assert '"position:fixed;right:16px;top:16px;z-index:25;width:64px;height:80px;"' in source


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
    # Right click is a zoomed teleport only; looking a place up is the S key.
    menu = source[source.index('canvas.addEventListener("contextmenu"'):]
    menu = menu[:menu.index("});")]
    assert "showAddress" not in menu
    assert 'if (e.key !== "s" && e.key !== "S") return;' in source
    assert 'if (feature && feature.kind === "building" && showAddress(feature, cx, cy)) {' in source
    assert 'const name = ground ? streetNameAt(ground.x, ground.z) : null;' in source
    # No street names floating over the roads.
    assert 'labelAt(way.name' not in source
    assert 'if (d2 >= bestD2 || buildingAt(x, z)) continue;' in source
    assert 'const mappedWet = apron > 0 ? null : mappedWaterAt(x, z);' in source
    # Past the last street: plain grass at once, no grey fade and no grey town.
    assert 'const colour = sandy ? TERRAIN_SAND : TERRAIN_PLATE;' in source
    assert 'TERRAIN_APRON_COLOUR_M' not in source
    # Past the last street: source-classified nature, or grass when no atlas is available.
    # The separate behavioural nature test verifies both paths without requiring flat grass.
    assert 'return colour ? new THREE.Color().setRGB(...natureLibrary.linearColour(colour)) : TERRAIN_PLATE;' in source
    assert 'const shade = apronOf && at.colour !== TERRAIN_SEA && at.colour !== TERRAIN_SAND ? TERRAIN_PLATE : at.colour;' in source


def test_published_app_viewers_and_shell_have_the_new_controls():
    viewers = [DOCS / "app-model.html", *sorted((DOCS / "app-regions").glob("*/app-model.html"))]
    assert len(viewers) >= 2
    for path in viewers:
        page = path.read_text()
        assert 'aria-controls="map-sidebar"' in page
        assert 'const clicked=groundAt(e.clientX,e.clientY);' in page
        assert 'const landing = eligibleLanding(clicked, distant);' in page
        assert 'if (zoom) state.dist = ARRIVAL_DIST;' in page
        assert '#addr .sub { color:#fff; }' in page
    app = (DOCS / "app.html").read_text()
    assert 'height: 100dvh; min-height: 0; border: 0; border-radius: 0;' in app
