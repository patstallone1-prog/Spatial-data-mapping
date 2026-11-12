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
    assert "new THREE.MeshStandardMaterial({\n          color: p.glass" in STOREFRONT.read_text()
    # The renderer is fetched by its hash: a changed renderer is fetched again, not the cached one.
    manifest = json.loads(STOREFRONT_MANIFEST.read_text())
    assert manifest["renderer_sha256"] == hashlib.sha256(STOREFRONT.read_bytes()).hexdigest()[:16]


def test_the_crowd_is_drawn_in_view_nearest_first_and_bikes_look_twice_a_second() -> None:
    view = VIEW.read_text()
    assert "for (const { p, y } of peopleInView(list))" in view
    assert "if (out.length > MAX_PEOPLE) { out.sort((a, b) => a.d - b.d); out.length = MAX_PEOPLE; }" in view
    assert "camera: () => camera," in CITY_MODULE.read_text()
    assert "tries: 3, every_s: 0.5" in view and "const look = Math.floor(now / 1000 / BIKES.every_s);" in view
