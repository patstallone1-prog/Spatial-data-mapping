"""The simple city's streets stay over the landscape, and directions survive the window rebuild."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from tests.test_corridor_geometry_rules import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def test_coarse_ground_under_a_city_stands_under_every_point_of_its_cells() -> None:
    uri = (ROOT / "docs/nature-runtime.mjs").as_uri()
    script = f"import {{cityEnvelope}} from {json.dumps(uri)};" + """
// A 3x3 grid of vertices over a dip: corners 10 m, the true ground down to 4 m between them.
const heights=new Float32Array(9).fill(10);
const developed=Uint8Array.from([0,0,0,0,1,0,0,0,0]), open=new Uint8Array(9);
const floor=(c,r)=>c===1&&r===1?4:7;
console.log(JSON.stringify({city:[...cityEnvelope(heights,developed,3,3,floor,1)],
  country:[...cityEnvelope(heights,open,3,3,floor,1)]}));
"""
    out = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], text=True))
    # Every vertex beside the developed one goes to the lowest ground round it, less the margin.
    assert out["city"] == [6, 6, 6, 6, 3, 6, 6, 6, 6]
    # Open country keeps its shape.
    assert out["country"] == [10] * 9


def test_the_coarse_mesh_takes_the_envelope_and_the_tiles_the_landscapes_ground() -> None:
    runtime = (ROOT / "docs/nature-runtime.mjs").read_text()
    assert "const floor=cityEnvelope(heights,developed,nx+1,ny+1," in runtime
    page = _page_js()
    assert "function tileGroundAt(x, z) { return natureVisualHeightAt(x, z, null, false); }" in page
    sync = _extract("syncNatureTileHeights", page)
    assert "rawTerrainHeightAt" not in sync and sync.count("tileGroundAt(") == 3


def test_directions_keep_their_group_through_a_window_drawn_in_full() -> None:
    page = _page_js()
    assert "routeGroup.userData.bayWide = true;" in page
    assert "routeGroup.parent" not in page
    release = _extract("releaseHostWorld", page)
    assert "child.userData.bayWide) continue;" in release


def test_a_device_fix_off_the_map_starts_directions_at_the_walker() -> None:
    page = _page_js()
    assert ('if (gps.fix && regionAt(gps.fix.lon, gps.fix.lat)) return { label: "Your location", '
            'lon: gps.fix.lon, lat: gps.fix.lat, here: true };') in page
