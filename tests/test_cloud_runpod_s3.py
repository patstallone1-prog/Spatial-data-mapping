"""Everything on RunPod, stored in S3: CPU pods for the CPU pool, the controller as a pod that
finds its own address, an S3 store from the environment, and a plan that prints no secret."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from smc.cloud import runpod_controller
from smc.cloud.controller import Config
from smc.cloud.providers import CONTROLLER_POD, Pool, RunPodProvider, controller_pod_body
from smc.cloud.store import R2Store, open_store

ROOT = Path(__file__).resolve().parents[1]
# An S3 store is a boto3 client: the cloud images have it, the site CI does not.
needs_boto3 = pytest.mark.skipif(importlib.util.find_spec("boto3") is None,
                                 reason="boto3 (the cloud extra)")
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


@needs_boto3
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


@needs_boto3
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


class FakeS3:
    """A bucket as the storage check sees it: conditional writes, and a key it may refuse."""

    def __init__(self, objects: dict, allowed: bool = True):
        self.objects, self.allowed = objects, allowed

    def put(self, key, data, *, if_none_match=False, **kw):
        if not self.allowed:
            raise RuntimeError("An error occurred (AccessDenied) when calling the PutObject operation")
        if if_none_match and key in self.objects:
            raise runpod_controller.PreconditionFailed(key)
        self.objects[key] = data
        return "etag"

    def get(self, key):
        return self.objects[key]

    def delete(self, key):
        self.objects.pop(key, None)


def fake_storage(*, cors: bool = True, worker_may_publish: bool = False):
    buckets = {"kerbside-private": {}, "kerbside-public": {}}

    def open_s3(bucket, prefix, env):
        allowed = prefix == "S3_PUBLIC" or bucket == "kerbside-private" or worker_may_publish
        return FakeS3(buckets[bucket], allowed=allowed)

    class Response:
        def __init__(self, body):
            self.body, self.headers = body, {"Access-Control-Allow-Origin": "*"} if cors else {}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return self.body

    def fetch(req, timeout):
        assert req.full_url.startswith("https://d1.cloudfront.net/_probe/")
        assert req.get_header("Origin") == runpod_controller.SITE_ORIGIN
        return Response(buckets["kerbside-public"][req.full_url.split(".net/", 1)[1]])

    return buckets, open_s3, fetch


def test_the_storage_check_proves_both_buckets_cloudfront_and_that_workers_cannot_publish() -> None:
    buckets, open_s3, fetch = fake_storage()
    out = runpod_controller.check_storage(ENV, fetch=fetch, open_s3=open_s3)
    assert out["all_ok"], out
    assert out["private key refused by the public bucket"] == "ok"
    assert buckets == {"kerbside-private": {}, "kerbside-public": {}}  # the probes are gone


def test_the_storage_check_names_what_to_fix() -> None:
    _, open_s3, fetch = fake_storage(cors=False, worker_may_publish=True)
    out = runpod_controller.check_storage(ENV, fetch=fetch, open_s3=open_s3)
    assert not out["all_ok"]
    assert "CORS-S3Origin" in out["public: through CloudFront with CORS"]
    assert "scope its policy" in out["private key refused by the public bucket"]


def test_keys_go_into_the_settings_by_whose_they_are_and_are_never_shown(tmp_path) -> None:
    env_file = tmp_path / "controller.env"
    env_file.write_text("RUNPOD_API_KEY=\nAWS_REGION=us-east-2\nS3_PRIVATE_ACCESS_KEY_ID=   # x\n"
                        "S3_PRIVATE_SECRET_ACCESS_KEY=\nS3_PUBLIC_ACCESS_KEY_ID=\n"
                        "S3_PUBLIC_SECRET_ACCESS_KEY=\nS3_PUBLIC_BASE=https://d1.cloudfront.net\n")
    hidden = iter(["rpa_FAKE", "p" * 39 + "/", "q" * 39 + "+"])
    plain = iter(["AKIA" + "B" * 16, "AKIA" + "A" * 16])
    owners = {"AKIA" + "A" * 16: "kerbside-private-worker", "AKIA" + "B" * 16: "kerbpublicworker"}
    said = []
    assert runpod_controller.set_keys(env_file, ask=lambda _p: next(hidden),
                                      ask_plain=lambda _p: next(plain),
                                      whoami=lambda k, s, region: owners[k], say=said.append) == 0
    # The pairs were typed public first; each lands by its IAM user, quoted for the shell.
    import subprocess
    out = subprocess.run(["bash", "-c", f"set -a; source {env_file}; env"], capture_output=True,
                         text=True, check=True).stdout
    got = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    assert got["RUNPOD_API_KEY"] == "rpa_FAKE" and got["AWS_REGION"] == "us-east-2"
    assert got["S3_PRIVATE_ACCESS_KEY_ID"] == "AKIA" + "A" * 16
    assert got["S3_PRIVATE_SECRET_ACCESS_KEY"] == "q" * 39 + "+"
    assert got["S3_PUBLIC_SECRET_ACCESS_KEY"] == "p" * 39 + "/"
    assert oct(env_file.stat().st_mode & 0o777) == "0o600"
    for secret in ("rpa_FAKE", "p" * 39, "q" * 39):
        assert not any(secret in line for line in said)


def test_keys_writes_nothing_for_a_key_aws_refuses(tmp_path) -> None:
    env_file = tmp_path / "controller.env"
    env_file.write_text("RUNPOD_API_KEY=\nS3_PRIVATE_ACCESS_KEY_ID=\n")
    hidden = iter(["", "s" * 40])

    def refuse(*_a):
        raise RuntimeError("InvalidClientTokenId")

    assert runpod_controller.set_keys(env_file, ask=lambda _p: next(hidden),
                                      ask_plain=lambda _p: "AKIA" + "C" * 16, whoami=refuse,
                                      say=lambda _m: None) == 1
    assert env_file.read_text() == "RUNPOD_API_KEY=\nS3_PRIVATE_ACCESS_KEY_ID=\n"
