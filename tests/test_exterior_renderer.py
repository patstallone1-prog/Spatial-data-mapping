"""Execute the actual geometry clipper and opt-in loader without a network dependency."""

import json
import runpy
import subprocess
from pathlib import Path

import pytest

from smc.exteriors.integration import instrument_viewer

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("angle,origin", [(0, [0, 0, 0]), (23, [1281, 5.7, -432])])
def test_actual_triangle_clipping_preserves_roof_uvs_and_source_vertices(angle, origin):
    # Three-compatible data buffers keep this arithmetic regression offline. The real
    # Three/WebGL implementation is exercised separately in the local browser cohort.
    areas = json.loads(
        subprocess.check_output(
            [
                "node",
                str(ROOT / "tests/fixtures/exterior-geometry-probe.mjs"),
                str(angle),
                json.dumps(origin),
            ],
            text=True,
        )
    )
    assert areas == pytest.approx([120, 80 - 6 * 3.9], abs=0.003)


def test_optional_map_loader_has_no_io_without_explicit_local_bundle():
    from tests.test_corridor_geometry_rules import _extract

    original = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))["HTML"]
    html = instrument_viewer(original)
    assert "loadStoreExteriorBundle" not in original
    fn = _extract("loadStoreExteriorBundle", html)
    js = (
        "async "
        + fn
        + """
let DATA={};function fetch(){throw Error('unexpected I/O');}
if(await loadStoreExteriorBundle()!==null)throw Error('default changed');
DATA={storefront_exteriors:{manifest:'storefront-exteriors.json',
 renderer:'https://foreign.invalid/code.mjs',assets:'assets/'}};
if(await loadStoreExteriorBundle()!==null)throw Error('foreign module accepted');
"""
    )
    subprocess.run(["node", "--input-type=module", "-e", js], check=True)
