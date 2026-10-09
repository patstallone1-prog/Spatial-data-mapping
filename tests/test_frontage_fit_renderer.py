import json
import shutil
import subprocess

import pytest

from tests.test_world_object_renderer import _extract, _page_js


def test_only_reviewed_fits_map_to_correct_edge_with_same_window_design():
    if not shutil.which("node"):
        pytest.skip("Node required")
    fit = {
        "height_m": 6,
        "review_status": "reviewed_inferred_visual_parameters",
        "canonical_geometry_modified": False,
        "conflicts": [],
        "canonical_footprint": [[0, 0], [10, 0], [10, 10]],
        "a": [0, 0],
        "b": [10, 0],
        "openings": [
            {
                "kind": "window",
                "u": 2,
                "v": 1,
                "w": 3,
                "h": 1,
                "design": {"shape": "panoramic", "vertical_bars": [0.2, 0.6]},
            }
        ],
    }
    code = (
        "const FRONTAGE_FITS="
        + json.dumps({"schema": "kerbside.facade_fits/1", "buildings": {"1": fit}})
        + ";\n"
    )
    code += "function xy(x,y){return [x,y];}\n"
    code += "\n".join(
        _extract(name, _page_js())
        for name in ("frontageFitFor", "frontageWindowsOnEdge", "houseCertainty")
    )
    code += """
      const entry = {way:{osm_id:1,height_m:6,points:[[0,0],[10,0],[10,10]]}};
      const forward=frontageWindowsOnEdge(entry,[0,0],[10,0],10,2);
      const reverse=frontageWindowsOnEdge(entry,[10,0],[0,0],10,2);
      if(forward[0].u!==2 || forward[0].v!==3 || reverse[0].u!==5) throw Error("reversed or wrong elevation");
      if(reverse[0].design.shape!=="panoramic" || reverse[0].w!==3) throw Error("style lost");
      if(reverse[0].design.vertical_bars[0]!==.8) throw Error("mullions not mirrored");
      if(frontageFitFor({...entry.way,points:[[0,0],[9,0],[9,10]]})!==null) throw Error("stale footprint accepted");
      if(frontageWindowsOnEdge(entry,[0,0],[0,10],10,0)!==null) throw Error("party wall claimed");
      if(frontageFitFor({osm_id:1,height_m:7})!==null) throw Error("stale height accepted");
      FRONTAGE_FITS.buildings[1].openings.push({kind:"garage_candidate",recess:{render_steps:true}});
      if(frontageFitFor(entry.way)!==null) throw Error("garage stair conflict rendered");
      FRONTAGE_FITS.buildings[1].openings.pop();
      FRONTAGE_FITS.buildings[1].review_status="needs_visual_alignment_review";
      if(frontageFitFor(entry.way)!==null) throw Error("unreviewed promoted");
      const MATERIAL_ASSIGNMENTS={assigned:{}};
      if(!houseCertainty(entry.way).front.includes("inferred")) throw Error("unknown facade claimed reviewed");
      if(houseCertainty(entry.way).metricAccuracy!=="not inch-verified") throw Error("invented precision");
    """
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
