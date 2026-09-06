"""Rectification, checked by painting a wall into a synthetic photograph and taking it back out.

The failure that matters here is orientation. A texture that comes out mirrored, or upside
down, is still a photograph of a building and still looks broadly plausible on the mesh -- so
the tests put a mark in one known corner of the wall and insist on finding it in that corner.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from smc.facades.geometry import Camera, Wall, project
from smc.facades.rectify import View, align, compose, fill_gaps, rectify_wall


def _wall(height=12.0):
    # Runs west to east along y = 0, facing south.
    return Wall(0, 0, a=(-10.0, 0.0), b=(10.0, 0.0), normal=(0.0, -1.0), height_m=height)


def _paint(camera: Camera, wall: Wall, marks: dict[tuple[float, float], tuple[int, int, int]]):
    """A synthetic photograph: the wall in mid grey, with coloured patches at given (s, t)."""
    image = np.zeros((camera.height, camera.width, 3), dtype=np.uint8)
    ss, tt = np.meshgrid(np.linspace(0, 1, 400), np.linspace(0, 1, 400))
    ax, ay = wall.a
    bx, by = wall.b
    pts = np.stack([
        (ax + (bx - ax) * ss).ravel(),
        (ay + (by - ay) * ss).ravel(),
        (tt * wall.height_m).ravel(),
    ], axis=1)
    u, v, valid = project(camera, pts)
    su, sv = ss.ravel(), tt.ravel()
    for i in np.nonzero(valid)[0]:
        colour = (90, 90, 90)
        for (ms, mt), c in marks.items():
            if abs(su[i] - ms) < 0.12 and abs(sv[i] - mt) < 0.12:
                colour = c
        # A patch, not a pixel: the forward grid is coarser than the image.
        y0, x0 = int(v[i]), int(u[i])
        image[max(0, y0 - 3): y0 + 4, max(0, x0 - 3): x0 + 4] = colour
    return image


RED = (0, 0, 255)      # BGR


class TestRectify:
    def _camera(self, spherical=False):
        return Camera(x=0.0, y=-22.0, z=2.4, yaw_rad=0.0,
                      width=2400, height=1200 if spherical else 1600,
                      spherical=spherical,
                      hfov_rad=None if spherical else math.radians(90.0))

    @pytest.mark.parametrize("spherical", [False, True])
    def test_the_top_left_of_the_wall_lands_top_left_of_the_texture(self, spherical):
        camera = self._camera(spherical)
        wall = _wall()
        # s = 0 is the a end, which is to the west; a southward-facing camera sees west on its
        # left. t = 1 is the top of the wall.
        image = _paint(camera, wall, {(0.0, 1.0): RED})
        out = rectify_wall(image, camera, wall)
        assert out is not None and out.coverage > 0.9
        h, w = out.image.shape[:2]
        found = np.argwhere((out.image[:, :, 2] > 150) & (out.image[:, :, 0] < 80))
        assert found.size, "the mark was lost"
        row, col = found.mean(axis=0)
        assert row < h * 0.4, "the top of the wall came out low"
        assert col < w * 0.4, "the west end of the wall came out right"

    def test_the_bottom_right_of_the_wall_lands_bottom_right(self):
        camera = self._camera()
        wall = _wall()
        image = _paint(camera, wall, {(1.0, 0.0): RED})
        out = rectify_wall(image, camera, wall)
        assert out is not None
        h, w = out.image.shape[:2]
        found = np.argwhere((out.image[:, :, 2] > 150) & (out.image[:, :, 0] < 80))
        row, col = found.mean(axis=0)
        assert row > h * 0.6 and col > w * 0.6

    def test_a_wall_taller_than_the_frame_reports_what_it_saw(self):
        camera = self._camera()
        wall = _wall(height=60.0)          # far above a 90 degree lens at 22 m
        image = _paint(camera, wall, {})
        view = rectify_wall(image, camera, wall)
        assert view is not None
        out = compose([view], wall)
        assert out is not None
        assert 5.0 < out.visible_height_m < 40.0
        assert out.coverage < 0.95

    def test_a_wall_the_camera_cannot_see_yields_nothing(self):
        camera = Camera(x=0.0, y=-22.0, z=2.4, yaw_rad=math.pi,   # facing away
                        width=800, height=600, spherical=False, hfov_rad=math.radians(60.0))
        image = np.zeros((600, 800, 3), dtype=np.uint8)
        assert rectify_wall(image, camera, _wall()) is None

    def test_a_wall_behind_a_panorama_is_not_smeared_across_the_seam(self):
        # Facing north, with the wall due south: every column of it sits on the seam.
        camera = Camera(x=0.0, y=-22.0, z=2.4, yaw_rad=math.pi,
                        width=2400, height=1200, spherical=True)
        wall = _wall()
        image = _paint(camera, wall, {(0.0, 1.0): RED})
        out = rectify_wall(image, camera, wall)
        assert out is not None and out.coverage > 0.9
        # Painted grey plus one mark; a seam smear pulls in the black rest of the panorama.
        assert (out.image.max(axis=2) > 20).mean() > 0.9


def _flat(colour, h=100, w=64, mask=None, weight=1.0, noise=0):
    image = np.full((h, w, 3), colour, dtype=np.uint8)
    if noise:
        rng = np.random.default_rng(0)
        image = np.clip(image.astype(int) + rng.integers(-noise, noise, image.shape), 0, 255)
        image = image.astype(np.uint8)
    return View(image=image, mask=np.ones((h, w), bool) if mask is None else mask, weight=weight)


class TestCompose:
    def test_a_transient_object_is_outvoted(self):
        wall = _wall(height=10.0)
        clean = [_flat((40, 90, 160)) for _ in range(3)]
        # One frame has a van parked across the bottom third of the wall.
        van = _flat((40, 90, 160))
        van.image[70:] = (10, 10, 10)
        out = compose(clean + [van], wall, reject=False)
        assert out is not None
        assert out.image[80, 32, 2] > 120, "the van survived the median"

    def test_a_view_that_disagrees_with_the_others_is_thrown_out(self):
        wall = _wall(height=10.0)
        agreeing = [_flat((40, 90, 160), noise=6) for _ in range(3)]
        roadway = _flat((200, 30, 20))
        out = compose(agreeing + [roadway], wall)
        assert out is not None
        assert out.rejected == 1
        assert out.views == 3

    def test_agreement_is_high_when_the_views_match(self):
        wall = _wall(height=10.0)
        out = compose([_flat((40, 90, 160), noise=4) for _ in range(4)], wall)
        assert out is not None and out.agreement > 0.9

    def test_agreement_is_low_when_they_do_not(self):
        wall = _wall(height=10.0)
        views = [_flat((v, v, v)) for v in (20, 120, 220)]
        out = compose(views, wall, reject=False)
        assert out is not None and out.agreement < 0.6

    def test_one_view_claims_no_agreement(self):
        # A single view agrees with itself perfectly and that means nothing at all.
        out = compose([_flat((40, 90, 160))], _wall(height=10.0))
        assert out is not None and out.agreement == 0.0

    def test_nothing_visible_composes_to_nothing(self):
        blank = View(image=np.zeros((10, 10, 3), np.uint8),
                     mask=np.zeros((10, 10), bool), weight=1.0)
        assert compose([blank], _wall()) is None


class TestAlign:
    def test_a_shifted_view_is_pulled_back_onto_the_reference(self):
        rng = np.random.default_rng(7)
        texture = rng.integers(0, 255, (128, 128, 3), dtype=np.uint8)
        reference = View(image=texture, mask=np.ones((128, 128), bool), weight=2.0)
        shifted = View(image=np.roll(texture, 9, axis=1),
                       mask=np.ones((128, 128), bool), weight=1.0)
        before = np.abs(shifted.image.astype(int) - texture.astype(int)).mean()
        after_view = align([reference, shifted])[1]
        middle = slice(20, 108)
        after = np.abs(after_view.image[middle, middle].astype(int)
                       - texture[middle, middle].astype(int)).mean()
        assert after < before / 2, f"alignment did not help: {before:.1f} -> {after:.1f}"

    def test_a_single_view_is_returned_untouched(self):
        one = _flat((40, 90, 160))
        assert align([one])[0] is one

    def test_an_absurd_shift_is_refused(self):
        rng = np.random.default_rng(3)
        texture = rng.integers(0, 255, (64, 200, 3), dtype=np.uint8)
        reference = View(image=texture, mask=np.ones((64, 200), bool), weight=2.0)
        # Ninety pixels on a 200-wide wall is far past the fifth we allow.
        far = View(image=np.roll(texture, 90, axis=1), mask=np.ones((64, 200), bool), weight=1.0)
        out = align([reference, far])[1]
        assert np.array_equal(out.image, far.image), "an implausible shift was applied"


class TestFillGaps:
    def _composite(self, image, mask, visible):
        return type("C", (), {"image": image, "mask": mask, "views": 3,
                              "coverage": float(mask.mean()), "agreement": 0.9,
                              "visible_height_m": visible, "rejected": 0})()

    def test_the_unseen_top_takes_the_colour_of_the_seen_wall(self):
        image = np.zeros((100, 40, 3), dtype=np.uint8)
        image[60:] = (30, 60, 200)
        mask = np.zeros((100, 40), bool)
        mask[60:] = True
        filled = fill_gaps(self._composite(image, mask, 4.0), _wall(height=10.0))
        assert filled[0].mean() > 50, "the unseen top was left black"
        assert abs(int(filled[0, 0, 2]) - 200) < 30

    def test_a_fully_seen_wall_is_left_alone(self):
        image = np.full((100, 40, 3), 77, dtype=np.uint8)
        mask = np.ones((100, 40), bool)
        filled = fill_gaps(self._composite(image, mask, 10.0), _wall(height=10.0))
        assert np.array_equal(filled, image)

    def test_a_hole_in_the_middle_is_closed_rather_than_washed(self):
        image = np.full((100, 60, 3), 90, dtype=np.uint8)
        mask = np.ones((100, 60), bool)
        mask[40:50, 20:30] = False
        image[40:50, 20:30] = 0
        filled = fill_gaps(self._composite(image, mask, 10.0), _wall(height=10.0))
        assert filled[45, 25].mean() > 60, "the hole was left black"
