import json
import runpy
import subprocess
from pathlib import Path

import pytest

from tools.build_search_index import attach_tenant_names, rows_for
from tools.build_storefront_names import names_sidecar

ROOT = Path(__file__).resolve().parents[1]


def fixture():
    way = {"kind": "building", "osm_id": 1, "height_m": 9, "archetype": "retail",
           "points": [[0, 0], [0, 1], [1, 1], [0, 0]],
           "shops": [{"n": "Old", "t": "books"}]}
    payload = {"ways": [way], "bbox": {"west": 0, "east": 1, "south": 0, "north": 1}}
    audit = {"region": "fixture", "source_world_sha256": "sha",
             "canonical_geometry_unchanged": True,
             "buildings": {"1": {"shops": [*way["shops"], {"n": "New", "t": "cafe"}]}}}
    return payload, audit


def test_name_release_is_bound_to_snapshot_and_cannot_mutate_world():
    payload, audit = fixture()
    inventory = names_sidecar(payload, audit, "sha")
    assert inventory["buildings"]["1"]["points"] == payload["ways"][0]["points"]
    assert inventory["geometry_modified"] is False
    assert len(payload["ways"][0]["shops"]) == 1
    with pytest.raises(ValueError, match="stale"):
        names_sidecar(payload, audit, "new-snapshot")


def test_live_name_consumer_rejects_wrong_footprint_and_never_invents_a_shop_at_a_house():
    namespace = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    function = "function applyStorefrontNames" + namespace["HTML"].split(
        "function applyStorefrontNames", 1)[1].split("applyStorefrontNames(DATA, STORE_NAMES);", 1)[0]
    payload, audit = fixture()
    inventory = names_sidecar(payload, audit, "sha")
    body = function + "\n" + f"const original={json.dumps(payload)}; const names={json.dumps(inventory)};"
    body += """
      const data=structuredClone(original); if(applyStorefrontNames(data,names)!==1)throw Error('missing');
      if(data.ways[0].tenant_names.length!==2)throw Error('lost names');
      if(data.ways[0].shops.length!==1)throw Error('invented sign position');
      if(applyStorefrontNames(data,names)!==1||data.ways[0].tenant_names.length!==2)throw Error('duplicate');
      const changed=structuredClone(original); changed.ways[0].points[0][0]=5;
      if(applyStorefrontNames(changed,names)!==0)throw Error('stale geometry applied');
      const house=structuredClone(original); delete house.ways[0].shops;
      house.ways[0].archetype='residential';
      if(applyStorefrontNames(house,names)!==1||house.ways[0].shops)throw Error('invented storefront');
      if(house.ways[0].tenant_names.length!==2)throw Error('lost tenant metadata');
    """
    subprocess.run(["node", "--input-type=module", "-e", body], check=True)


def test_name_sidecars_live_beside_each_app_viewer_not_legacy_payload_assets():
    namespace = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    assert 'ATTACH.resolve("sf-corridor-storefront-names.json")' in namespace["HTML"]
    assert 'new URL("sf-corridor-storefront-names.json", location.href)' in namespace["HTML"]
    # A cloud-released cell has no audited names yet; its payload's own shop names stand.
    cloud = {r["name"] for r in json.loads((ROOT / "docs/app-regions.json").read_text())["regions"]
             if r.get("published_via") == "cloud release"}
    for viewer in [ROOT / "docs/app-model.html", *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]:
        if viewer.parent.name not in cloud:
            assert viewer.with_name("sf-corridor-storefront-names.json").is_file()


def test_shared_search_retains_names_outside_render_window_and_rejects_stale_world():
    payload, audit = fixture()
    payload["ways"][0]["centroid"] = [0.5, 0.5]
    inventory = names_sidecar(payload, audit, "sha")
    attach_tenant_names(payload, inventory, "sha")
    places = rows_for(payload, 0)[2]
    assert [p[0] for p in places] == ["Old", "New"]
    with pytest.raises(ValueError, match="stale"):
        attach_tenant_names(payload, inventory, "changed")


def test_published_shared_search_includes_new_names_across_regions():
    index = json.loads((ROOT / "docs/search-index.json").read_text())
    labels = {row[0] for row in index["places"]}
    assert any(label.startswith("Benchmark Climbing") for label in labels)
    assert any(label.startswith("Sky Bar") for label in labels)
