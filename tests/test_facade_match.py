"""A facade read off a photograph is matched to the closest render the page has, and the
reading outlives the catalogue."""

from __future__ import annotations

import numpy as np

from smc.facades.fingerprint import combine, fingerprint_patch
from smc.facades.match import CATALOGUE, Fingerprint, closest_render, distance


def wall(colour_bgr, storey_px=24, bay_px=20, glazing=0.25, noise=0.0, size=(96, 160)):
    """A synthetic rectified wall: a render colour with a grid of dark windows."""
    h, w = size
    patch = np.zeros((h, w, 3), dtype=np.float64)
    patch[:] = colour_bgr
    for y in range(0, h, storey_px):
        for x in range(0, w, bay_px):
            wy = int(storey_px * (1 - glazing) * 0.5)
            wx = int(bay_px * (1 - glazing) * 0.5)
            patch[y + wy:y + storey_px - wy, x + wx:x + bay_px - wx] = (40, 36, 30)
    if noise:
        rng = np.random.default_rng(1)
        patch += rng.normal(0, noise, patch.shape)
    return np.clip(patch, 0, 255).astype(np.uint8), np.ones((h, w), dtype=bool)


def test_a_red_textured_wall_is_brick_and_a_pale_flat_one_is_stucco():
    brick, mask = wall((60, 85, 160), glazing=0.3, noise=18)
    fp = fingerprint_patch(brick, mask, pixels_per_m=8.0)
    assert fp is not None and 0 <= fp.hue <= 40 and fp.saturation > 0.2
    assert closest_render(fp).material == "brick"
    stucco, mask = wall((200, 210, 216), glazing=0.18, noise=2)
    fp = fingerprint_patch(stucco, mask, pixels_per_m=8.0)
    assert fp is not None and fp.texture < 0.15
    assert closest_render(fp).material == "stucco"


def test_a_wall_of_glass_matches_the_curtain_wall():
    glass, mask = wall((150, 130, 110), glazing=0.75, noise=4)
    fp = fingerprint_patch(glass, mask, pixels_per_m=8.0)
    assert fp is not None and fp.glazing > 0.45
    assert closest_render(fp).material == "glass"


def test_the_storey_rhythm_is_read_off_the_window_rows():
    patch, mask = wall((180, 180, 180), storey_px=24, bay_px=32, glazing=0.4)
    fp = fingerprint_patch(patch, mask, pixels_per_m=8.0)
    assert fp is not None and fp.storeys_per_m is not None
    # 24 px at 8 px/m is a 3 m storey: a third of a storey per metre.
    assert abs(fp.storeys_per_m - 1 / 3) < 0.05, fp.storeys_per_m
    match = closest_render(fp)
    assert match.storey_m is not None and abs(match.storey_m - 3.0) < 0.5


def test_too_little_wall_is_refused_and_views_combine_by_median():
    patch, mask = wall((180, 180, 180))
    assert fingerprint_patch(patch, np.zeros_like(mask), 8.0) is None
    a = Fingerprint(0.6, 0.2, 20, 0.2, 0.2, 0.1)
    b = Fingerprint(0.7, 0.3, 30, 0.3, 0.3, 0.2)
    c = Fingerprint(0.1, 0.9, 200, 0.9, 0.9, 0.9)     # a van in front of the wall
    combined = combine([a, b, c])
    assert combined is not None and combined.views == 3
    assert abs(combined.lightness - 0.6) < 1e-9 and abs(combined.glazing - 0.3) < 1e-9


def test_a_fingerprint_between_two_renders_is_matched_at_low_confidence_and_a_far_one_refused():
    between = Fingerprint(0.65, 0.105, 100, 0.19, 0.10, 0.125)   # halfway from stucco to concrete
    match = closest_render(between)
    assert match.material in ("stucco", "concrete") and match.confidence < 0.5
    far = Fingerprint(0.05, 0.95, 300, 0.95, 0.95, 0.9)
    assert closest_render(far).confidence == 0.0


def test_a_render_added_to_the_catalogue_is_matched_without_a_new_photograph():
    """The fingerprint is the record; the catalogue is a table. A siding render described in
    the same terms wins the buildings that were nearest to it all along."""
    siding = Fingerprint(0.62, 0.22, 40, 0.20, 0.30, 0.18)
    before = closest_render(siding).material
    richer = [*CATALOGUE, {"material": "siding", "proto": {"glazing": 0.20, "texture": 0.30,
                                                        "saturation": 0.22, "lightness": 0.62,
                                                        "sd": 0.18}, "hue": 40.0}]
    after = closest_render(siding, richer)
    assert before != "siding" and after.material == "siding" and after.confidence > 0.5
    assert distance(siding, richer[-1]) < 1e-9


def test_the_payload_form_round_trips():
    fp = Fingerprint(0.61, 0.2, 21.5, 0.3, 0.2, 0.1, 0.333, 0.25, 2)
    again = Fingerprint.from_json(fp.to_json())
    assert abs(again.lightness - 0.61) < 1e-9 and again.views == 2 and abs(again.storeys_per_m - 0.333) < 1e-9
