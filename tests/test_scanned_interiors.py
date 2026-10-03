"""Actual scan bytes, safe surrogate placements and an enforced global reuse cap."""

import copy
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest

from scripts.build_scanned_interiors import choose_scan_yaw, contains, validate_manifest
from smc.scans.readers import read_glb
from tests.test_home_shell import run_js

ROOT = Path(__file__).resolve().parents[1]


def test_borrowed_scan_entry_opens_only_the_attached_door_sized_front_wall():
    out = run_js(["scanEntrancePlan", "scanEntranceContains", "clipOutsideZones"], """
      const DOOR_HEIGHT_M=2.1;
      function insideFootprint(e,x,z){return x>=-4&&x<=4&&z>=0&&z<=8;}
      function pointInRing(x,z,r){return x>r[0][0]&&x<r[2][0]&&z>r[0][1]&&z<r[2][1];}
      const d={cx:0,cz:0,ux:1,uz:0,nx:0,nz:1,width:1};
      const walls=[[-3,.7,3,.7],[-3,4,3,4]];
      const p=scanEntrancePlan({},d,walls);
      console.log(JSON.stringify({p,cut:scanEntranceContains(p,0,1,.7,0),
        above:scanEntranceContains(p,0,2.5,.7,0),side:scanEntranceContains(p,2,1,.7,0),
        interior:scanEntranceContains(p,0,1,4,0),
        walls:walls.flatMap(s=>clipOutsideZones(s,[p.ring])),
        absent:scanEntrancePlan({},null,walls),far:scanEntrancePlan({},d,[walls[1]])}));
    """)
    assert out["cut"] and not out["above"] and not out["side"] and not out["interior"]
    assert out["absent"] is None and out["far"] is None
    assert out["p"]["grade"] == "inferred_entry_adapter"
    assert len(out["walls"]) == 3
    assert out["walls"][-1] == [-3, 4, 3, 4]


def test_layout_matching_prefers_observed_floor_behind_the_host_door():
    source = np.array([[-2, -3], [2, -3], [2, 3], [-2, 3]])
    ring = np.array([[-2.3, -3.3], [2.3, -3.3], [2.3, 3.3], [-2.3, 3.3]])
    fit = [0] * 14
    fit[13] = [[0, .5, 1, 2]]
    rooms = [{"pts": [[-1, .2], [1, .2], [1, 1.5], [-1, 1.5]]}]
    assert choose_scan_yaw(source, ring, fit, 1, rooms) == pytest.approx(math.pi)
    assert choose_scan_yaw(source, ring, fit, 1, [{"pts": [[4, 4], [5, 4], [5, 5], [4, 5]]}]) is None


def manifest():
    return json.loads((ROOT / "docs/interior-scans/manifest.json").read_text())


def test_published_scan_is_real_mesh_with_matching_checksum_and_provenance():
    data = manifest()
    validate_manifest(data)
    for scan in data["scans"].values():
        asset = ROOT / "docs" / scan["asset"]
        assert hashlib.sha256(asset.read_bytes()).hexdigest() == scan["sha256"]
        assert asset.stat().st_size == scan["bytes"]
        mesh = read_glb(asset)
        assert mesh.triangle_count == scan["display_triangles"] > 100_000
        assert scan["source_triangles"] > 10_000_000
        assert scan["license_url"] and scan["attribution"] and scan["source_sha256"]
        assert scan["gps_known"] is False
        assert len(scan["layout"]["rooms"]) >= 3


def test_every_scan_vertex_is_contained_at_all_three_addressed_homes():
    data = manifest()
    assert len(data["placements"]) == 3
    for placement in data["placements"]:
        payload = data["canonical_payloads"][placement["region"]]
        payload_path = ROOT / "docs" / payload["path"]
        assert hashlib.sha256(payload_path.read_bytes()).hexdigest() == payload["sha256"]
        ways = {str(w.get("osm_id")): w for w in json.loads(payload_path.read_text())["ways"]}
        scan = data["scans"][placement["scan"]]
        points = read_glb(ROOT / "docs" / scan["asset"]).vertices[:, [0, 2]]
        lon, lat = placement["lonlat"]
        px = 111412.84 * math.cos(math.radians(lat)) - 93.5 * math.cos(3 * math.radians(lat))
        py = (
            111132.92
            - 559.82 * math.cos(2 * math.radians(lat))
            + 1.175 * math.cos(4 * math.radians(lat))
        )
        ring = (np.asarray(ways[placement["building"]]["points"]) - [lon, lat]) * [px, -py]
        c, s = math.cos(placement["yaw"]), math.sin(placement["yaw"])
        placed = points * placement["scale"] @ np.array([[c, -s], [s, c]])
        assert contains(placed, ring).all(), placement["address"]
        assert placement["contained_vertices"] == len(points)
        assert placement["address"] == ways[placement["building"]]["address"]["formatted"]
        assert (
            placement["entrance_preflight"]["rise_m"] < 0.55
            or placement["entrance_preflight"]["source"] != 2
        )


def test_ninth_reuse_and_false_address_truth_are_refused():
    data = manifest()
    data["placements"] = [copy.deepcopy(data["placements"][0]) for _ in range(9)]
    with pytest.raises(ValueError, match="reuse limit"):
        validate_manifest(data)
    data = manifest()
    data["placements"][0]["grade"] = "measured"
    with pytest.raises(ValueError, match="address truth"):
        validate_manifest(data)


def test_bad_scale_and_catalogue_only_model_are_refused():
    data = manifest()
    data["placements"][0]["scale"] = 1.3
    with pytest.raises(ValueError, match="stretch"):
        validate_manifest(data)
    data = manifest()
    next(iter(data["scans"].values()))["kind"] = "catalogue"
    with pytest.raises(ValueError, match="not a real scan"):
        validate_manifest(data)


def test_missing_redistribution_rights_are_refused():
    data = manifest()
    next(iter(data["scans"].values()))["rights"]["allowed_uses"].remove("redistribution")
    with pytest.raises(ValueError, match="rights"):
        validate_manifest(data)
