import numpy as np
import pytest

from smc.facades.registration import register_front


def test_rectification_requires_current_evidence_and_does_not_upsample():
    image = np.full((240, 200, 3), 100, np.uint8)
    control = {
        "image_sha256": "abc",
        "reviewer": "fixture",
        "full_front_visible": True,
        "quad_normalized": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    }
    result, evidence = register_front(image, 8, 6, control, "abc")
    assert result.shape[1] <= 160 and result.shape[0] <= 192
    assert not evidence["metric_pose_solved"] and not evidence["canonical_geometry_modified"]
    with pytest.raises(ValueError, match="image-bound"):
        register_front(image, 8, 6, control, "different")
    control["derived_input_sha256"] = "derived-v1"
    with pytest.raises(ValueError, match="derived image changed"):
        register_front(image, 8, 6, control, "abc", "derived-v2")
    register_front(image, 8, 6, control, "abc", "derived-v1")
