"""Masts are not houses, courts are acrylic, sports are fenced apart, and woods reach their trails."""

from __future__ import annotations

import importlib.util
import json
import math
import re
import subprocess
from itertools import pairwise

import numpy as np
import pytest

from smc.ground.courts import court_complexes
from tests.test_corridor_geometry_rules import NODE, _extract, _page_js
from tests.test_court_complexes import ROOT, rect, to_lonlat, to_metres


def _length(points) -> float:
    pts = [to_metres(*p) for p in points]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in pairwise(pts))


def test_one_sport_shares_open_run_off_and_two_sports_are_fenced_apart() -> None:
    # Moscone's west block: three tennis courts beside a basketball court, 5 m between.
    pitches = [rect("tennis", 0, 0), rect("tennis", 0, 14.7), rect("tennis", 0, 29.4),
               rect("basketball", 29, 0, 28.0, 15.0)]
    [block] = court_complexes(pitches, to_metres, to_lonlat)
    [fence] = block["d"]
    assert fence["s"] == ["basketball", "tennis"]
    xs = [to_metres(*p)[0] for p in fence["p"]]
    # Midway across the run-off between them (the tennis courts end at 23.8, basketball starts
    # at 29), and as long as the courts face each other.
    assert all(25.0 < x < 28.0 for x in xs)
    assert _length(fence["p"]) > 12
    # Courts of one game are never fenced from each other, a half court included.
    [same] = court_complexes([rect("tennis", 0, 0), rect("tennis", 0, 14.7)], to_metres, to_lonlat)
    assert "d" not in same
    [hoops] = court_complexes([rect("basketball", 0, 0, 28, 15), rect("basketball_half", 0, 19, 14, 15)],
                              to_metres, to_lonlat)
    assert "d" not in hoops


def test_the_page_fences_a_block_between_its_sports_and_paints_courts_in_srgb() -> None:
    js = _page_js()
    courts = _extract("buildCourts", js)
    assert "dividers: c.d || []" in courts
    assert "(pitch.dividers || []).map" in courts
    assert "texture.colorSpace = THREE.SRGBColorSpace;" in _extract("courtSurface", js)


def test_moscone_basketball_is_fenced_from_its_tennis() -> None:
    ground = json.loads((ROOT / "docs/app-sf-corridor-ground.json").read_text())
    fenced = [d for c in ground["court_complexes"] for d in c.get("d", [])
              if -122.4350 < d["p"][0][0] < -122.4300 and 37.8005 < d["p"][0][1] < 37.8050]
    assert len(fenced) >= 2 and all(d["s"] == ["basketball", "tennis"] for d in fenced)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_mast_is_a_pole_with_a_cell_head_and_a_cabinet_is_a_low_box() -> None:
    js = _page_js()
    script = "\n".join([
        "import * as THREE from " + json.dumps((ROOT / "tools/unreal/node_modules/three/build/three.module.js").as_uri()) + ";",
        re.search(r"const STRUCTURE_POLE_M = [0-9.]+;", js).group(0),
        re.search(r"const STRUCTURE_BOX_M = [0-9.]+;", js).group(0),
        "const FACADE_UV = undefined;",
        "const xy = (lon, lat) => [(lon + 122.43) * 88000, (lat - 37.8) * 111000];",
        "const groundBaseFor = () => 0, random = () => 0.5, outbuildingTexture = () => null;",
        "function footprintShape(points) { const s = new THREE.Shape(); points.forEach((p, i) => { const [x, y] = xy(...p); i ? s.lineTo(x, y) : s.moveTo(x, y); }); return s; }",
        js[js.index("const structurePoles = new Map();"):js.index("function buildingMesh(feature) {")],
        """
        const square = (lon, lat, m) => { const d = m / 88000, e = m / 111000;
          return [[lon, lat], [lon + d, lat], [lon + d, lat + e], [lon, lat + e], [lon, lat]]; };
        const surfaces = (g) => { const s = []; g.traverse((o) => o.userData.surface && s.push(o.userData.surface)); return s; };
        const big = structureMesh({ osm_id: 1, points: square(-122.4318, 37.8022, 2.2), height_source: 'inferred_default', height_m: 10.5 }, 4.4);
        const inner = structureMesh({ osm_id: 2, points: square(-122.43181, 37.80221, 1.3), height_source: 'inferred_default', height_m: 10.5 }, 1.6);
        const cabinet = structureMesh({ osm_id: 3, points: square(-122.42, 37.80, 3.2).map(([a, b], i) => [a, i === 2 || i === 3 ? b - 1.2 / 111000 : b]), height_source: 'inferred_default', height_m: 10.5 }, 6.4);
        const top = (g) => { const b = new THREE.Box3().setFromObject(g); return +(b.max.y - b.min.y).toFixed(2); };
        console.log(JSON.stringify({ big: surfaces(big), bigTall: top(big), inner: surfaces(inner),
          cabinet: surfaces(cabinet), cabinetTall: top(cabinet) }));
        """,
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["big"].count("structure:mast") == 1 and got["big"].count("structure:antenna") == 3
    assert 10 < got["bigTall"] < 11
    # The smaller footprint drawn inside it is the same mast, not a second one.
    assert got["inner"] == []
    assert got["cabinet"] == ["structure", "structure:cabinet"] and got["cabinetTall"] == 2.6


def _ecology():
    spec = importlib.util.spec_from_file_location("eco", ROOT / "scripts/build_nature_ecology.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_trail_through_a_wood_and_a_wooded_park_are_planted_and_a_city_is_not() -> None:
    pytest.importorskip("rasterio")
    eco = _ecology()
    cover = np.full((7, 9), 42, np.uint8)
    cover[:, 4] = 22                       # a fire road's strip through the wood
    cover[0, :] = 23                       # and a paved edge along the top
    cover[4:, 6:] = 24                     # a corner of town
    canopy = np.full(cover.shape, 60, np.uint8)
    canopy[4:, 6:] = 10
    out = eco.vegetated_cover(cover, canopy)
    assert (out[2:6, 4] == 42).all()       # the strip is the wood it runs through
    assert out[1, 4] == 21 and out[6, 4] == 21   # and at its ends, open ground under the trees
    assert (out[4:, 6:] == 24).all()       # high-intensity town stays town
    park = np.array([[21, 22, 22], [22, 22, 22], [22, 22, 23]], np.uint8)
    out = eco.vegetated_cover(park, np.full(park.shape, 55, np.uint8))
    # Under canopy beside open ground (where the path tiles carry the buildings), open space...
    assert out[0, 1] == out[1, 0] == out[1, 1] == 21
    # ...and deep in a leafy block, with no building clearance known, what NLCD says.
    assert out[0, 2] == out[2, 0] == 22 and out[2, 2] == 23
    bare = eco.vegetated_cover(park, np.full(park.shape, 10, np.uint8))
    assert (bare == park).all()            # no canopy: what NLCD says


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_page_and_the_floor_build_plant_the_same_cells() -> None:
    pytest.importorskip("rasterio")
    eco = _ecology()
    rng = np.random.default_rng(7)
    kinds = np.array([0, 11, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 90, 95], np.uint8)
    cover = rng.choice(kinds, size=(40, 50)).astype(np.uint8)
    canopy = rng.integers(0, 101, size=cover.shape).astype(np.uint8)
    canopy[rng.random(cover.shape) < 0.1] = 255
    module = json.dumps((ROOT / "docs/nature-ecology.mjs").as_uri())
    script = (f"import {{vegetatedCover}} from {module};\n"
              f"const c=Uint8Array.from({json.dumps(cover.ravel().tolist())}),k=Uint8Array.from({json.dumps(canopy.ravel().tolist())});\n"
              f"console.log(JSON.stringify([...vegetatedCover(c,k,{cover.shape[1]},{cover.shape[0]})]));")
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == eco.vegetated_cover(cover, canopy).ravel().tolist()


def test_the_landscape_plants_on_the_vegetated_cover_and_keeps_the_source() -> None:
    runtime = (ROOT / "docs/nature-runtime.mjs").read_text()
    assert "const plantCover=vegetatedCover(cover,canopy,f.cols,f.rows);" in runtime
    assert "cover:plantCover[i]" in runtime and "water:cover[i]===11" in runtime
    assert "habitatMixture(plantCover,canopy" in runtime


def test_a_fire_road_is_drawn_its_own_width_and_finish() -> None:
    import shutil
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    module = json.dumps((ROOT / "docs/nature-runtime.mjs").as_uri())
    script = (f"import {{inferredWidth,NATURE_ROADS}} from {module};\n"
              "const w=(kind,surface,width_source='inferred',trail=false)=>inferredWidth({kind,surface,width_m:7,width_source,trail});\n"
              "console.log(JSON.stringify({dirtService:w('service','dirt'),service:w('service','unknown'),"
              "street:w('residential','asphalt'),measured:w('service','dirt','mapped'),trail:w('footway','dirt','inferred',true),"
              "roads:NATURE_ROADS.has('service')&&!NATURE_ROADS.has('motorway')}));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got == {"dirtService": 3.5, "service": 4, "street": 7, "measured": 7, "trail": 7, "roads": True}
    runtime = (ROOT / "docs/nature-runtime.mjs").read_text()
    assert "if(!(w.trail||road)||w.grade_separated||w.area)continue;" in runtime
    assert "w.width_m=inferredWidth(w);" in runtime
