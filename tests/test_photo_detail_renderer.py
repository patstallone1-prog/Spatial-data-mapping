import json
import shutil
import subprocess

import pytest

from tests.test_world_object_renderer import _extract, _page_js


def test_photo_detail_material_floor_alignment_and_rejection():
    if not shutil.which("node"):
        pytest.skip("Node required")
    detail = {
        "kind": "balcony",
        "render": True,
        "visible": True,
        "reviewer": "test",
        "image_sha256": "abc",
        "u": 2,
        "w": 3,
        "depth_m": 0.8,
        "colour": "#665544",
        "material": "metal",
        "style": "vertical_bars",
        "platform_heights_m": [3],
    }
    fit = {"a": [0, 0], "b": [10, 0], "height_m": 9, "image_sha256": "abc", "details": [detail]}
    script = (
        """
        let parts=[]; const BUILDING_LIFT_M=12;
        function xy(x,y){return [x,y];}
        function makeBox(x,y,z,w,h,d,color,roughness){return {position:{x,y:y+h/2,z},rotation:{},material:{color,roughness},dims:[w,h,d]};}
        function addMerged(key,mesh){parts.push(mesh);}
    """
        + "const fit="
        + json.dumps(fit)
        + "; function frontageFitFor(){return fit;}\n"
    )
    script += _extract("photoDetailParts", _page_js())
    script += """
        photoDetailParts({},{});
        if(parts.length<5)throw Error('railing missing');
        const slab=parts[0];
        if(Math.abs(slab.position.y-14.95)>.001 || slab.position.x!==3.5)throw Error('wrong floor or frontage');
        if(slab.material.metalness!==.65)throw Error('metal treated as concrete');
        parts=[]; fit.details[0].image_sha256='different'; photoDetailParts({},{});
        if(parts.length)throw Error('unrelated image rendered');
        fit.details[0].image_sha256='abc';fit.details[0].platform_heights_m=[9];photoDetailParts({},{});
        if(parts.length)throw Error('above roof detail');
    """
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
