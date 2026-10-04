"""The conductor between two supports hangs as a catenary set by one realistic tension."""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(body: str) -> dict:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [0-9.]+;", js).group(0)
                       for name in ("WIRE_CATENARY_A_M", "WIRE_SAMPLES"))
    script = consts + "\n" + _extract("catenaryPoints", js) + "\n" + body
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_forty_metre_span_sags_about_a_metre_and_sag_grows_with_the_square_of_the_span() -> None:
    result = _run("""
    const sag = (L) => {
      const pts = []; catenaryPoints({ x: 0, y: 10, z: 0 }, { x: L, y: 10, z: 0 }, pts);
      let low = Infinity; for (let i = 1; i < pts.length; i += 3) low = Math.min(low, pts[i]);
      return { sag: 10 - low, first: pts.slice(0, 3), last: pts.slice(-3) };
    };
    console.log(JSON.stringify({ s25: sag(25), s40: sag(40), s60: sag(60) }));
    """)
    assert result["s40"]["sag"] == pytest.approx(1.0, abs=0.06)
    assert result["s25"]["sag"] == pytest.approx(0.39, abs=0.05)
    assert result["s60"]["sag"] == pytest.approx(2.25, abs=0.1)
    # The conductor starts and ends on its attachment points.
    assert result["s40"]["first"] == pytest.approx([0, 10, 0], abs=1e-6)
    assert result["s40"]["last"] == pytest.approx([40, 10, 0], abs=1e-6)


def test_a_span_between_supports_at_different_heights_ends_on_both() -> None:
    result = _run("""
    const pts = []; catenaryPoints({ x: 0, y: 9, z: 0 }, { x: 0, y: 12, z: 45 }, pts);
    let low = Infinity, at = 0;
    for (let i = 1; i < pts.length; i += 3) if (pts[i] < low) { low = pts[i]; at = pts[i + 1]; }
    console.log(JSON.stringify({ first: pts.slice(0, 3), last: pts.slice(-3), low, at }));
    """)
    assert result["first"] == pytest.approx([0, 9, 0], abs=1e-6)
    assert result["last"] == pytest.approx([0, 12, 45], abs=1e-6)
    # The lowest point moves toward the lower support and below it.
    assert result["low"] < 9 and result["at"] < 22.5
