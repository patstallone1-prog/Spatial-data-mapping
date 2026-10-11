from types import SimpleNamespace

import pytest

from smc.facades.scheduling import evidence_group, fair_batch
from smc.imagery.frontage_sources import provider_for, read_source_pixels, source_block_reason
from smc.imagery.pandaset import PandaSetProvider


def item(region, provider, building, rank=1):
    return ({"building_id": building}, {"rank": (rank,), "pose_status": "provider_solved",
            "observation": {"provider": provider}}, region, "run")


def test_fairness_survives_restart_and_never_starves_small_city_or_provider():
    pending = [item("sf", "mapillary", str(i), 1000) for i in range(300)]
    pending += [item("sf", "kartaview", "k"), item("oakland", "mapillary", "o"),
                item("berkeley", "panoramax", "b"), item("sf", "pandaset", "p")]
    records = [{"region": "sf", "building_id": str(i), "candidate": {
        "observation": {"provider": "mapillary", "observation_uid": str(i)}}}
        for i in range(100)]
    chosen = fair_batch(pending, records, 4)
    assert {evidence_group(i) for i in chosen} == {
        ("sf", "kartaview"), ("sf", "pandaset"), ("oakland", "mapillary"),
        ("berkeley", "panoramax")}
    assert len(pending) == 304  # Work selection never thins the source archive.
    assert len(fair_batch(pending, [], 256)) == 256


def test_zero_limit_and_ranking_inside_same_queue():
    pending = [item("sf", "kartaview", "a", 1), item("sf", "kartaview", "b", 9)]
    assert fair_batch(pending, [], 0) == []
    assert fair_batch(pending, [], 1)[0][0]["building_id"] == "b"


def test_real_serialized_rank_contains_a_capture_date_not_only_numbers():
    first, second = item("sf", "kartaview", "a"), item("sf", "kartaview", "b")
    first[1]["rank"] = [True, 1.0, -5, 40, -20, "2020-01-01 00:00:00+00:00"]
    second[1]["rank"] = [True, 1.0, -5, 40, -20, "2025-01-01 00:00:00+00:00"]
    assert fair_batch([first, second], [], 1)[0][0]["building_id"] == "b"


def test_archive_pixel_reader_is_not_an_http_fetch(monkeypatch):
    provider = SimpleNamespace(name="pandaset", read_pixels=lambda observation: b"actual jpeg")
    monkeypatch.setattr("smc.imagery.frontage_sources.HttpClient.fetch",
                        lambda *a, **k: pytest.fail("must not download 44.5 GB zip as an image"))
    assert read_source_pixels(provider, object()) == b"actual jpeg"


def test_pandaset_canonical_id_resolves_camera_directory_not_nonexistent_flat_member():
    observation = SimpleNamespace(provider_image_id="027/right_camera/76")
    assert PandaSetProvider.image_path(observation) == "pandaset/027/camera/right_camera/76.jpg"
    with pytest.raises(Exception, match="invalid"):
        PandaSetProvider.image_path(SimpleNamespace(provider_image_id="027/../76"))


def test_federated_panorama_instance_is_not_a_bare_host_or_shared_between_instances():
    assert provider_for("panoramax", "api.panoramax.xyz")._endpoint == "https://api.panoramax.xyz/api"
    assert provider_for("panoramax", "https://fixture.test/alternate")._endpoint == "https://fixture.test/alternate"


@pytest.mark.parametrize("source", ["sf-xl", "3d-street-view", "3d_street_view"])
def test_restricted_dataset_cannot_be_laundered_as_a_free_license(source):
    assert source_block_reason(source)
    with pytest.raises(ValueError, match="restricted"):
        provider_for(source, "fixture")
