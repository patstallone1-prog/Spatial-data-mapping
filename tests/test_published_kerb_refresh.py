"""OSM map API may include out-of-box way nodes; keep only mapped local lips."""

import io
import json

from scripts import refresh_published_kerb_nodes as kerbs


def test_osm_xml_normalizes_explicit_tags_and_excludes_outside_nodes(monkeypatch) -> None:
    xml = b'''<osm>
      <node id="1" lon="0.5" lat="0.5"><tag k="kerb" v="lowered"/></node>
      <node id="2" lon="0.7" lat="0.5"><tag k="kerb" v="raised"/></node>
      <node id="3" lon="1.4" lat="0.5"><tag k="kerb" v="flush"/></node>
      <node id="4" lon="0.5" lat="0.6"><tag k="barrier" v="kerb"/></node>
    </osm>'''
    monkeypatch.setattr(kerbs.urllib.request, "urlopen", lambda *_args, **_kwargs: io.BytesIO(xml))
    rows = kerbs.fetch_kerb_nodes({"west": 0, "south": 0, "east": 1, "north": 1})
    assert [row["osm_id"] for row in rows] == [1, 2]
    assert [row["accessible_lip"] for row in rows] == [True, False]


def test_refresh_appends_nodes_without_moving_existing_feature_indices(tmp_path, monkeypatch) -> None:
    page = tmp_path / "sf-corridor-3d.json"
    original = [{"kind": "building", "osm_id": i} for i in range(100)]
    page.write_text(json.dumps({"bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
                                "ways": original}))
    monkeypatch.setattr(kerbs, "fetch_kerb_nodes", lambda _bbox: [
        {"kind": "curb_ramp", "point": [0.5, 0.5], "osm_id": 5, "accessible_lip": True},
        {"kind": "curb_ramp", "point": [1.5, 0.5], "osm_id": 6, "accessible_lip": True},
    ])
    summary = kerbs.refresh(page)
    updated = json.loads(page.read_text())
    assert updated["ways"][:100] == original
    assert len(updated["ways"]) == 101
    assert summary["mapped_kerb_nodes"] == 1
