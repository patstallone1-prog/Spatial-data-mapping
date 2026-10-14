"""A window the photograph did not show, where the front's own column grid puts one."""

from __future__ import annotations

from smc.facades.coarse_openings import complete_columns


def _w(i: str, u: float, v: float, w: float = 1.0, h: float = 1.6, **extra) -> dict:
    return {"id": i, "kind": "window", "role": "window", "u": u, "v": v, "w": w, "h": h,
            "confidence": 0.7, "design": {"vertical_bars": [0.5]}, **extra}


def _second_floor_of_three() -> list[dict]:
    # The second floor: left, middle, right. The first floor: middle and right only.
    return [_w("s2-left", 0.8, 4.0), _w("s2-mid", 3.5, 4.0), _w("s2-right", 6.2, 4.0),
            _w("s1-mid", 3.55, 1.0, w=0.9, h=1.4), _w("s1-right", 6.25, 1.0, w=0.9, h=1.4)]


def test_three_over_two_puts_the_missing_one_under_the_left() -> None:
    added = complete_columns(_second_floor_of_three(), width=8.0, height=7.5)
    assert len(added) == 1
    window = added[0]
    assert abs(window["u"] + window["w"] / 2 - 1.3) < 1e-6, "under the second floor's left window"
    assert (window["v"], window["w"], window["h"]) == (1.0, 0.9, 1.4), "at its own floor's size"
    assert window["grade"] == "inferred_from_column_symmetry_not_seen"
    assert window["size_inferred"] and window["role_certainty"] == "low"
    assert "column_of:s2-left" in window["role_basis"]


def test_a_wall_plainly_seen_bare_is_left_blank() -> None:
    assert complete_columns(_second_floor_of_three(), 8.0, 7.5, blank_wall=lambda box: 0.95) == []
    # A tree or a car in front of it is not bare wall: the window is inferred behind it.
    assert len(complete_columns(_second_floor_of_three(), 8.0, 7.5, blank_wall=lambda box: 0.3)) == 1


def test_no_window_over_a_door_or_garage_in_that_column() -> None:
    found = [*_second_floor_of_three(),
             {"id": "door", "kind": "door", "role": "entrance", "u": 0.7, "v": 0.0, "w": 1.1, "h": 2.2}]
    assert complete_columns(found, 8.0, 7.5) == []


def test_one_shared_column_is_not_a_grid() -> None:
    found = [_w("a", 0.8, 4.0), _w("b", 3.5, 4.0), _w("c", 6.2, 4.0), _w("d", 3.5, 1.0)]
    assert complete_columns(found, 8.0, 7.5) == []


def test_floors_out_of_line_infer_nothing() -> None:
    found = [_w("a", 0.8, 4.0), _w("b", 3.5, 4.0), _w("c", 6.2, 4.0),
             _w("d", 2.2, 1.0), _w("e", 5.0, 1.0)]
    assert complete_columns(found, 8.0, 7.5) == []
