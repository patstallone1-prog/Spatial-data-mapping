"""Where the cities outside San Francisco publish their records, and what reading them costs.

Every entry here was verified by fetching it, and the absences were verified too: a city with
nothing recorded is a city three endpoints were tried on.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.official.city_fetch import Answer, _touches  # noqa: E402
from smc.official.city_records import CITY_RECORDS, cities_with  # noqa: E402


def test_every_record_names_an_api_this_fetcher_can_read():
    for city, rows in CITY_RECORDS.items():
        for record in rows:
            assert record.api in ("socrata_table", "socrata_geospatial", "arcgis"), (city, record)
            if record.api == "arcgis":
                assert record.locator.startswith("https://"), record
            else:
                assert record.host, f"{city}/{record.key} is Socrata with no host"


def test_palo_alto_is_the_one_city_outside_san_francisco_with_a_surveyed_kerb_line():
    """Its Road Edge layer is the same class of record as San Francisco's Curbs and Islands.

    Oakland has curb ramps and a downtown kerb-use inventory but no kerb geometry, and
    Berkeley publishes none of it at all.
    """
    assert cities_with("curb_line") == ["palo-alto"]
    assert cities_with("parcels") == ["oakland", "palo-alto"]


def test_berkeley_is_recorded_as_having_nothing_rather_than_left_unasked():
    """Its Socrata datasets are shells -- 29,024 rows with zero data columns -- and its ArcGIS
    parcels are an analysis subset with six features in this region. That is a finding, and
    losing it means somebody spends another afternoon on it."""
    assert CITY_RECORDS["berkeley"] == []
    source = (ROOT / "src/smc/official/city_records.py").read_text()
    assert "29,024 rows with zero data columns" in source
    assert "Parcels2020city3000sqft" in source


def test_a_refusal_is_a_gap_with_a_reason_not_an_empty_answer():
    assert bool(Answer([{"x": 1}])) is True
    assert bool(Answer([], refused="503")) is False
    assert Answer([], refused="503").refused == "503"


def test_a_geospatial_layer_is_filtered_client_side_because_it_cannot_be_asked_for_a_box():
    box = {"south": 37.86, "west": -122.28, "north": 37.88, "east": -122.25}
    inside = {"type": "Point", "coordinates": [-122.27, 37.87]}
    outside = {"type": "Point", "coordinates": [-122.41, 37.79]}
    assert _touches(inside, box)
    assert not _touches(outside, box)
    # And a polygon counts if any vertex falls in the box.
    ring = {"type": "Polygon", "coordinates": [[[-122.41, 37.79], [-122.27, 37.87], [-122.40, 37.80]]]}
    assert _touches(ring, box)
    assert not _touches({}, box)
