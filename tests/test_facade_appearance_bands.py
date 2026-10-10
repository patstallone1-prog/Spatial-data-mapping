import numpy as np
import pytest

from smc.facades.appearance_bands import appearance_bands, window_trim
from smc.facades.fit import extract_front


def test_distinct_floor_colours_not_averaged_and_unknown_materials_not_repeated():
    image = np.empty((300, 200, 3), np.uint8)
    image[:150] = (170, 190, 220)
    image[150:] = (80, 70, 60)
    labels = np.ones((300, 200), np.uint8)
    fit = extract_front(
        image, labels, 6, 6, {"levels": 2, "material": "brick", "detector_proposals": []}
    )
    bands = fit["appearance"]["bands"]
    assert [(b["bottom_m"], b["top_m"]) for b in bands] == [(0, 3), (3, 6)]
    assert [b["colour"] for b in bands] == ["#3c4650", "#dcbeaa"]
    assert all(b["material"] == "unknown" for b in bands)
    assert all(b["other_sides_basis"] == "inferred_same_height_band" for b in bands)


def test_reviewed_materials_can_differ_at_a_nonuniform_storefront_boundary():
    image = np.full((200, 200, 3), 100, np.uint8)
    labels = np.ones((200, 200), np.uint8)
    bands = [
        {
            "bottom_m": 0,
            "top_m": 4,
            "colour": "#774433",
            "material": "brick",
            "image_sha256": "abc",
            "reviewer": "fixture",
        },
        {
            "bottom_m": 4,
            "top_m": 9,
            "colour": "#ddeedd",
            "material": "stucco_render",
            "image_sha256": "abc",
            "reviewer": "fixture",
        },
    ]
    result = appearance_bands(
        image, labels, 9, {}, [], {"image_sha256": "abc", "appearance_bands": bands}
    )
    assert [b["material"] for b in result["bands"]] == ["brick", "stucco_render"]
    bands[1]["image_sha256"] = "other"
    with pytest.raises(ValueError):
        appearance_bands(
            image, labels, 9, {}, [], {"image_sha256": "abc", "appearance_bands": bands}
        )


def test_opening_pixels_and_trim_do_not_change_wall_colour():
    image = np.full((200, 200, 3), (100, 130, 170), np.uint8)
    labels = np.ones((200, 200), np.uint8)
    image[50:150, 50:150] = 245
    result = appearance_bands(
        image,
        labels,
        4,
        {"status": "prior_constrained", "storeys": 1},
        [{"u": 1, "v": 1, "w": 2, "h": 2}],
        {"facade_width_m": 4},
    )
    assert result["bands"][0]["colour"] == "#aa8264"
    assert appearance_bands(image, labels, 4, {}, [], {})["bands"] == []


def test_white_window_trim_separate_from_wall_and_white_glass_does_not_count():
    image = np.full((200, 200, 3), (100, 130, 170), np.uint8)
    image[50:150, 50:150] = 235
    image[62:138, 62:138] = 40
    opening = {"u": 1, "v": 1, "w": 2, "h": 2}
    bands = [{"bottom_m": 0, "top_m": 4, "colour": "#aa8264"}]
    result = window_trim(image, opening, 4, 4, bands)
    assert result["colour"] == "#ebebeb" and result["width_m"] == 0.06
    image[50:150, 50:150] = 235
    assert window_trim(image, opening, 4, 4, bands) is None


def test_white_wall_not_invented_as_differently_coloured_trim():
    image = np.full((200, 200, 3), 235, np.uint8)
    image[62:138, 62:138] = 40
    assert (
        window_trim(
            image,
            {"u": 1, "v": 1, "w": 2, "h": 2},
            4,
            4,
            [{"bottom_m": 0, "top_m": 4, "colour": "#ebebeb"}],
        )
        is None
    )


def test_overlap_is_rejected_not_painted_twice():
    image = np.full((200, 200, 3), 100, np.uint8)
    labels = np.ones((200, 200), np.uint8)
    controls = {
        "image_sha256": "abc",
        "appearance_bands": [
            {"bottom_m": 0, "top_m": 3, "image_sha256": "abc", "reviewer": "fixture"},
            {"bottom_m": 2, "top_m": 4, "image_sha256": "abc", "reviewer": "fixture"},
        ],
    }
    with pytest.raises(ValueError, match="overlapping"):
        appearance_bands(image, labels, 4, {}, [], controls)


def test_reviewed_band_needs_real_source_hash_not_two_missing_hashes():
    image = np.full((100, 100, 3), 100, np.uint8)
    with pytest.raises(ValueError, match="image-bound"):
        appearance_bands(
            image,
            np.ones((100, 100), np.uint8),
            4,
            {},
            [],
            {"appearance_bands": [{"bottom_m": 0, "top_m": 4, "reviewer": "fixture"}]},
        )


def test_observed_colour_boundary_without_storeys_is_not_a_floor_fact():
    image = np.full((240, 160, 3), (80, 90, 100), np.uint8)
    image[:150] = (170, 190, 220)
    result = appearance_bands(image, np.ones((240, 160), np.uint8), 8, {}, [], {})
    assert len(result["bands"]) == 2
    assert result["bands"][0]["top_m"] == pytest.approx(3)
    assert "no invented storeys" in result["boundaries_basis"]
    assert all(b["material"] == "unknown" for b in result["bands"])


def test_gradual_lighting_gradient_and_masked_vehicle_do_not_make_colour_bands():
    image = np.repeat(np.linspace(70, 220, 240, dtype=np.uint8)[:, None, None], 160, axis=1)
    image = np.repeat(image, 3, axis=2)
    labels = np.ones((240, 160), np.uint8)
    assert appearance_bands(image, labels, 8, {}, [], {})["bands"] == []
    image[:] = 150
    image[150:] = 45
    labels[150:] = 20
    assert appearance_bands(image, labels, 8, {}, [], {})["bands"] == []
