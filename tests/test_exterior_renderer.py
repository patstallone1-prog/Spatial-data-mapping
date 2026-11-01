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


def test_map_loader_reads_only_this_sites_plans_and_never_foreign_code():
    from tests.test_corridor_geometry_rules import _extract

    original = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))["HTML"]
    html = instrument_viewer(original)
    assert html == original  # the hooks are the viewer's own now
    fn = _extract("loadStoreExteriorBundle", html)
    pattern = html[html.index("const STOREFRONT_PLAN_PATH="):]
    pattern = pattern[:pattern.index(";\n") + 1]
    js = (
        pattern
        + "\nasync "
        + fn
        + """
const LIGHT_SPEC=null,DATA={bbox:{west:-122.43,south:37.74,east:-122.40,north:37.77}};
const sharedAsset=n=>n;let index=null;const fetched=[];
async function fetch(url){fetched.push(url);if(url.startsWith('storefront-exteriors.manifest.json'))
 return {ok:Boolean(index),json:async()=>index};throw Error('unexpected I/O '+url);}
if(await loadStoreExteriorBundle()!==null)throw Error('loaded without a manifest');
for(const path of ['https://foreign.invalid/storefront-exteriors.json','../storefront-exteriors.json',
  'regions/x/plans.json','regions/x/storefront-exteriors.json?x=1']){
 index={schema:'kerbside.storefront_exterior_tiles/1',tiles:[{path,bbox:[-122.42,37.75,-122.41,37.76]}]};
 if(await loadStoreExteriorBundle()!==null)throw Error('foreign plan accepted '+path);}
index={schema:'kerbside.storefront_exterior_tiles/1',tiles:[{path:'regions/far/storefront-exteriors.json',bbox:[-121,36,-120.9,36.1]}]};
if(await loadStoreExteriorBundle()!==null)throw Error('plans for another area fetched');
if(fetched.some(u=>!u.startsWith('storefront-exteriors.manifest.json')))throw Error('fetched '+fetched);
"""
    )
    subprocess.run(["node", "--input-type=module", "-e", js], check=True)
