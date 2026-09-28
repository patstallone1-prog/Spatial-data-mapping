"""A published lawn can be reclassified without replacing surveyed parcel data."""

from scripts.reclip_published_lawns import reclip


def test_front_strip_ends_at_house_and_preserves_backyard() -> None:
    payload = {
        "bbox": {"south": 0.0, "west": 0.0, "north": 0.001, "east": 0.001},
        "ways": [
            {"kind": "street", "road_m": 8.0, "walk_m": 3.0,
             "points": [[0.0001, 0.00023], [0.0005, 0.00023]]},
            {"kind": "building", "points": [[0.00021, 0.00037],
                                               [0.00034, 0.00037],
                                               [0.00034, 0.00056],
                                               [0.00021, 0.00056],
                                               [0.00021, 0.00037]]},
        ],
    }
    ring = [[0.0002, 0.0003], [0.00035, 0.0003],
            [0.00035, 0.0007], [0.0002, 0.0007], [0.0002, 0.0003]]
    cover = {"lawns": [{"id": "lot-1", "p": ring}], "backyards": [], "yards": []}
    updated, summary = reclip(payload, cover)
    assert summary["front_lawns_clipped"] == 1
    assert len(updated["backyards"]) == 1
    assert max(p[1] for p in updated["lawns"][0]["p"]) < 0.0004
    assert min(p[1] for p in updated["backyards"][0]["p"]) < 0.0004
    again, repeat = reclip(payload, updated)
    assert repeat["front_lawns_clipped"] == 0
    assert again == updated
