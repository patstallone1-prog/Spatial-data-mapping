"""Run the actual worker and startup policy against persistent-state fixtures."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest


def test_returning_visitor_cache_behaviors():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node required (installed in CI)")
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [node, "--test", "tests/browser_cache.test.mjs"],
        cwd=root,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_published_worker_is_the_current_source_policy():
    root = Path(__file__).resolve().parents[1]
    published = (root / "docs/sw.js").read_text()
    version = re.search(r'const VERSION = "([0-9a-f]{16})";', published).group(1)
    assert (root / "tools/pwa/sw.js").read_text().replace("__VERSION__", version) == published


def test_mutable_detail_shards_revalidate_across_all_app_consumers():
    root = Path(__file__).resolve().parents[1]
    pages = [
        root / "scripts/build_sf_corridor_3d.py",
        root / "docs/app-model.html",
        *sorted((root / "docs/app-regions").glob("*/app-model.html")),
    ]
    for page in pages:
        assert 'fetch(asset(shard.file), { cache: "no-cache" })' in page.read_text(), page
        assert 'cache: "force-cache"' not in page.read_text(), page


def test_installed_apps_check_updates_on_resume_without_automatic_reloads():
    root = Path(__file__).resolve().parents[1]
    for path in (root / "tools/app_template.html", root / "docs/app.html"):
        code = path.read_text().split('/* ============ installed app shell ============ */')[1]
        code = code.split('/* ============ boot ============ */')[0]
        assert 'updateViaCache: "none"' in code
        assert 'workerRegistration.update()' in code
        assert 'addEventListener("visibilitychange", checkInstalledUpgrade)' in code
        assert 'addEventListener("focus", checkInstalledUpgrade)' in code
        assert 'setInterval(checkInstalledUpgrade, 300000)' in code
        assert 'button.addEventListener("click", () => window.location.reload())' in code
