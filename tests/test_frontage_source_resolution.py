import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_thumbnail_cannot_claim_full_source_sampling_or_gain_detail_by_upsampling():
    density = runpy.run_path(str(ROOT / "scripts/filter_frontage_photos.py"))[
        "resolved_pixel_density"
    ]
    assert density(80, 4000, 1000) == 20
    assert density(80, 4000, 8000) == 80
    with pytest.raises(ValueError):
        density(80, 0, 1000)
