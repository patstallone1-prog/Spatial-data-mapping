"""A court is painted on the ground, so it cannot be larger than the ground.

The rule sounds too obvious to test. It was not being kept: layout_courts handed back the
regulation size of the sport whatever the polygon measured, and the only thing between a small
slab and a full-size court was MIN_FIT, which let anything down to 62% of regulation through.
Helen Wills Playground is 25.6 m of basketball court and was given the NBA's 28.65 -- three
metres of court, both keys and both baskets, hanging outside the polygon.

Nothing in the picture said "the court is too big". What it looked like was a fence running
across the court in front of each hoop, because the fence follows the pitch polygon and the
polygon was where the court should have stopped.
"""

from __future__ import annotations

import math
import random

import pytest

from smc.ground.courts import FALLBACK, MIN_FIT, SPORTS, Rect, layout_courts, oriented_rect


def _escape(rect: Rect, court: Rect) -> float:
    """How far a court sticks out past its pitch, in metres. Negative is comfortably inside."""
    du = (court.cx - rect.cx) * math.cos(rect.angle) + (court.cy - rect.cy) * math.sin(rect.angle)
    dv = -(court.cx - rect.cx) * math.sin(rect.angle) + (court.cy - rect.cy) * math.cos(rect.angle)
    turn = court.angle - rect.angle
    ex = court.length / 2 * abs(math.cos(turn)) + court.width / 2 * abs(math.sin(turn))
    ey = court.length / 2 * abs(math.sin(turn)) + court.width / 2 * abs(math.cos(turn))
    return max(abs(du) + ex - rect.length / 2, abs(dv) + ey - rect.width / 2)


@pytest.mark.parametrize("sport", sorted(SPORTS))
def test_no_court_is_ever_larger_than_the_pitch_it_is_painted_on(sport: str) -> None:
    """Every sport, over every shape of ground, including the ones nobody would map."""
    random.seed(20260909)
    checked = 0
    for _ in range(2000):
        length = random.uniform(3.0, 120.0)
        width = random.uniform(3.0, 90.0)
        if width > length:
            length, width = width, length
        rect = Rect(random.uniform(-400, 400), random.uniform(-400, 400),
                    random.uniform(-math.pi, math.pi), length, width)
        for _kind, court in layout_courts(sport, rect):
            checked += 1
            assert _escape(rect, court) <= 1e-6, (
                f"{sport} court {court.length:.1f}x{court.width:.1f} escapes a "
                f"{length:.1f}x{width:.1f} pitch by {_escape(rect, court):.2f} m")
    assert checked > 0, f"{sport} never laid a single court out"


def test_helen_wills_gets_a_court_that_fits_between_its_own_fences() -> None:
    """The pitch the report came from: 1404 Broadway, Helen Wills Playground.

    The polygon is 25.6 by 15.3 m. A full NBA court does not go in it, and the answer is not to
    refuse -- undersized outdoor courts are the ordinary case in this city -- but to paint one
    the size of the slab.
    """
    rect = Rect(0.0, 0.0, 0.14956, 25.6, 15.3)
    laid = layout_courts("basketball", rect)
    assert len(laid) == 1
    kind, court = laid[0]
    assert kind == "basketball"
    assert court.length < 25.6 and court.width < 15.3
    assert _escape(rect, court) <= 1e-6
    # Still a basketball court and not some other rectangle: the proportions are the game's.
    spec = SPORTS["basketball"]
    assert abs(court.length / court.width - spec.play_l / spec.play_w) < 1e-6


def test_ground_too_small_steps_down_a_sport_rather_than_shrinking_forever() -> None:
    """Scaling has a floor. Below it the claim about what is there gets smaller instead."""
    tiny = Rect(0.0, 0.0, 0.0, 14.0, 11.0)
    laid = layout_courts("basketball", tiny)
    assert [kind for kind, _ in laid] == [FALLBACK["basketball"]]
    for _kind, court in laid:
        assert _escape(tiny, court) <= 1e-6
    # And ground too small even for the step down gets nothing rather than a token.
    assert layout_courts("tennis", Rect(0.0, 0.0, 0.0, 6.0, 3.0)) == []


def test_a_pitch_with_room_still_gets_the_regulation_court() -> None:
    """The clamp may only ever take size away, never add it."""
    roomy = Rect(0.0, 0.0, 0.0, 40.0, 24.0)
    spec = SPORTS["basketball"]
    laid = layout_courts("basketball", roomy)
    assert laid, "a forty by twenty-four metre slab holds a basketball court"
    for _kind, court in laid:
        assert abs(court.length - spec.play_l) < 1e-6
        assert abs(court.width - spec.play_w) < 1e-6


def test_a_block_of_courts_still_tiles_and_still_fits() -> None:
    """Alice Marble is six tennis courts in one polygon; the count is the point of tiling."""
    block = Rect(0.0, 0.0, 0.0, 105.0, 36.0)
    laid = layout_courts("tennis", block)
    assert len(laid) >= 4
    for _kind, court in laid:
        assert _escape(block, court) <= 1e-6
    # Two courts never overlap each other either.
    for i, (_a, one) in enumerate(laid):
        for _b, other in laid[i + 1:]:
            gap = max(abs(one.cx - other.cx) - (one.length + other.length) / 2,
                      abs(one.cy - other.cy) - (one.width + other.width) / 2)
            assert gap > -1e-6, "two courts occupy the same ground"


def test_the_fit_floor_is_the_one_the_module_states() -> None:
    """MIN_FIT is a claim about when a slab stops being a court, and it is now enforced on the
    scale rather than only on the raw span -- which is what let a 62%-sized slab keep a 100%
    court."""
    spec = SPORTS["tennis"]
    # Just under the floor on the long axis, and narrow enough that turning it does not help
    # either -- Rect's length is its long axis, so both spans have to be short of the floor.
    short = Rect(0.0, 0.0, 0.0, spec.play_l * MIN_FIT - 1.0, spec.play_w * MIN_FIT - 1.0)
    assert layout_courts("tennis", short) == []


def test_the_oriented_rectangle_is_the_pitch_not_its_bounding_box() -> None:
    """Everything above rests on the rectangle being the pitch's own, at the pitch's bearing.

    San Francisco's blocks are rotated about nine degrees off north, so an axis-aligned box round
    a court is meaningfully larger than the court.
    """
    turn = math.radians(-9.0)
    length, width = 28.0, 15.0
    corners = []
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = dx * length / 2, dy * width / 2
        corners.append((x * math.cos(turn) - y * math.sin(turn),
                        x * math.sin(turn) + y * math.cos(turn)))
    rect = oriented_rect(corners)
    assert rect is not None
    assert abs(rect.length - length) < 1e-6
    assert abs(rect.width - width) < 1e-6
    assert abs(((rect.angle - turn + math.pi) % math.pi) - 0.0) < 1e-6 or \
           abs(((rect.angle - turn) % math.pi) - 0.0) < 1e-6
