"""Mapillary parsing, against payloads shaped like the ones the Graph API returns.

The provider cannot be exercised end to end without a token, so what is pinned here is
everything that happens after the bytes arrive: the field choices that would otherwise be
silent, and the two that have caused real errors elsewhere in this project -- a timestamp in the
wrong unit, and a position taken from the wrong field.
"""

from __future__ import annotations

import unittest

from smc.imagery.mapillary import MapillaryCredentialMissing, MapillaryProvider
from smc.imagery.region import SF_CORRIDOR
from smc.imagery.schema import PROJECTION_PERSPECTIVE, PROJECTION_SPHERICAL

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
        self.assertEqual(observation.provider_metadata_version, "mapillary:sfm")

    def test_raw_gps_is_used_when_there_is_no_computed_position(self) -> None:
        row = {k: v for k, v in IMAGE.items() if k != "computed_geometry"}
        observation = self.provider._to_observation(row)
        assert observation is not None
        self.assertAlmostEqual(observation.latitude, 37.7990)
        self.assertEqual(observation.provider_metadata_version, "mapillary:gps")

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


if __name__ == "__main__":
    unittest.main()
