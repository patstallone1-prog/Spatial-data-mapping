"""Waits on the network overlap; what is computed from the answers does not change."""

from __future__ import annotations

import io
import threading
import time

import laspy
import numpy as np

from smc.lidar import ept
from smc.net import ordered_prefetch


def test_ordered_prefetch_overlaps_the_waits_and_keeps_the_order():
    active, most = 0, 0
    lock = threading.Lock()

    def fetch(n):
        nonlocal active, most
        with lock:
            active += 1
            most = max(most, active)
        time.sleep(0.05 * (5 - n % 5))  # later items finish first
        with lock:
            active -= 1
        if n == 3:
            raise RuntimeError("tile 3 unavailable")
        return n * 10

    started = time.time()
    out = list(ordered_prefetch(fetch, range(10), 4))
    assert [item for item, _ in out] == list(range(10))
    assert [r for _, r in out if not isinstance(r, Exception)] == [n * 10 for n in range(10) if n != 3]
    assert str(dict(out)[3]) == "tile 3 unavailable"
    assert most == 4 and time.time() - started < 0.05 * 30 / 2


def _laz(xs):
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = np.array([0.01, 0.01, 0.01])
    las = laspy.LasData(header)
    las.x, las.y, las.z = np.array(xs, float), np.array(xs, float), np.array(xs, float)
    las.classification = np.full(len(xs), 2, np.uint8)
    buf = io.BytesIO()
    las.write(buf)
    return buf.getvalue()


def test_a_point_cloud_is_the_same_however_its_nodes_arrive(monkeypatch):
    """EptReader.around fetches a query's nodes at once and joins them in the tree's order."""
    nodes = {f"n{i}": _laz([i * 1.0, i + 0.5]) for i in range(12)}

    def run(threads):
        monkeypatch.setattr(ept, "FETCH_THREADS", threads)
        reader = ept.EptReader("x")
        reader._info = {"span": 128}
        monkeypatch.setattr(ept.EptReader, "cube", property(lambda self: (-1e6, -1e6, -1e6, 1e6, 1e6, 1e6)))
        monkeypatch.setattr(reader, "_nodes", lambda box, depth: list(nodes))

        def get(path, binary=True):
            time.sleep(0.01 * (len(nodes) - int(path.split("/n")[1].split(".")[0])))
            return nodes[path.split("/")[1][:-4]]

        monkeypatch.setattr(reader, "_get", get)
        monkeypatch.setattr(ept, "to_web_mercator", lambda lat, lon: (0.0, 0.0))
        monkeypatch.setattr(ept, "mercator_metres_per_true_metre", lambda lat: 1.0)
        return reader.around(0, 0, 100)

    one, many = run(1), run(8)
    assert len(one) == 24
    for field in ("east", "north", "up", "classification"):
        assert np.array_equal(getattr(one, field), getattr(many, field))
