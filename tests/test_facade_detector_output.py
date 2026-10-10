import numpy as np
import pytest

from smc.facades.detail_detection import decoded_objects, remap_ground_proposals


def test_empty_boxes_with_tokenizer_placeholder_are_valid_empty_evidence():
    assert (
        decoded_objects(
            {"boxes": np.empty((0, 4)), "scores": np.array([]), "text_labels": [""]}, (100, 200, 3)
        )
        == []
    )


def test_nonempty_mismatch_is_not_silently_truncated():
    with pytest.raises(ValueError, match="nonempty_detector_output_length_mismatch"):
        decoded_objects(
            {
                "boxes": np.array([[0, 0, 20, 20]]),
                "scores": np.array([0.6]),
                "text_labels": ["door", "window"],
            },
            (100, 200, 3),
        )


def test_boxes_stay_in_original_image_coordinates():
    result = decoded_objects(
        {
            "boxes": np.array([[20, 30, 100, 80]]),
            "scores": np.array([0.6]),
            "text_labels": ["door"],
        },
        (100, 200, 3),
    )
    assert result[0]["box"] == [0.1, 0.3, 0.5, 0.8]


def test_focused_ground_pass_remaps_without_becoming_multiview_truth():
    proposals = [{"kind": "garage door entrance door", "score": 0.4, "box": [0.2, 0.3, 0.6, 1]}]
    result = remap_ground_proposals(proposals, 60, 100)
    assert result[0]["box"] == [0.2, 0.72, 0.6, 1]
    assert result[0]["identity_ambiguous"]
    assert "same_pixels" in result[0]["source_crop"]
