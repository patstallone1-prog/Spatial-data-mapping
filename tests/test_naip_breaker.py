"""A run stops asking the aerial service once it is plainly down, and still reads its cache."""
import urllib.error

from smc.imagery import naip


def test_two_failed_tiles_in_a_row_stop_further_requests(monkeypatch):
    asked = []

    def fetch(*args, offline=False, **kwargs):
        asked.append(offline)
        raise urllib.error.URLError("504")

    monkeypatch.setattr(naip, "fetch_tile", fetch)
    veg = naip.Vegetation()
    for ix in range(5):
        assert veg._tile(ix, 0) is None
    # Two real requests, then only cache reads (offline) for the rest of the run.
    assert asked == [False, False, True, True, True]
    assert veg.service_down and len(veg.unavailable) == 5


def test_offline_fetch_reads_a_cached_tile_and_refuses_an_uncached_one(tmp_path):
    import io
    import numpy as np
    from PIL import Image
    box = (-122.5, 37.75, -122.49, 37.76)
    path = tmp_path / f"{box[0]:.5f}_{box[1]:.5f}_{box[2]:.5f}_{box[3]:.5f}_0.5.png"
    buf = io.BytesIO()
    Image.fromarray(np.full((4, 4, 3), 120, np.uint8)).save(buf, format="PNG")
    path.write_bytes(buf.getvalue())
    assert naip.fetch_tile(*box, pixel_m=0.5, cache=tmp_path, offline=True) is not None
    try:
        naip.fetch_tile(-122.6, 37.7, -122.59, 37.71, pixel_m=0.5, cache=tmp_path, offline=True)
    except urllib.error.URLError:
        pass
    else:
        raise AssertionError("an uncached tile was fetched while offline")
