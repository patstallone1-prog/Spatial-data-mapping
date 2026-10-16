import json

import numpy as np

from scripts.curbmeasure import photo_kerbs


def test_failed_height_metadata_request_remains_retryable(tmp_path, monkeypatch):
    class Ground:
        def at(self, lon, lat):
            return 10.0

    def fail(*args, **kwargs):
        raise RuntimeError("temporary source failure")

    monkeypatch.setattr(photo_kerbs, "_get", fail)
    first = photo_kerbs.sequence_heights({"seq"}, Ground(), tmp_path)
    assert np.isnan(first["seq"])
    assert not (tmp_path / "seq-seq.json").exists()
    rows = [{"computed_altitude": 12.0, "computed_geometry": {"coordinates": [0, 0]}}] * 6
    monkeypatch.setattr(photo_kerbs, "_get", lambda *a, **k: {"data": rows})
    assert photo_kerbs.sequence_heights({"seq"}, Ground(), tmp_path) == {"seq": 2.0}
    assert json.loads((tmp_path / "seq-seq.json").read_text())["status"] == "complete"
