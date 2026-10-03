"""Survey grids can have a different origin and scale from the city payload."""
import json

import pytest

from tests.test_home_shell import run_js


def test_shifted_grid_sampling_masks_and_drawing_share_the_same_physical_point():
    out = run_js(["pageToTerrain", "terrainToPage", "terrainFlatRadius", "rawTerrainHeightAt", "mappedWaterAt", "mappedBuiltAt"], """
      const midLon=-122.2725, midLat=37.8, metersPerLat=111320;
      const metersPerLon=111320*Math.cos(midLat*Math.PI/180);
      const TERRAIN_FRAME={mid_lon:-122.2725,mid_lat:37.805,
        metres_per_lon:87954.1015555659,metres_per_lat:111320,
        x0:0,y0:0,step_m:2,rows:3,cols:3,base_m:10,nodata:-32768};
      const TERRAIN={data:new Int16Array([100,200,300,400,500,600,700,800,900])};
      const LANDWATER=new Uint8Array([0,0,0,0,2,0,0,0,1]);
      const OPEN_WATER_GROUND_M=0;
      const f=TERRAIN_FRAME, p=terrainToPage(3,3,f), water=terrainToPage(5,5,f);
      console.log(JSON.stringify({point:p,roundTrip:pageToTerrain(...p,f),
        height:rawTerrainHeightAt(...p),built:mappedBuiltAt(...p),
        water:mappedWaterAt(...water),dry:mappedWaterAt(...p),flat:terrainFlatRadius(f)}));
    """)
    assert out["roundTrip"] == pytest.approx([3, 3], abs=1e-7)
    assert out["point"][1] == pytest.approx(-559.6, abs=1e-6)
    assert out["height"] == pytest.approx(15, abs=1e-6)
    assert out["built"] and out["water"] and not out["dry"]
    assert out["flat"] > abs(out["point"][1])


@pytest.mark.parametrize("page", ["docs/app-model.html", "docs/app-regions/oakland-downtown/app-model.html"])
def test_real_grid_vertices_return_to_their_original_survey_location(page):
    from tests.test_home_shell import ROOT
    directory = (ROOT / page).parent
    f = json.loads((directory / "sf-corridor-terrain.json").read_text())["frame"]
    bbox = json.loads((directory / "sf-corridor-3d.json").read_text())["bbox"]
    out = run_js(["pageToTerrain", "terrainToPage"], f"""
      const midLon={(bbox['west'] + bbox['east']) / 2}, midLat={(bbox['north'] + bbox['south']) / 2};
      const metersPerLat=111320, metersPerLon=111320*Math.cos(midLat*Math.PI/180);
      const f={json.dumps(f)};
      const east=f.x0+(f.cols-0.5)*f.step_m,north=f.y0+(f.rows-0.5)*f.step_m;
      console.log(JSON.stringify(pageToTerrain(...terrainToPage(east,north,f),f)));
    """)
    assert out == pytest.approx([f["x0"] + (f["cols"] - .5) * f["step_m"],
                                 f["y0"] + (f["rows"] - .5) * f["step_m"]], abs=1e-6)
