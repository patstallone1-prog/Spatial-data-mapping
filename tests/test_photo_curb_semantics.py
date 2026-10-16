import math

import numpy as np
import pytest

from smc.curbmeasure.semantic import View, kerb_columns, measure, metres_per_degree


def camera_doc():
    return {
        "id": "unit-test",
        "computed_geometry": {"coordinates": [-122.42, 37.76]},
        "computed_rotation": [math.pi / 2, 0, 0],
        "computed_altitude": 10.0,
        "width": 400,
        "height": 200,
        "camera_type": "perspective",
        "camera_parameters": [0.5, 0, 0],
    }


def test_no_invented_focal_length_or_orientation_for_bad_cameras():
    doc = camera_doc()
    assert View.from_doc(doc) is not None
    for focal in (0, -1, np.nan):
        doc["camera_parameters"] = [focal]
        assert View.from_doc(doc) is None
    doc["camera_parameters"] = [0.5]
    doc["computed_rotation"] = [0.0, 0.0]
    assert View.from_doc(doc) is None


def test_curbs_need_road_and_walk_support_not_a_coloured_band_alone():
    labels = np.zeros((30, 20), dtype=np.uint8)
    labels[15:18] = 2
    assert not kerb_columns(labels)
    labels[12:15] = 3
    labels[18:21] = 1
    assert kerb_columns(labels)


def test_metric_scale_is_ellipsoidal_not_inconsistent_latitude_constants():
    east, north = metres_per_degree(37.76)
    assert east == pytest.approx(88117, abs=50)
    assert north == pytest.approx(110992, abs=50)


def test_bad_height_or_wrong_raster_fails_instead_of_making_a_measurement():
    view = View.from_doc(camera_doc())
    with pytest.raises(ValueError, match="height"):
        measure(view, np.zeros((3, 3)), float("nan"))
    with pytest.raises(ValueError, match="raster"):
        measure(view, np.zeros((3, 3)), 2.0)


def test_known_road_grade_removes_flat_plane_height_bias():
    class Camera:
        id = "analytic-geometry-unit-test"
        sequence = "not-real-evidence"
        lon, lat = -122.42, 37.76
        raster = (20, 30)

        def rays(self, u, v):
            # True camera H=2m, foot at north=5m on a 10% grade,
            # top 0.15m above it. The label band's exact pixel boundaries.
            z = np.where(v > 16, -1.5, -1.35)
            return np.column_stack((u / 100, np.full_like(u, 5.0), z))

    labels = np.zeros((30, 20), dtype=np.uint8)
    labels[12:15] = 3
    labels[15:18] = 2
    labels[18:21] = 1
    flat = measure(Camera(), labels, 2.0)
    graded = measure(Camera(), labels, 2.0, grade_e_n=(0.0, 0.1))
    assert [r.height_m for r in flat] == pytest.approx([0.2] * len(flat))
    assert [r.height_m for r in graded] == pytest.approx([0.15] * len(graded))
