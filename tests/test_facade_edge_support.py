import cv2
import numpy as np

from smc.facades.edge_support import opening_sanity, refine_opening


def test_supported_perimeter_moves_only_near_proposal():
    image = np.full((200, 200, 3), 220, np.uint8)
    cv2.rectangle(image, (50, 40), (130, 160), (20, 20, 20), -1)
    result = refine_opening(image, [0.24, 0.19, 0.66, 0.81])
    assert result["supported_sides"] == 4
    assert np.allclose(result["box"], [0.25, 0.2, 0.65, 0.8], atol=0.015)


def test_missing_edges_and_blank_images_abstain():
    image = np.full((200, 200, 3), 220, np.uint8)
    assert refine_opening(image, [0.2, 0.2, 0.8, 0.8])["basis"] == "detector_box_unresolved_edges"


def test_window_anomaly_not_changed_to_match_other_storey():
    a = {"id": "a", "kind": "window", "u": 1, "v": 1, "w": 1.2, "design": {"shape": "standard"}}
    b = {**a, "id": "b", "u": 1.4, "v": 4}
    result = opening_sanity([a, b])
    assert result["window_columns"][0]["status"] == "review_alignment_anomaly"
    assert b["u"] == 1.4 and not result["geometry_modified"]
