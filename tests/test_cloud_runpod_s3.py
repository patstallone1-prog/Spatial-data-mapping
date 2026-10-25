"""Everything on RunPod, stored in S3: CPU pods for the CPU pool, the controller as a pod that
finds its own address, an S3 store from the environment, and a plan that prints no secret."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from smc.cloud import runpod_controller
from smc.cloud.controller import Config
from smc.cloud.providers import CONTROLLER_POD, Pool, RunPodProvider, controller_pod_body
from smc.cloud.store import R2Store, open_store

ROOT = Path(__file__).resolve().parents[1]
ENV = {"KERBSIDE_SECRET": "sekrit", "KERBSIDE_OPS_TOKEN": "opstok", "RUNPOD_API_KEY": "rpkey",
       "AWS_REGION": "us-west-2", "S3_PRIVATE_BUCKET": "kerbside-private",
       "S3_PRIVATE_ACCESS_KEY_ID": "AKPRIV", "S3_PRIVATE_SECRET_ACCESS_KEY": "privsecret",
       "S3_PUBLIC_BUCKET": "kerbside-public", "S3_PUBLIC_ACCESS_KEY_ID": "AKPUB",
       "S3_PUBLIC_SECRET_ACCESS_KEY": "pubsecret", "S3_PUBLIC_BASE": "https://d1.cloudfront.net"}


def recorder(responses):
    calls = []

    def request(method, url, token, body=None, timeout=60):
        calls.append({"method": method, "url": url, "body": body})
        return responses.get((method, url), {})

    return calls, request


def test_a_cpu_pool_on_runpod_asks_for_a_cpu_pod_and_no_gpu() -> None:
    calls, request = recorder({("POST", "https://rest.runpod.io/v1/pods"): {"id": "c1"}})
    pool = Pool("cpu", "runpod", "cpu3g", 0.32, "ghcr.io/x/kerbside-cpu:abc", disk_gb=80,
                extra={"compute": "CPU", "vcpus": 8})
    RunPodProvider("rpkey", request=request).launch("kw-cpu-0001", pool, {"KERBSIDE_BOOT": "t"})
    body = calls[0]["body"]
    assert body["computeType"] == "CPU" and body["cpuFlavorIds"] == ["cpu3g"] and body["vcpuCount"] == 8
    assert "gpuTypeIds" not in body and "allowedCudaVersions" not in body
    assert body["dockerStartCmd"] == ["worker"] and body["env"]["KERBSIDE_BOOT"] == "t"


def test_listing_keeps_each_workers_pool_and_never_the_controller_or_the_owners_pods() -> None:
    _, request = recorder({("GET", "https://rest.runpod.io/v1/pods"): [
        {"id": "a", "name": "kw-cpu-1a2b", "desiredStatus": "RUNNING", "lastStartedAt": "2026-10-25T01:00:00Z"},
        {"id": "b", "name": "kw-gpu-3c4d", "desiredStatus": "RUNNING"},
        {"id": "c", "name": CONTROLLER_POD, "desiredStatus": "RUNNING"},
        {"id": "d", "name": "my pytorch box", "desiredStatus": "RUNNING"}]})
    found = RunPodProvider("rpkey", request=request).list()
    assert [(i.id, i.pool) for i in found] == [("a", "cpu"), ("b", "gpu")]
    assert found[0].created_at == 1792890000.0


def test_the_controller_on_runpod_takes_its_pods_proxy_address_and_runs_its_own_build() -> None:
    cfg = Config.load(ROOT / "cloud/config/kerbside-cloud.toml",
                      env={**ENV, "RUNPOD_POD_ID": "pod123", "KERBSIDE_IMAGE_TAG": "cafe"})
    assert cfg.url == "https://pod123-8080.proxy.runpod.net"
    assert cfg.pools["cpu"].provider == cfg.pools["gpu"].provider == "runpod"
    assert cfg.pools["cpu"].image.endswith("kerbside-cpu:cafe") and cfg.pools["gpu"].image.endswith(":cafe")
    assert cfg.worker_env["KERBSIDE_PRIVATE_STORE"] == "s3://kerbside-private"
    # Workers get the private bucket's key, never the public one's.
    assert "S3_PUBLIC_SECRET_ACCESS_KEY" not in cfg.worker_env
    assert cfg.budget.hard_monthly_usd <= 15


def test_an_s3_store_comes_from_the_environment_per_role() -> None:
    store = open_store("s3://kerbside-private", role="private", env=ENV)
    assert isinstance(store, R2Store) and store.bucket == "kerbside-private"
    assert store.client.meta.region_name == "us-west-2"
    assert store.client.meta.endpoint_url == "https://s3.us-west-2.amazonaws.com"
    with pytest.raises(RuntimeError, match="S3_PUBLIC_ACCESS_KEY_ID"):
        open_store("s3://kerbside-public", role="public", env={"AWS_REGION": "us-west-2"})


def test_the_controller_pod_is_a_small_cpu_pod_serving_its_port() -> None:
    body = controller_pod_body("ghcr.io/x/kerbside-cpu:abc", {"A": "1"})
    assert body["name"] == CONTROLLER_POD and body["computeType"] == "CPU"
    assert body["ports"] == ["8080/http"] and body["volumeInGb"] == 0
    assert body["dockerStartCmd"] == ["controller", "--config", "cloud/config/kerbside-cloud.toml"]


def test_the_plan_prints_no_secret_and_checks_both_images(monkeypatch, capsys) -> None:
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(runpod_controller, "image_exists", lambda repo, tag: True)
    assert runpod_controller.main(["plan", "--tag", "cafe"]) == 0
    out = capsys.readouterr().out
    for secret in ("sekrit", "opstok", "rpkey", "privsecret", "pubsecret", "AKPRIV", "AKPUB"):
        assert secret not in out
    plan = json.loads(out)
    assert plan["would_create"]["imageName"].endswith("kerbside-cpu:cafe")
    assert plan["would_create"]["env"]["KERBSIDE_IMAGE_TAG"] == "cafe"
    assert plan["images_on_ghcr"] == {"kerbside-cpu": True, "kerbside-gpu": True}
