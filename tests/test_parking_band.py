"""A parking lane is a measured band of parked cars, or it is a prior that says so."""

from __future__ import annotations

from datetime import date

from smc.measure.parking_band import MAX_REACH_M, VehicleObservation, parking_band


def seen(reach, day, moving=False):
    return VehicleObservation(reach, date(2026, 5, day), moving)


def test_many_parked_cars_over_several_dates_make_a_band():
    obs = [seen(2.0 + 0.02 * i, 1 + i % 4) for i in range(20)]
    band = parking_band(obs)
    assert band.status == "measured"
    assert 2.2 <= band.width_m <= 2.4        # the 85th percentile of the road-side edges
    assert band.vehicles == 20 and band.dates == 4


def test_one_day_of_looking_is_not_enough():
    obs = [seen(2.1, 3) for _ in range(30)]
    band = parking_band(obs)
    assert band.status == "too_few" and band.width_m is None and band.dates == 1


def test_moving_vehicles_and_vehicles_in_the_traffic_lane_do_not_count():
    parked = [seen(2.1 + 0.01 * i, 1 + i % 3) for i in range(10)]
    traffic = [seen(4.5, 1 + i % 3) for i in range(20)]           # beyond any parking lane
    passing = [seen(2.2, 1 + i % 3, moving=True) for i in range(20)]
    band = parking_band(parked + traffic + passing)
    assert band.status == "measured" and band.vehicles == 10
    assert band.width_m < MAX_REACH_M


def test_the_crooked_van_does_not_set_the_edge():
    obs = [seen(2.1 + 0.01 * i, 1 + i % 3) for i in range(20)] + [seen(3.1, 2)]
    band = parking_band(obs)
    assert band.width_m < 2.5


def test_enough_looking_with_nothing_parked_is_a_finding():
    obs = [seen(4.2, 1 + i % 4) for i in range(30)]               # traffic only, four dates
    band = parking_band(obs)
    assert band.status == "none" and band.width_m is None
