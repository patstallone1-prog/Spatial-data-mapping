"""The automatic reader's geometry and its scoring (no models, no network)."""

from __future__ import annotations

import math

import numpy as np

from kerbfront.auto.camera import rodrigues
from kerbfront.auto.elevation import _compose
from kerbfront.auto.read import Wall, runs
from kerbfront.auto.score import de2000, f1, iou1, iou2, union_iou


def test_ciede2000_matches_the_published_pairs():
    # Sharma, Wu & Dalal (2005), pairs 1 and 17
    assert abs(de2000(np.array([50, 2.6772, -79.7751]), np.array([50, 0, -82.7485])) - 2.0425) < 1e-3
    assert abs(de2000(np.array([50, 2.5, 0]), np.array([73, 25, -18])) - 27.1492) < 1e-3


def test_greedy_matching_scores():
    s, m = f1([1.0, 2.0, 3.0], [1.1, 2.9], lambda r, g: 1 - abs(r - g) if abs(r - g) < 0.3 else 0)
    assert len(m) == 2 and abs(s - 0.8) < 1e-9
    assert f1([], [], lambda r, g: 1)[0] == 1.0
    assert iou1((0, 2), (1, 3)) == 1 / 3
    assert abs(iou2({"u": 0, "v": 0, "w": 1, "h": 1}, {"u": 0.5, "v": 0, "w": 1, "h": 1}) - 1 / 3) < 1e-9
    assert abs(union_iou([(0, 5)], [(0, 2.5)], 10) - 0.5) < 0.02


def test_rodrigues_is_a_rotation():
    R = rodrigues(np.array([0.1, -0.4, 0.25]))
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-9) and abs(np.linalg.det(R) - 1) < 1e-9
    Rz = rodrigues(np.array([0, 0, math.pi / 2]))
    assert np.allclose(Rz @ [1, 0, 0], [0, 1, 0], atol=1e-9)


def test_warps_compose_in_order():
    A = np.array([[1.0, 0, 5], [0, 1.0, 0]])
    B = np.array([[2.0, 0, 0], [0, 2.0, 0]])
    assert np.allclose(_compose(A, B) @ [1, 1, 1], [7, 2])


def test_runs_join_small_gaps():
    m = np.array([0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1], bool)
    assert runs(m) == [(1, 3), (4, 7), (10, 11)]
    assert runs(m, min_len=2, max_gap=1) == [(1, 7)]


def test_windows_in_a_row_share_sill_and_head():
    rows = Wall._regular([{"u": 0, "v": 3.0, "w": 1, "h": 1.5}, {"u": 2, "v": 3.1, "w": 1, "h": 1.5},
                          {"u": 0, "v": 6.0, "w": 1, "h": 1.4}])
    assert [o["v"] for o in rows] == [3.05, 3.05, 6.0]
    assert rows[0]["h"] == rows[1]["h"]


def test_a_sign_seen_before_the_tenant_moved_in_takes_the_tenant_name():
    from kerbfront.auto.flow import _same_name, to_model
    assert _same_name("SUPER DUPER", "Super Duper Burgers") and not _same_name("Squat & Gobble", "Bar Darling")
    base = {"storefronts": [{"edge": 1, "name": "Bar Darling"}]}
    import kerbfront.auto.flow as F
    obs = [{"path": "storefronts", "value": [{"edge": 1, "name": "Bar Darling",
            "extra_signs": [{"u": 1.0, "v": 3.0, "bg": "#ffffff"}]}]}]
    real = F.observations
    F.observations = lambda b, r: obs
    try:
        read = {"signs": [{"u": 1.0, "v": 3.0, "text": "Squat & Gobble"}], "awnings": [], "seating_q": [],
                "frames": [], "pre_tenancy": True}
        _, out = to_model(base, {1: read})
        sign = out[0]["value"][0]["extra_signs"][0]
        assert sign["layers"][0]["text"] == "Bar Darling" and "Squat & Gobble" in sign["text_source"]
        read["pre_tenancy"] = False
        _, out = to_model(base, {1: read})
        assert out[0]["value"][0]["extra_signs"][0]["layers"][0]["text"] == "Squat & Gobble"
    finally:
        F.observations = real
