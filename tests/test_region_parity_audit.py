import json

from scripts.audit_region_parity import audit_region


def test_audit_does_not_call_osm_heights_measured_or_modify_payload(tmp_path):
    site = tmp_path / "docs" / "regions" / "test"
    site.mkdir(parents=True)
    path = site / "sf-corridor-3d.json"
    data = {
        "ways": [
            {"kind": "building", "osm_id": 1, "height_source": "osm_height"},
            {"kind": "building", "osm_id": 2, "height_source": "lidar_region"},
            {"kind": "street", "xs": [[0, 4, -4, "M"], [4, 4, -4, "L"]]},
        ]
    }
    path.write_text(json.dumps(data))
    before = path.read_bytes()
    result = audit_region(tmp_path, tmp_path, "test")
    assert result["metrics"]["lidar_height"]["share"] == 0.5
    assert result["metrics"]["measured_kerb_stations"]["share"] == 0.5
    assert path.read_bytes() == before


def test_missing_served_colours_are_joined_by_id_not_raw_file_count(tmp_path):
    site = tmp_path / "docs" / "regions" / "test"
    site.mkdir(parents=True)
    (site / "sf-corridor-3d.json").write_text(
        json.dumps(
            {
                "ways": [
                    {"kind": "building", "osm_id": 1},
                    {"kind": "building", "osm_id": 2, "colour": "#cccccc"},
                ]
            }
        )
    )
    source = tmp_path / "data" / "regions" / "test" / "official"
    source.mkdir(parents=True)
    (source / "building_colours.json").write_text(json.dumps({"buildings": {"1": {}, "999": {}}}))
    result = audit_region(tmp_path, tmp_path, "test")
    assert result["source_colours_missing_ids"] == ["1"]
