from pathlib import Path

from tests.test_nature_atlas import node
from tests.test_world_object_renderer import _page_js


def test_city_water_bypasses_land_grain_and_matches_ocean_brdf():
    js = _page_js()
    start = js.index('const INDOOR_CUT_MAX =')
    end = js.index('if (TERRAIN_FRAME)', start)
    result = node('''
const THREE={Vector2:class{},Vector4:class{}};
const TERRAIN_MATERIAL={},TERRAIN_SEA={r:.025,g:.12,b:.24};
''' + js[start:end] + '''
const shader={uniforms:{},vertexShader:'#include <common>\\n#include <project_vertex>',
 fragmentShader:'void main() {\\n#include <map_fragment>\\n#include <color_fragment>\\n#include <roughnessmap_fragment>\\n#include <metalnessmap_fragment>\\n#include <normal_fragment_maps>\\n}'};
TERRAIN_MATERIAL.onBeforeCompile(shader);
console.log(JSON.stringify({fragment:shader.fragmentShader,guest:!!shader.uniforms.uGuestBox,
 indoor:!!shader.uniforms.uCutRing}));
''')
    fragment = result['fragment']
    assert result['guest'] and result['indoor']
    assert fragment.index('diffuseColor.rgb = mix') > fragment.index('#include <map_fragment>')
    assert 'mix(roughnessFactor, .62, terrainWet)' in fragment
    assert 'mix(metalnessFactor, .04, terrainWet)' in fragment
    assert 'mat3(viewMatrix) * vec3(0., 1., 0.)' in fragment
    nature = (Path(__file__).resolve().parents[1] / 'docs/nature-runtime.mjs').read_text()
    assert 'roughnessFactor=mix(1.,.62,natureWet)' in nature
    assert 'metalnessFactor=.04*natureWet' in nature
    assert 'mat3(viewMatrix)*vec3(0.,1.,0.)' in nature


def test_loading_boundaries_do_not_draw_physical_rectangle_in_ocean():
    js = _page_js()
    assert 'regionMarkers.add(outline)' not in js
    assert 'sprite.userData.surface = "region_marker"' in js
