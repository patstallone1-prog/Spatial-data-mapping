"""The standalone app (desktop/), and what had made the city slow: storefront glass drawn with
three.js's transmission (the whole scene drawn twice a frame), the crowd drawn in list order,
and the bikes searching routes every frame."""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "desktop/main.js"
PRELOAD = ROOT / "desktop/preload.js"
PACKAGE = ROOT / "desktop/package.json"
STOREFRONT = ROOT / "docs/storefront-renderer.mjs"
STOREFRONT_MANIFEST = ROOT / "docs/storefront-exteriors.manifest.json"
VIEW = ROOT / "docs/city/view.mjs"
CITY_MODULE = ROOT / "src/smc/renderer/page/module/30-the-living-city.js"
GITIGNORE = ROOT / ".gitignore"


def test_the_app_loads_the_site_with_its_own_memory_and_gpu_and_never_throttled() -> None:
    main = MAIN.read_text()
    assert 'const SITE = "https://spatial-data-mapping.vercel.app/app-model.html";' in main
    for switch in ("js-flags", "force_high_performance_gpu", "disable-renderer-backgrounding",
                   "disable-background-timer-throttling", "force-gpu-mem-available-mb"):
        assert f'appendSwitch("{switch}"' in main, switch
    assert "backgroundThrottling: false" in main and "contextIsolation: true" in main and "sandbox: true" in main
    # Off-site links go to the browser; permissions only for the site's own hosts.
    assert "shell.openExternal(url)" in main and "PERMISSIONS.has(permission) && trusted(" in main
    # Honest about the heap: V8's pointer compression keeps it at about 4 GiB here too.
    assert "pointer compression" in main
    assert "contextBridge.exposeInMainWorld(\"kerbsideDesktop\"" in PRELOAD.read_text()
    pkg = json.loads(PACKAGE.read_text())
    assert all(re.fullmatch(r"\d+\.\d+\.\d+", v) for v in pkg["devDependencies"].values()), "exact versions"
    assert "desktop/node_modules/" in GITIGNORE.read_text()


def test_no_world_renderer_uses_transmission_glass() -> None:
    sources = [STOREFRONT, VIEW, *sorted((ROOT / "src/smc/renderer/page/module").glob("*.js"))]
    for path in sources:
        text = path.read_text()
        assert not re.search(r"transmission\s*:\s*0?\.\d*[1-9]", text), path
    assert re.search(r"new THREE\.MeshStandardMaterial\(\{\s*color: p\.glass", STOREFRONT.read_text())
    # The renderer is fetched by its hash: a changed renderer is fetched again, not the cached one.
    manifest = json.loads(STOREFRONT_MANIFEST.read_text())
    assert manifest["renderer_sha256"] == hashlib.sha256(STOREFRONT.read_bytes()).hexdigest()[:16]


def test_the_crowd_is_drawn_in_view_nearest_first_and_bikes_look_twice_a_second() -> None:
    view = VIEW.read_text()
    assert "const seen = peopleInView(list);" in view and "for (const { p, y } of full)" in view
    assert "if (out.length > MAX_PEOPLE) { out.sort((a, b) => a.d - b.d); out.length = MAX_PEOPLE; }" in view
    assert "camera: () => camera," in CITY_MODULE.read_text()
    assert "tries: 3, every_s: 0.5" in view and "const look = Math.floor(now / 1000 / BIKES.every_s);" in view


def test_the_number_of_lights_in_the_world_never_changes() -> None:
    """three.js compiles every lit material again for each new count of lights: a lamp a room
    (1, 16, 29 lights as houses came near) was a hundred shader programs at a time and a freeze of
    one to twenty seconds, measured in Kerbside.app on 2026-11-22. The world has the sun, the sky
    and one indoor light; a fitting glows without being a light."""
    world = [STOREFRONT, VIEW, ROOT / "docs/inferred-interiors/kerbside-adapter.mjs",
             *sorted((ROOT / "src/smc/renderer/page/module").glob("*.js")),
             *sorted((ROOT / "docs/city").glob("*-room.mjs")), *sorted((ROOT / "docs/city").glob("restaurant-*.mjs"))]
    made = []
    for path in world:
        for line in path.read_text().splitlines():
            if re.search(r"new (THREE|T)\.(PointLight|SpotLight|RectAreaLight)\(", line):
                made.append((path.name, line.strip()[:80]))
    assert made == [("24-nearby-what-is-round-the.js", "const indoorLight = new THREE.PointLight(0xffe7c4, 0, 9, 2);")], made
    interiors = (ROOT / "docs/inferred-interiors/renderer.mjs").read_text()
    lights = [line for line in interiors.splitlines() if "new THREE.PointLight(" in line]
    assert len(lights) == 1 and lights[0].strip().startswith("if(options.roomLights){"), "a room's lamp is a light only where asked for"
    assert "roomLights" not in (ROOT / "docs/inferred-interiors/kerbside-adapter.mjs").read_text()
    assert "roomLights:true" in (ROOT / "docs/inferred-interiors/lab.mjs").read_text()


def test_matt_surfaces_are_lit_plainly_and_the_first_view_is_drawn_behind_the_loading_screen() -> None:
    """Measured in Kerbside.app on 2026-11-22: the standard material's highlight maths was most of
    a frame while the view turned (17.5 ms against 37.6 at double resolution without it), and the
    first seconds after going in stalled on work done inside single frames."""
    modules = ROOT / "src/smc/renderer/page/module"
    world = (modules / "02-reconstructed-world-objects.js").read_text()
    assert "const PLAIN_LIGHT = globalThis.__kerbsidePlainLight ||= {" in world
    # (Lambert's terms with their second declaration of the view position taken out: declared
    # twice the program did not compile, and what used it -- walls, trees -- was not drawn.)
    assert 'THREE.ShaderChunk.lights_lambert_pars_fragment.replace(/varying\\s+vec3\\s+vViewPosition\\s*;/, "")' in world
    # Glass and metal keep their highlights; the cache key tells the two kinds of program apart.
    assert "!(material.metalness > 0.3) && !(material.roughness < 0.35) && !material.envMap" in world
    assert 'plain = globalThis.__kerbsidePlainLight?.on(this) ? "|plain-light" : ""' in world
    assert "globalThis.__kerbsidePlainLight?.patch(shader, this);" in world
    loading = (modules / "28-the-headset.js").read_text()
    assert 'waiting.push("the first view");' in loading and "function warmDraw()" in loading
    # Drawn to the page's own picture (a shader is readied for the kind of picture it is drawn to).
    assert "renderer.setRenderTarget(null); renderer.setScissorTest(true); renderer.setScissor(0, 0, 4, 4); renderer.render(scene, camera);" in loading
    nature = (modules / "04-the-bay-s-bridges-built.js").read_text()
    assert "requestAnimationFrame(() => nextTask().then(pumpNatureTileHeights))" in nature
    assert "if(sphere)sphere.radius+=moved;else o.geometry.computeBoundingSphere();" in nature
    shell = (ROOT / "docs/interior-lab/empty-shell.mjs").read_text()
    assert "if(plainlyOut(box(x,z,a,L+.2,W+.2)))continue;" in shell
    assert "requestIdleCallback(resolve,{timeout:500})" in (modules / "23-pins-1-2-and-3.js").read_text()
