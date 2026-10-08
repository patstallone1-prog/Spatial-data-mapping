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
    result = subprocess.run([node, "--test", "tests/browser_cache.test.mjs"], cwd=root,
                            text=True, capture_output=True, timeout=30, check=False)
    assert result.returncode == 0, result.stdout + result.stderr


def test_published_worker_is_the_current_source_policy():
    root = Path(__file__).resolve().parents[1]
    published = (root / "docs/sw.js").read_text()
    version = re.search(r'const VERSION = "([0-9a-f]{16})";', published).group(1)
    assert (root / "tools/pwa/sw.js").read_text().replace("__VERSION__", version) == published
