import cv2
import numpy as np

from smc.facades.window_shapes import arched_profile


def window(arched=True):
    image = np.full((140, 100, 3), 90, np.uint8)
    colour = (230, 230, 230)
    if arched:
        cv2.ellipse(image, (50, 55), (45, 50), 0, 180, 360, colour, 3)
        cv2.line(image, (5, 55), (5, 132), colour, 3)
        cv2.line(image, (95, 55), (95, 132), colour, 3)
        cv2.line(image, (5, 132), (95, 132), colour, 3)
    else:
        cv2.rectangle(image, (5, 5), (95, 132), colour, 3)
    cv2.line(image, (50, 55), (50, 132), colour, 2)
    cv2.line(image, (5, 82), (95, 82), colour, 2)
    return image


def test_supported_arch_retains_crown_without_claiming_metric_truth():
    result = arched_profile(window())
    assert result and result["shape"] == "arched"
    assert 0.55 < result["arch_spring_fraction"] < 0.75
    assert result["shape_requires_review"]


def test_rectangular_frames_blinds_and_flat_wall_do_not_become_arches():
    assert arched_profile(window(False)) is None
    assert arched_profile(np.full((140, 100, 3), 200, np.uint8)) is None
    curtains = window(False)
    for x in range(12, 90, 8):
        cv2.line(curtains, (x, 15), (x, 120), (235, 220, 120), 3)
    assert arched_profile(curtains) is None
