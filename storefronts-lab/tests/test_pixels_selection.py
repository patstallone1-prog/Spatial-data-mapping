import math

import cv2
import numpy as np
import pytest

from conftest import frame
from kerbfront.photos import mvt
from kerbfront.photos.pixels import (assess_pixels, coverage, equirect_view, exposure,
                                     face_window, sharpness)
from kerbfront.photos.selection import select


def test_mvt_round_trip():
    ring = [(0, 0), (2048, 0), (2048, 2048), (0, 2048)]
    rings = mvt.rings(mvt.encode_polygon_tile(ring))
    assert rings[0][:4] == [(0, 0), (0.5, 0), (0.5, 0.5), (0, 0.5)]


def test_sharpness_separates_sharp_from_blurred():
    board = (np.indices((600, 800)).sum(axis=0) // 20 % 2 * 255).astype(np.uint8)
    blurred = cv2.GaussianBlur(board, (0, 0), 6)
    assert sharpness(board) > 20 * sharpness(blurred)


def test_exposure_penalizes_blown_and_dark_frames():
    mid = np.full((100, 100), 128, np.uint8)
    mid[::2] = 90
    assert exposure(mid)["score"] > 0.9
    assert exposure(np.full((100, 100), 255, np.uint8))["score"] < 0.2
    assert exposure(np.full((100, 100), 3, np.uint8))["score"] < 0.2


def test_equirect_view_aims_at_the_requested_yaw():
    pano = np.zeros((500, 1000, 3), np.uint8)
    # a red column at yaw +90 (three-quarters across: centre column is the heading)
    pano[:, 745:755] = (0, 0, 255)
    view = equirect_view(pano, 90.0, 0.0, 60.0, out_w=200, out_h=100)
    assert view[50, 100, 2] == 255 and view[50, 20, 2] == 0


def _det(value, x0, y0, x1, y1, n=24):
    """A rectangle traced densely, as Mapillary's segmentation rings are."""
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    ring = []
    for (ax, ay), (bx, by) in zip(corners, corners[1:] + corners[:1]):
        ring += [(ax + (bx - ax) * k / n, ay + (by - ay) * k / n) for k in range(n)]
    return {"value": value, "rings": [ring]}


def test_detections_measure_occlusion_and_consistency(block, a_front):
    f = frame(heading=180, camera_type="spherical", hfov=360, width=5760, height=2880)
    cam = (5, 28)
    win = face_window(f, a_front, cam, 9.0)
    assert win["yaw"][0] < 0 < win["yaw"][1]      # face straddles the heading
    building = _det("construction--structure--building", 0.3, 0.2, 0.7, 0.62)
    car = _det("object--vehicle--car", 0.3, 0.5, 0.7, 0.62)
    cov = coverage([building, car], f, win["yaw"], win["store"])
    assert cov["occluder"] > 0.2 and cov["building"] > 0.9
    sky = _det("nature--sky", 0.2, 0.0, 0.8, 0.65)
    res = assess_pixels(f, a_front, cam, 9.0, None, [sky])
    assert "misaligned" in res["rejects"]


def test_regions_across_the_panorama_seam_are_unwrapped():
    f = frame(heading=0, camera_type="spherical", hfov=360, width=5760, height=2880)
    # a car straddling the seam (directly behind the camera): x from 0.95 round to 0.05
    xs = [0.95, 0.97, 0.99, 0.01, 0.03, 0.05]
    car = {"value": "object--vehicle--car",
           "rings": [[(x, 0.5) for x in xs] + [(x, 0.6) for x in reversed(xs)]]}
    behind = coverage([car], f, (170.0, 190.0), (-15.0, -3.0))
    ahead = coverage([car], f, (-10.0, 10.0), (-15.0, -3.0))
    assert behind["occluder"] > 0.9 and ahead["occluder"] == 0.0


def test_selection_fills_slots_and_spreads_sequences():
    def a(fid, view, arch, sign, inc=10.0):
        return {"frame_id": fid, "face_id": "F", "ok": True, "view": view,
                "metrics": {"incidence_deg": inc}, "scores": {"architecture": arch, "signage": sign}}
    rows = [a("f1", "frontal", 0.9, 0.9), a("f2", "frontal", 0.89, 0.88),
            a("f3", "oblique-left", 0.6, 0.2, 40), a("f4", "oblique-right", 0.5, 0.1, 45),
            a("f5", "frontal", 0.7, 0.6)]
    frames = {"f1": {"sequence": "s1"}, "f2": {"sequence": "s1"}, "f3": {"sequence": "s2"},
              "f4": {"sequence": "s3"}, "f5": {"sequence": "s4"}}
    picks = select(rows, frames, k=5)
    slots = {p["slot"]: p["frame_id"] for p in picks}
    assert slots["sign"] == "f1"
    assert slots["elevation"] == "f5"          # f2 is the same drive-by as f1, penalized
    assert slots["oblique-left"] == "f3" and slots["oblique-right"] == "f4"
    assert [p["frame_id"] for p in picks][-1] == "f2"
