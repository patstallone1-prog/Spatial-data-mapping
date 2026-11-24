"""Mapillary parsing, against payloads shaped like the ones the Graph API returns.

The provider cannot be exercised end to end without a token, so what is pinned here is
everything that happens after the bytes arrive: the field choices that would otherwise be
silent, and the two that have caused real errors elsewhere in this project -- a timestamp in the
wrong unit, and a position taken from the wrong field.
"""

from __future__ import annotations

import unittest
import urllib.parse

from smc.imagery.mapillary import (
    MAX_TILE_DEG,
    MapillaryCredentialMissing,
    MapillaryProvider,
    tiles,
)
from smc.imagery.region import SF_CORRIDOR, BBox
from smc.imagery.schema import METADATA_VERSION, PROJECTION_PERSPECTIVE, PROJECTION_SPHERICAL

IMAGE = {
    "id": "1234567890",
    "sequence": "seq-abc",
    "captured_at": 1465800000000,
    "geometry": {"type": "Point", "coordinates": [-122.4200, 37.7990]},
    "computed_geometry": {"type": "Point", "coordinates": [-122.4201, 37.7991]},
    "compass_angle": 12.0,
    "computed_compass_angle": 15.5,
    "altitude": 30.0,
    "computed_altitude": 31.5,
    "camera_type": "perspective",
    "camera_parameters": [0.85, 0.0, 0.0],
    "width": 4032,
    "height": 3024,
    "make": "Apple",
    "model": "iPhone 13 Pro",
    "quality_score": 0.71,
    "creator": {"id": "creator-9"},
}


class TestMapillaryParsing(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = MapillaryProvider(token="test-token")

    def test_capture_time_is_read_as_milliseconds(self) -> None:
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None and observation.captured_at is not None
        # Seconds would put this in 1970; milliseconds put it in 2016, which is when Mapillary
        # coverage of this corridor actually begins.
        self.assertEqual(observation.captured_at.year, 2016)

    def test_structure_from_motion_position_wins_and_says_so(self) -> None:
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None
        self.assertAlmostEqual(observation.latitude, 37.7991)
        self.assertAlmostEqual(observation.longitude, -122.4201)
        self.assertEqual(observation.position_source, "mapillary:sfm")
        # Not smuggled through the normalisation schema version, which means something else.
        self.assertEqual(observation.provider_metadata_version, METADATA_VERSION)

    def test_the_gps_fix_survives_the_solved_pose(self) -> None:
        # Keeping only the chosen position threw away the fix on every solved frame, and how
        # far the two disagree is what says whether either can be trusted.
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None
        self.assertAlmostEqual(observation.computed_latitude, 37.7991)
        self.assertAlmostEqual(observation.raw_latitude, 37.7990)
        self.assertNotAlmostEqual(observation.raw_latitude, observation.computed_latitude)

    def test_raw_gps_is_used_when_there_is_no_computed_position(self) -> None:
        row = {k: v for k, v in IMAGE.items() if k != "computed_geometry"}
        observation = self.provider._to_observation(row)
        assert observation is not None
        self.assertAlmostEqual(observation.latitude, 37.7990)
        self.assertEqual(observation.position_source, "mapillary:gps")
        self.assertIsNone(observation.computed_latitude)

    def test_headings_are_kept_apart_the_same_way(self) -> None:
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None
        self.assertEqual(observation.heading_deg, observation.computed_heading_deg)
        self.assertIsNotNone(observation.raw_heading_deg)

    def test_a_frame_with_no_position_at_all_is_dropped(self) -> None:
        row = {k: v for k, v in IMAGE.items() if k not in ("geometry", "computed_geometry")}
        self.assertIsNone(self.provider._to_observation(row))

    def test_resolution_and_projection(self) -> None:
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None
        self.assertAlmostEqual(observation.original_megapixels, 4032 * 3024 / 1e6)
        self.assertEqual(observation.projection_type, PROJECTION_PERSPECTIVE)
        spherical = self.provider._to_observation({**IMAGE, "camera_type": "spherical"})
        assert spherical is not None
        self.assertEqual(spherical.projection_type, PROJECTION_SPHERICAL)

    def test_focal_length_is_reported_as_a_35mm_equivalent(self) -> None:
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None
        # Mapillary gives focal length as a fraction of the long side; millimetres would need a
        # sensor size the API never supplies, so anything in that field would be invented.
        self.assertIsNone(observation.focal_length_mm)
        self.assertAlmostEqual(observation.focal_length_35mm, 0.85 * 36.0)

    def test_licence_is_share_alike(self) -> None:
        observation = self.provider._to_observation(IMAGE)
        assert observation is not None
        self.assertEqual(observation.license_id, "CC-BY-SA-4.0")
        self.assertTrue(self.provider.get_license().share_alike)

    def test_sequence_record_counts_its_frames(self) -> None:
        for _ in range(3):
            self.provider._to_observation(IMAGE)
        record = self.provider.get_sequence("seq-abc")
        assert record is not None
        self.assertEqual(record.observation_count, 3)
        self.assertEqual(record.camera_model, "iPhone 13 Pro")


class TestMapillaryCredential(unittest.TestCase):
    def test_a_missing_token_is_a_setup_error_not_a_crash(self) -> None:
        provider = MapillaryProvider(token="")
        self.assertFalse(provider.has_credential)
        with self.assertRaises(MapillaryCredentialMissing) as caught:
            list(provider.iter_region_observations(SF_CORRIDOR))
        self.assertIn("MAPILLARY_TOKEN", str(caught.exception))


class FakeGraph:
    """Answers ``/images?bbox=`` from a fixed set of frames, like the API does for small boxes."""

    def __init__(self, frames, page=1000, cursor_pages=False):
        self.frames, self.page, self.cursor_pages, self.boxes = frames, page, cursor_pages, []

    def get_json(self, url):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        if "after" in q:
            start = int(q["after"])
            west, south, east, north = map(float, q["bbox"].split(","))
        else:
            start = 0
            west, south, east, north = map(float, q["bbox"].split(","))
            self.boxes.append((west, south, east, north))
        inside = [
            f
            for f in self.frames
            if west <= f["geometry"]["coordinates"][0] <= east
            and south <= f["geometry"]["coordinates"][1] <= north
        ]
        data = inside[start : start + self.page]
        out = {"data": data}
        if self.cursor_pages and start + self.page < len(inside):
            out["paging"] = {"next": url.split("&after=")[0] + f"&after={start + self.page}"}
        return out


def frame(i, lon, lat):
    return {
        **IMAGE,
        "id": str(i),
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "computed_geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


class TestMapillarySearchDensity(unittest.TestCase):
    BOX = BBox(37.8000, -122.4400, 37.8025, -122.4375)  # 0.0025 degrees a side

    def test_tiles_cover_the_box_and_none_is_too_big(self) -> None:
        cells = tiles(self.BOX)
        self.assertEqual(len(cells), 16)
        for c in cells:
            self.assertLessEqual(c.north - c.south, MAX_TILE_DEG + 1e-12)
            self.assertLessEqual(c.east - c.west, MAX_TILE_DEG + 1e-12)
        self.assertAlmostEqual(
            sum((c.north - c.south) * (c.east - c.west) for c in cells), 0.0025 * 0.0025
        )
        self.assertEqual(max(c.north for c in cells), self.BOX.north)
        self.assertEqual(max(c.east for c in cells), self.BOX.east)

    def test_a_region_is_never_asked_for_whole(self) -> None:
        # The API answers a big box with a sample and no cursor, which reads as complete.
        graph = FakeGraph([frame(1, -122.4390, 37.8010)])
        provider = MapillaryProvider(graph, token="t")
        list(provider.region_rows(self.BOX))
        self.assertEqual(len(graph.boxes), 16)
        for west, south, east, north in graph.boxes:
            self.assertLessEqual(north - south, MAX_TILE_DEG + 1e-9)
            self.assertLessEqual(east - west, MAX_TILE_DEG + 1e-9)

    def test_a_full_page_without_a_cursor_is_split(self) -> None:
        cell = tiles(self.BOX)[0]
        pts = [
            frame(
                i,
                cell.west + (i % 10 + 0.5) * (cell.east - cell.west) / 10,
                cell.south + (i // 10 + 0.5) * (cell.north - cell.south) / 10,
            )
            for i in range(100)
        ]
        graph = FakeGraph(pts, page=40)
        provider = MapillaryProvider(graph, token="t", page_limit=40)
        got = {r["id"] for r in provider.region_rows(cell)}
        self.assertEqual(got, {str(i) for i in range(100)})
        self.assertGreater(len(graph.boxes), 1)

    def test_a_cursor_is_followed_instead_of_splitting(self) -> None:
        cell = tiles(self.BOX)[0]
        pts = [frame(i, cell.west + 1e-5 * (i + 1), cell.south + 1e-5) for i in range(30)]
        graph = FakeGraph(pts, page=10, cursor_pages=True)
        provider = MapillaryProvider(graph, token="t", page_limit=10)
        got = [r["id"] for r in provider.region_rows(cell)]
        self.assertEqual(len(got), 30)
        self.assertEqual(len(graph.boxes), 1)

    def test_a_frame_on_a_tile_edge_is_returned_once(self) -> None:
        edge = tiles(self.BOX)[0].east
        graph = FakeGraph([frame(7, edge, 37.8001)])
        provider = MapillaryProvider(graph, token="t")
        self.assertEqual([r["id"] for r in provider.region_rows(self.BOX)], ["7"])

    def test_finished_tiles_are_skipped_on_resume(self) -> None:
        from smc.imagery.region import Region

        region = Region("test", self.BOX, "test box")
        graph = FakeGraph([frame(1, -122.4390, 37.8010)])
        provider = MapillaryProvider(graph, token="t")
        done = []
        provider.on_box_done = done.append
        list(provider.iter_region_observations(region))
        self.assertEqual(len(done), 16)
        again = MapillaryProvider(FakeGraph([]), token="t")
        again.completed_boxes = set(done[:10])
        list(again.iter_region_observations(region))
        self.assertEqual(len(again._http.boxes), 6)


if __name__ == "__main__":
    unittest.main()
