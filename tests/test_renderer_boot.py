"""A recovered startup callback must not strand a rendered world behind Retry."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_world_object_renderer import _extract

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
BOOT = SOURCE[SOURCE.index("window.kerbsideBoot ="):SOURCE.index("</script>",
              SOURCE.index("window.kerbsideBoot ="))]
FRAME = _extract("markBootRendered", SOURCE)
WATCH = _extract("watchModel", (ROOT / "tools/app_template.html").read_text())


def run(body):
    if not shutil.which("node"):
        pytest.skip("Node required for renderer boot regression")
    script = """
const listeners = new Map(), warnings = [], timers = [];
const rendererWindow = {addEventListener: (name, fn) => listeners.set(name, fn),
  document: {getElementById: () => null}};
const window = rendererWindow;
const console = {warn: (...args) => warnings.push(args)};
""" + BOOT + "\n" + FRAME + "\n" + """
const fail = () => listeners.get('error')({target: window, error: Error('optional callback')});
const output = value => process.stdout.write(JSON.stringify(value));
""" + body
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_an_actual_successful_frame_retires_the_earlier_startup_failure():
    result = run("""
fail();
window.kerbsideReady = {streets: true, ground: true};
const beforeFrame = {...window.kerbsideBoot};
markBootRendered();
fail(); // A later optional failure is a warning, not a map reset.
output({beforeFrame, afterFrame: window.kerbsideBoot, warnings: warnings.length});
""")
    assert result["beforeFrame"]["error"] and not result["beforeFrame"]["rendered"]
    assert result["afterFrame"]["error"] is None and result["afterFrame"]["rendered"]
    assert result["warnings"] == 1


@pytest.mark.parametrize("ready", [{}, {"streets": True}, {"ground": True}])
def test_incomplete_world_cannot_clear_a_real_boot_failure(ready):
    result = run(f"""
fail(); window.kerbsideReady = {json.dumps(ready)};
markBootRendered(); output(window.kerbsideBoot);
""")
    assert result["error"] and not result["rendered"]


def test_graphics_loss_cannot_be_mistaken_for_a_successful_frame():
    result = run("""
window.kerbsideReady = {streets: true, ground: true};
window.kerbsideBoot.contextLost = true;
window.kerbsideBoot.error = 'Graphics interrupted';
window.kerbsideBoot.errorKind = 'graphics';
markBootRendered(); output(window.kerbsideBoot);
""")
    assert result["error"] == "Graphics interrupted" and not result["rendered"]


def test_real_context_events_keep_retry_until_the_context_is_restored():
    start = SOURCE.index("  let contextLostTimer = 0;")
    handlers = SOURCE[start:SOURCE.index("\n}\n// A logarithmic depth buffer", start)]
    result = run("""
const canvasEvents = new Map(), delayed = [];
const canvas = {addEventListener:(name,fn)=>canvasEvents.set(name,fn)};
const setTimeout = fn => {delayed.push(fn); return delayed.length;};
const clearTimeout = () => {};
""" + handlers + """
window.kerbsideReady = {streets:true,ground:true};
markBootRendered();
canvasEvents.get('webglcontextlost')(); delayed.shift()();
fail(); markBootRendered();
const lost = {...window.kerbsideBoot};
canvasEvents.get('webglcontextrestored')(); markBootRendered();
output({lost,restored:window.kerbsideBoot});
""")
    assert result["lost"]["errorKind"] == "graphics" and result["lost"]["contextLost"]
    assert result["restored"]["error"] is None and not result["restored"]["contextLost"]


def test_installed_shell_uncovers_the_world_after_recovery():
    result = run(WATCH + """
const elements = new Map();
for (const name of ['mapload','ml-fill','ml-pct','ml-stage','ml-retry']) {
  const classes = new Set();
  elements.set(name, {style:{},hidden:false,textContent:'',
    classList:{add:c=>classes.add(c), remove:c=>classes.delete(c), contains:c=>classes.has(c)},
    addEventListener:()=>{}});
}
elements.set('model', {contentWindow:window,addEventListener:()=>{}});
const document = {getElementById:name=>elements.get(name)};
const setTimeout = (fn, ms) => {if(ms === 500) fn(); else timers.push(fn);};
fail(); watchModel();
const failed = {text:elements.get('ml-pct').textContent,retry:!elements.get('ml-retry').hidden};
window.kerbsideReady = {streets:true,ground:true};
markBootRendered(); timers.shift()();
output({failed,done:elements.get('mapload').classList.contains('done'),
  display:elements.get('mapload').style.display,retry:!elements.get('ml-retry').hidden});
""")
    assert result == {"failed": {"text": "Load stopped", "retry": True},
                      "done": True, "display": "none", "retry": False}


def test_frame_is_confirmed_after_rendering_and_never_while_paused():
    body = _extract("animate", SOURCE)
    start = body.index("if (!worldPaused) {")
    rendered = body.index("renderer.render(scene, camera);", start)
    confirm = body.index("if (!ATTACH) markBootRendered();", rendered)
    assert body[start:confirm].count("}") == 0


def test_three_loads_from_the_site_not_a_cached_cdn_stub():
    # esm.sh serves its three stub as immutable for a year and has retired the
    # builds old stubs point at, so a cached stub fails boot for that profile.
    page = (ROOT / "docs/app-model.html").read_text()
    importmap = page.index('map.type = "importmap"')
    assert importmap < page.index('<script type="module"')
    vendor = ROOT / "docs/vendor/three-0.160.0"
    for path in re.findall(r'from "(https://esm\.sh/three@0\.160\.0[^"]*)"', page):
        relative = path.removeprefix("https://esm.sh/three@0.160.0").lstrip("/")
        assert (vendor / (relative or "three.module.min.js")).exists(), path
    assert (vendor / "LICENSE").exists()
