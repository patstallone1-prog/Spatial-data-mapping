"""What the aerial photograph says about what the page inferred (smc.truth.imagery_truth)."""

from pathlib import Path

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")   # the judging reads pictures; a machine without OpenCV runs the wiring tests only

from smc.truth import imagery_truth as it  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


class FlatFrame:
    """The page's metres as the photograph's, one to one (north is -z)."""

    def utm(self, x, z):
        return np.asarray(x, float), -np.asarray(z, float)


def photo(rgb: np.ndarray, nir: np.ndarray | None = None) -> it.Photo:
    """A photograph of a square of ground from (0, 0), a quarter of a metre a pixel."""
    p = it.Photo.__new__(it.Photo)
    h, w = rgb.shape[:2]
    p.frame, p.ok = FlatFrame(), True
    p.bounds = (0.0, -h * it.PIXEL_M, w * it.PIXEL_M, 0.0)
    p.rgb = np.ascontiguousarray(np.transpose(rgb, (2, 0, 1)))
    p.nir = nir if nir is not None else np.full((h, w), 30, np.uint8)
    p.shape = (h, w)
    p.cls = it.classes(p.rgb, p.nir)
    return p


def road(h=240, w=240, value=110) -> np.ndarray:
    rng = np.random.default_rng(7)
    return np.clip(np.full((h, w, 3), value, np.int16) + rng.integers(-6, 7, (h, w, 1)), 0, 255).astype(np.uint8)


def zone(x=20.0, z=30.0, along=10.0, across=1.5) -> dict:
    return it.rectangle(np.array([[x - along, z - across], [x + along, z - across], [x + along, z + across], [x - along, z + across]]))


def paint(img, rect, colour) -> None:
    cv2.fillPoly(img, [np.round(np.array(rect["corners"]) / it.PIXEL_M).astype(np.int32)], colour)


def test_a_bus_zone_is_red_only_where_the_photograph_is_red():
    bare, red, pad, hidden = road(), road(), road(), road()
    z = zone()
    paint(red, z, (150, 62, 55))
    paint(pad, z, (168, 168, 164))
    assert it.judge_bus_zone(photo(bare), z)["verdict"] == it.ABSENT
    assert it.judge_bus_zone(photo(red), z)["verdict"] == "red"
    assert it.judge_bus_zone(photo(pad), z)["verdict"] == "pad"
    # Under a tree nothing is said, and what the page has is kept.
    nir = np.full(hidden.shape[:2], 30, np.uint8)
    cv2.fillPoly(nir, [np.round(np.array(z["corners"]) / it.PIXEL_M).astype(np.int32)], 210)
    hidden[..., 1] = np.where(nir > 100, 120, hidden[..., 1])
    assert it.judge_bus_zone(photo(hidden, nir), z)["verdict"] == it.UNSEEN
    # One red car in the zone is not red paint.
    car = road()
    cv2.rectangle(car, (60, 115), (78, 125), (170, 40, 40), -1)
    assert it.judge_bus_zone(photo(car), z)["verdict"] == it.ABSENT


def test_a_word_on_the_road_is_there_if_its_strokes_are():
    blank, word, van = road(), road(), road()
    box = zone(along=3.0, across=1.2)
    for k in range(4):   # four strokes, a pixel wide: a letter's stroke is a foot
        x = int((box["x"] - 2.25 + k * 1.5) / it.PIXEL_M)
        cv2.line(word, (x, int((box["z"] - 1.0) / it.PIXEL_M)), (x, int((box["z"] + 1.0) / it.PIXEL_M)), (235, 235, 230), 1)
    paint(van, box, (240, 240, 240))
    assert it.judge_legend(photo(blank), box)["verdict"] == it.ABSENT
    assert it.judge_legend(photo(word), box)["verdict"] == it.PRESENT
    assert it.judge_legend(photo(van), box)["verdict"] == it.UNSEEN, "one solid pale thing over it is a vehicle"


def test_a_painted_court_is_found_and_a_roof_edge_or_a_parking_bay_is_not():
    yard = road(400, 400, 105)
    x0, y0, x1, y1 = 100, 120, 160, 232          # 15 m by 28 m
    cv2.rectangle(yard, (x0, y0), (x1, y1), (225, 225, 220), 1)
    cv2.line(yard, (x0, (y0 + y1) // 2), (x1, (y0 + y1) // 2), (225, 225, 220), 1)
    cv2.circle(yard, ((x0 + x1) // 2, (y0 + y1) // 2), 7, (225, 225, 220), 1)
    cv2.rectangle(yard, (x0 + 25, y0), (x0 + 55, y0 + 22), (225, 225, 220), 1)
    # A bare rectangle with nothing in it (a roof's parapet), and a small one (a parking bay).
    cv2.rectangle(yard, (250, 60), (330, 140), (225, 225, 220), 1)
    cv2.rectangle(yard, (260, 260), (270, 280), (225, 225, 220), 1)
    found = it.find_courts(photo(yard), np.ones(yard.shape[:2], bool))
    assert len(found) == 1
    court = found[0]
    assert court["long_m"] == pytest.approx(28, abs=1.5) and court["short_m"] == pytest.approx(15, abs=1.5)
    assert abs(court["box"][:, 0].mean() - 130) < 3 and abs(court["box"][:, 1].mean() - 176) < 3


def test_a_court_is_named_by_its_size_and_its_circles():
    assert it.court_kind(23.8, 11.0, 0, 2) == "tennis"
    assert it.court_kind(26.8, 14.5, 2, 2) == "basketball"
    assert it.court_kind(19.2, 12.7, 0, 1) == "basketball", "a school's short court, its circles not seen"
    assert it.court_kind(18.0, 9.0, 0, 1) == "volleyball"
    assert it.court_kind(30.0, 9.0, 0, 1) == "court"


def test_inferred_ground_is_called_by_what_most_of_it_is_and_small_patches_by_their_shape():
    img = road(200, 200, 100)
    nir = np.full((200, 200), 30, np.uint8)
    grass = np.zeros((200, 200), bool)
    grass[20:120, 20:120] = True
    img[grass] = (70, 120, 60)
    nir[grass] = 200
    paved = np.zeros((200, 200), bool)
    paved[130:190, 20:190] = True
    img[paved] = (176, 176, 172)
    p = photo(img, nir)
    assert it.judge_ground(p, grass, 625.0, 12.0)["verdict"] == "grass"
    assert it.judge_ground(p, paved, 640.0, 9.0)["verdict"] == "concrete"
    assert it.judge_ground(p, ~grass & ~paved, 900.0, 8.0)["verdict"] == "asphalt"
    assert it.judge_ground(p, grass, 40.0, 12.0)["verdict"] == "by_shape"
    assert it.judge_ground(p, grass, 625.0, 1.8)["verdict"] == "by_shape", "a narrow strip is what its shape says"


def test_gutter_pieces_on_one_kerb_become_one_straight_strip_of_their_middle_width():
    strips = []
    for k, (off, width) in enumerate([(0.0, 0.6), (0.25, 0.9), (-0.2, 0.5), (0.1, 0.6), (0.0, 0.7)]):
        x0 = k * 9.0
        strips.append(np.array([[x0, off], [x0 + 7.0, off], [x0 + 7.0, off + width], [x0, off + width]]))
    strips.append(np.array([[10.0, 30.0], [18.0, 30.0], [18.0, 30.6], [10.0, 30.6]]))   # another kerb
    lines = sorted(it.straighten_gutters(strips), key=lambda row: -row["length"])
    assert len(lines) == 2
    one = lines[0]
    assert one["pieces"] == 5 and one["length"] == pytest.approx(43.0, abs=0.5)
    assert one["width"] == pytest.approx(0.6, abs=0.01)
    assert abs(one["z0"] - one["z1"]) < 0.02, "straight"
    assert one["wobble"] > 0.2, "and it says how far the pieces were off it"
