import json
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("region, share", [
    ("sf-mission", 0.5), ("sf-haight-castro", 0.35), ("sf-sunset", 0.35),
    ("san-jose-downtown", 0.3), ("berkeley-downtown", 0.1), ("palo-alto-downtown", 0.1),
])
def test_app_regions_lay_their_streets_on_the_lidar_kerbs(region, share):
    path = ROOT / "docs/app-regions" / region / "sf-corridor-3d.json"
    if not path.exists():
        pytest.skip("app region not published")
    streets = [w for w in json.loads(path.read_text())["ways"] if w.get("kind") == "street"]
    grades = Counter(row[3] for w in streets for row in w.get("xs", []) if len(row) >= 4)
    assert grades["L"] / sum(grades.values()) >= share
    # The key the profiles are matched by is not left behind on ways that had none.
    assert not any(str(w.get("cnn", "")).startswith("osm:") for w in streets)
