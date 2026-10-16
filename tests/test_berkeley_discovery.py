from smc.imagery.region import get_region
from smc.regions.discover import capability_vector, municipal_records


def test_berkeley_has_ramp_inventory_but_not_surveyed_curb_lines_or_widths():
    records = municipal_records(get_region("berkeley-downtown").bbox)
    assert records["city"] == "berkeley"
    assert "curb_ramps" in records["records"]
    assert "curb_lines" not in records["records"]
    vector = capability_vector({}, [{"coverage": 1}], {}, records)
    assert vector["curb_ramps"] == "official"
    assert vector["kerbs"] == "lidar"
    assert vector["sidewalk_width"] == "lidar"
