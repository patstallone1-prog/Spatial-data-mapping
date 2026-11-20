"""The lidar and the street as witnesses for what the ground is (smc.truth.sources, and
imagery_truth.fuse, which puts them beside the photographs)."""

import base64
import zlib

import numpy as np
import pytest

from smc.truth import imagery_truth as it
from smc.truth import sources


class Flat:
    """A page whose metres are degrees times a round number: east is +x, north is -z."""

    K = 1e-5

    def lonlat(self, x, z):
        return -122.0 + np.asarray(x, float) * self.K, 37.0 - np.asarray(z, float) * self.K

    def from_lonlat(self, lon, lat):
        return np.atleast_1d((np.asarray(lon, float) + 122.0) / self.K), np.atleast_1d((37.0 - np.asarray(lat, float)) / self.K)


def view(x, z, compass, labels, camera="perspective"):
    lon, lat = Flat().lonlat(x, z)
    h, w = labels.shape
    return {"id": f"v{x}:{z}:{compass}", "camera": camera, "focal": 0.85, "width": w, "height": h, "lonlat": [float(lon), float(lat)],
            "compass": compass, "size": [w, h], "labels": base64.b64encode(zlib.compress(labels.astype(np.uint8).tobytes(), 9)).decode()}


def test_the_map_projection_goes_there_and_back():
    x, y = sources.mercator(-122.4358, 37.8018)
    lon, lat = sources.unmercator(x, y)
    assert float(lon) == pytest.approx(-122.4358, abs=1e-9) and float(lat) == pytest.approx(37.8018, abs=1e-9)


def test_the_lidars_cut_between_asphalt_and_concrete_is_found_from_rings_already_known():
    cut = sources.threshold_between([180, 200, 210, 230, 250, 400], [520, 560, 610, 640, 700, 240])
    # (One asphalt ring reads strong and one concrete ring weak: eleven of the twelve fall the right side.)
    assert cut["cut"] == 520 and cut["right"] == pytest.approx(11 / 12, abs=0.001)
    assert sources.threshold_between([200, 210], [600, 610, 620, 630]) is None, "too few to say"


def test_the_grounds_strength_is_read_from_its_tile(tmp_path):
    lidar = sources.LidarGround(Flat(), cache=tmp_path)
    grid = np.full((500, 500), np.nan, np.float32)
    grid[20:40, 100:140] = 300.0          # z 10..20 m, x 50..70 m
    lidar.tiles[(0, 0)] = grid
    lidar.tiles[(1, 0)] = None            # a tile that could not be had
    s = lidar.strength([60.0, 60.0, 300.0], [15.0, 100.0, 15.0])
    assert s[0] == 300.0 and np.isnan(s[1]) and np.isnan(s[2])


def test_a_camera_calls_the_ground_in_front_of_it_and_not_what_is_behind_or_far_off():
    road = np.zeros((288, 384), np.uint8)
    road[150:, :] = 3                       # below the horizon: road
    road[150:, 250:] = 5                    # to the right: a verge
    street = sources.StreetViews([view(0.0, 0.0, 0.0, road)], Flat())   # looking north (-z)
    ahead = street.see([0.0, -1.0, 1.0], [-10.0, -12.0, -14.0])
    assert ahead["road"] == 3 and ahead["cameras"] == 1
    assert street.see([3.0], [-12.0])["planted"] == 1, "to its right, the verge"
    assert street.see([0.0], [10.0])["cameras"] == 0, "behind it"
    assert street.see([0.0], [-60.0])["cameras"] == 0, "too far to tell"
    # All round: a panorama sees behind too (north is the picture's middle).
    pano = np.zeros((256, 512), np.uint8)
    pano[128:, :] = 4
    assert sources.StreetViews([view(0.0, 0.0, 0.0, pano, "spherical")], Flat()).see([0.0], [10.0])["walk"] == 1


def rows_for_fuse():
    rows = [{"list": "plazas", "verdict": "asphalt", "sure": "two", "lidar": 200 + 10 * k, "lidar_n": 90, "ids": [f"a{k}"], "x": 0, "z": 0} for k in range(5)]
    rows += [{"list": "plazas", "verdict": "concrete", "sure": "two", "lidar": 600 + 10 * k, "lidar_n": 90, "ids": [f"c{k}"], "x": 0, "z": 0} for k in range(5)]
    return rows


def test_the_lidar_calls_what_the_photographs_could_not_see_when_something_says_it_is_hard():
    rows = rows_for_fuse()
    shade = {"list": "plazas", "verdict": it.UNSEEN, "sure": "no", "lidar": 205, "lidar_n": 80, "naip_plant": 0.05, "ids": ["shade"], "x": 0, "z": 0}
    lawn = {"list": "plazas", "verdict": it.UNSEEN, "sure": "no", "lidar": 650, "lidar_n": 80, "ids": ["lawn?"], "x": 0, "z": 0}
    kerb = {"list": "plazas", "verdict": it.UNSEEN, "sure": "no", "lidar": 640, "lidar_n": 80, "ids": ["kerb"], "x": 0, "z": 0,
            "street": {"road": 2, "walk": 40, "planted": 3, "cameras": 3}}
    rows += [shade, lawn, kerb]
    out = it.fuse(rows)
    assert out["lidar_used"] and out["lidar"]["right"] == 1.0 and out["called"] == 2
    assert shade["verdict"] == "asphalt" and shade["by"] == ["lidar"]
    assert lawn["verdict"] == it.UNSEEN, "a strong return alone is not concrete: grass sends back as much"
    assert kerb["verdict"] == "concrete" and kerb["sure"] == "two" and kerb["by"] == ["lidar", "street"]


def test_the_others_overrule_a_photograph_only_together_and_the_street_calls_what_is_planted():
    rows = rows_for_fuse()
    wrong = {"list": "plazas", "verdict": "concrete", "sure": "one", "lidar": 190, "lidar_n": 80, "ids": ["w"], "x": 0, "z": 0,
             "street": {"road": 50, "walk": 4, "planted": 2, "cameras": 4}}
    doubted = {"list": "plazas", "verdict": "concrete", "sure": "one", "lidar": 190, "lidar_n": 80, "ids": ["d"], "x": 0, "z": 0}
    backed = {"list": "plazas", "verdict": "asphalt", "sure": "one", "lidar": 195, "lidar_n": 80, "ids": ["b"], "x": 0, "z": 0}
    garden = {"list": "plazas", "verdict": "mixed", "sure": "no", "naip_plant": 0.7, "ids": ["g"], "x": 0, "z": 0,
              "street": {"road": 1, "walk": 4, "planted": 40, "cameras": 2}}
    rows += [wrong, doubted, backed, garden]
    it.fuse(rows)
    assert wrong["verdict"] == "asphalt" and wrong["was"] == "concrete"
    assert doubted["verdict"] == "mixed", "one against one: not called"
    assert backed["sure"] == "two" and backed["by"] == ["photograph", "lidar"]
    assert garden["verdict"] == "grass" and garden["sure"] == "two"


def test_a_lidar_that_cannot_tell_the_two_apart_is_not_used():
    rows = [{"list": "plazas", "verdict": v, "sure": "two", "lidar": s, "lidar_n": 90, "ids": [f"{v}{s}"], "x": 0, "z": 0}
            for v, s in [("asphalt", 300), ("asphalt", 500), ("asphalt", 310), ("asphalt", 520), ("concrete", 305), ("concrete", 510), ("concrete", 315), ("concrete", 505)]]
    hidden = {"list": "plazas", "verdict": it.UNSEEN, "sure": "no", "lidar": 300, "lidar_n": 80, "naip_plant": 0.0, "ids": ["h"], "x": 0, "z": 0}
    out = it.fuse([*rows, hidden])
    assert not out["lidar_used"] and hidden["verdict"] == it.UNSEEN
