import numpy as np
import pytest

from smc.curbmeasure.sidewalk import plane_hits, widths


def test_plane_projection_uses_known_grade_not_flat_ground_on_a_hill():
    ray = np.array([[1.0, 0.0, -0.5]])
    assert plane_hits(ray, 2.0)[0] == pytest.approx([4.0, 0.0])
    assert plane_hits(ray, 2.0, (0.1, 0.0))[0] == pytest.approx([2 / 0.6, 0.0])
    assert np.isnan(plane_hits(np.array([[1.0, 0.0, 0.0]]), 2.0)).all()


def test_no_sidewalk_width_is_invented_without_known_curb_height():
    assert widths(None, np.zeros((10, 10)), 2.0) == []


@pytest.mark.parametrize("height", [0, -1, np.nan, np.inf])
def test_bad_camera_height_fails_closed(height):
    with pytest.raises(ValueError, match="height"):
        plane_hits(np.array([[0.0, 0.0, -1.0]]), height)


def test_width_needs_continuous_walk_and_visible_back_wall():
    class Camera:
        id = "synthetic-projection-unit-test"
        sequence = "not-real-evidence"
        raster = (100, 100)

        def rays(self, u, v):
            return np.column_stack(((u + 0.5 - 50) / 50, np.ones_like(u), -(v + 0.5 - 50) / 20))

    labels = np.full((100, 100), 1, dtype=np.uint8)
    labels[:60] = 5
    labels[60:70] = 3
    labels[70:73] = 2
    rows = widths(Camera(), labels, 2.0, curb_height_m=0.15)
    assert rows
    assert [r["width_m"] for r in rows] == pytest.approx([1.85] * len(rows))
    assert all(not r["publishable"] for r in rows)
    labels[57:60] = 0  # Parked object/unknown pixels at the hidden back edge.
    assert widths(Camera(), labels, 2.0, curb_height_m=0.15) == []
