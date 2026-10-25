"""Compute that comes and goes: RunPod pods (CPU and GPU), or Hetzner Cloud servers for CPU work.

A worker is launched knowing only two things: where the controller is and a one-time bootstrap
token. It trades the token for its environment (``/api/bootstrap``) -- the private bucket's
keys, the imagery tokens -- so no credential sits in a server's user data or a pod's settings,
and a token is no use twice. Every instance is labelled ``kerbside=worker`` with its worker id,
so the scheduler (and the independent watchdog) can find and delete any instance it does not
recognise.

The provider tokens (``HCLOUD_TOKEN``, ``RUNPOD_API_KEY``) live only on the controller and in the
watchdog's secrets.

API references (checked 2026-10-18; the request shapes are held by tests/test_cloud_providers.py
against recorded exchanges, and must be re-checked against the live APIs at first deployment):
Hetzner Cloud https://docs.hetzner.cloud/ (POST/GET/DELETE /v1/servers);
RunPod REST https://rest.runpod.io/v1/docs (POST/GET/DELETE /v1/pods).
"""

from __future__ import annotations

import contextlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Pool:
    """One kind of worker: what it runs on and how many may run."""

    name: str  # cpu | gpu
    provider: str  # hetzner | runpod | fake
    instance_type: str  # e.g. cpx32, or a RunPod GPU type id
    hourly_usd: float
    image: str  # the container image the worker runs
    max_workers: int = 4
    #: Jobs one worker runs at once; network-bound lidar and terrain pack several to a worker.
    slots: int = 1
    #: Minutes without a job before a worker is stopped.
    idle_minutes: float = 10
    #: Hours after which a worker takes no new job and is replaced (memory leaks, stuck mounts).
    max_hours: float = 24
    #: Billing granularity: an instance stopped early still costs this many hours.
    min_billed_hours: float = 0.0
    location: str = ""
    disk_gb: int = 80
    extra: dict = field(default_factory=dict)


@dataclass
class Instance:
    id: str
    worker_id: str
    pool: str
    state: str
    created_at: float


class ProviderError(Exception):
    pass


class Provider:
    name = "provider"

    def launch(self, worker_id: str, pool: Pool, boot: dict) -> Instance:
        raise NotImplementedError

    def terminate(self, instance_id: str) -> None:
        raise NotImplementedError

    def list(self) -> list[Instance]:
        raise NotImplementedError


def _request(method: str, url: str, token: str, body: dict | None = None, timeout: float = 60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json",
        "User-Agent": "kerbside-cloud/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:500].decode("utf-8", "replace")
        if method == "DELETE" and exc.code == 404:
            return {}  # already gone: deleting is idempotent
        raise ProviderError(f"{method} {url}: HTTP {exc.code}: {detail}") from exc
    except OSError as exc:
        raise ProviderError(f"{method} {url}: {exc}") from exc


def worker_cloud_init(pool: Pool, boot: dict) -> str:
    """User data for a Hetzner worker: Docker (the ``docker-ce`` app image has it), the worker
    image, and nothing secret but a one-time token."""
    env = "\n".join(f"      {k}={v}" for k, v in sorted(boot.items()))
    return f"""#cloud-config
write_files:
  - path: /etc/kerbside/boot.env
    permissions: '0600'
    content: |
{env}
runcmd:
  - [sh, -c, "docker pull {pool.image}"]
  - [sh, -c, "docker run --rm --name kerbside-worker --env-file /etc/kerbside/boot.env -v /var/kerbside:/work {pool.image} worker; poweroff"]
"""


class HetznerProvider(Provider):
    name = "hetzner"
    API = "https://api.hetzner.cloud/v1"

    def __init__(self, token: str, *, ssh_keys: list[str] | None = None,
                 firewall_ids: list[int] | None = None, network_id: int | None = None,
                 request=_request):
        self.token = token
        self.ssh_keys = ssh_keys or []
        self.firewall_ids = firewall_ids or []
        self.network_id = network_id
        self._request = request

    def launch(self, worker_id, pool, boot):
        body = {
            "name": worker_id, "server_type": pool.instance_type, "image": "docker-ce",
            "location": pool.location or None, "start_after_create": True,
            "user_data": worker_cloud_init(pool, boot),
            "labels": {"kerbside": "worker", "worker": worker_id, "pool": pool.name},
            "ssh_keys": self.ssh_keys,
            "public_net": {"enable_ipv4": True, "enable_ipv6": True},
        }
        if self.firewall_ids:
            body["firewalls"] = [{"firewall": f} for f in self.firewall_ids]
        if self.network_id:
            body["networks"] = [self.network_id]
        body = {k: v for k, v in body.items() if v is not None}
        out = self._request("POST", f"{self.API}/servers", self.token, body)
        server = out["server"]
        return Instance(str(server["id"]), worker_id, pool.name, server.get("status", "starting"),
                        time.time())

    def terminate(self, instance_id):
        self._request("DELETE", f"{self.API}/servers/{instance_id}", self.token)

    def list(self):
        out, page = [], 1
        while True:
            found = self._request("GET", f"{self.API}/servers?label_selector=kerbside%3Dworker"
                                  f"&per_page=50&page={page}", self.token)
            for server in found.get("servers", []):
                labels = server.get("labels", {})
                out.append(Instance(str(server["id"]), labels.get("worker", server["name"]),
                                    labels.get("pool", "cpu"), server.get("status", "?"),
                                    _iso(server.get("created"))))
            if not (found.get("meta", {}).get("pagination", {}) or {}).get("next_page"):
                return out
            page += 1


class RunPodProvider(Provider):
    """On-demand pods: GPU pods for the house pipeline and, with ``extra.compute = "CPU"``, CPU
    pods for the cell stages and the interior engine (``instance_type`` is then the CPU flavour,
    ``cpu3c`` or ``cpu5c``, and ``extra.vcpus`` its size). No network volume by default: the
    work tree is restored from the private bucket at start (measured: ``smc.cloud.estimate``),
    which is cheaper than a volume billed every hour of the month for a pod that runs a few
    hours a day. RunPod charges no data ingress or egress."""

    name = "runpod"
    API = "https://rest.runpod.io/v1"

    def __init__(self, token: str, *, request=_request):
        self.token = token
        self._request = request

    def launch(self, worker_id, pool, boot):
        body = {
            "name": worker_id, "imageName": pool.image,
            "cloudType": pool.extra.get("cloud_type", "SECURE"),
            "interruptible": bool(pool.extra.get("interruptible", False)),
            "containerDiskInGb": pool.disk_gb, "volumeInGb": 0,
            "env": {**boot, "KERBSIDE_WORKER_LABEL": f"kerbside-worker:{worker_id}"},
            "dockerStartCmd": ["worker"],
        }
        if str(pool.extra.get("compute", "GPU")).upper() == "CPU":
            body.update(computeType="CPU", cpuFlavorIds=[pool.instance_type],
                        vcpuCount=int(pool.extra.get("vcpus", 2)))
        else:
            body.update(computeType="GPU", gpuTypeIds=[pool.instance_type], gpuCount=1)
            # Only hosts whose driver runs the image's CUDA build.
            if pool.extra.get("cuda_versions"):
                body["allowedCudaVersions"] = list(pool.extra["cuda_versions"])
        out = self._request("POST", f"{self.API}/pods", self.token, body)
        return Instance(str(out["id"]), worker_id, pool.name, out.get("desiredStatus", "starting"),
                        time.time())

    def terminate(self, instance_id):
        self._request("DELETE", f"{self.API}/pods/{instance_id}", self.token)

    def list(self):
        found = self._request("GET", f"{self.API}/pods", self.token)
        pods = found if isinstance(found, list) else found.get("pods", found.get("data", []))
        out = []
        for pod in pods:
            name = pod.get("name", "")
            if not name.startswith("kw-"):
                continue  # only pods this system named; never the owner's, nor the controller
            # kw-<pool>-<hex>: the scheduler's own names (scheduler.py).
            pool = name.split("-")[1] if name.count("-") >= 2 else "gpu"
            started = pod.get("createdAt") or pod.get("lastStartedAt")
            out.append(Instance(str(pod["id"]), name, pool, pod.get("desiredStatus", "?"),
                                _iso(started)))
        return out

    # -- the controller's own pod (smc-cloud runpod-controller) -----------------------------

    def get(self, pod_id: str) -> dict:
        return self._request("GET", f"{self.API}/pods/{pod_id}", self.token)

    def create_pod(self, body: dict) -> dict:
        return self._request("POST", f"{self.API}/pods", self.token, body)

    def stop(self, pod_id: str) -> dict:
        return self._request("POST", f"{self.API}/pods/{pod_id}/stop", self.token)

    def start(self, pod_id: str) -> dict:
        return self._request("POST", f"{self.API}/pods/{pod_id}/start", self.token)

    def all_pods(self) -> list[dict]:
        found = self._request("GET", f"{self.API}/pods", self.token)
        return found if isinstance(found, list) else found.get("pods", found.get("data", []))


#: The controller's pod: small, CPU only, always on while the cloud works. Its queue lives on
#: the container disk and is backed up to the private bucket every five minutes; a restarted
#: pod restores the latest backup (controller.restore_queue), so it needs no paid volume.
CONTROLLER_POD = "kerbside-controller"


def controller_pod_body(image: str, env: dict, *, flavor: str = "cpu3c", vcpus: int = 2,
                        port: int = 8080, config: str = "cloud/config/kerbside-cloud.toml") -> dict:
    return {
        "name": CONTROLLER_POD, "imageName": image, "computeType": "CPU",
        "cpuFlavorIds": [flavor], "vcpuCount": vcpus, "cloudType": "SECURE",
        "interruptible": False, "containerDiskInGb": 20, "volumeInGb": 0,
        "ports": [f"{port}/http"], "env": {**env, "KERBSIDE_PORT": str(port)},
        "dockerStartCmd": ["controller", "--config", config],
    }


def runpod_proxy_url(pod_id: str, port: int = 8080) -> str:
    """The pod's HTTPS address for an exposed HTTP port (docs.runpod.io, expose ports)."""
    return f"https://{pod_id}-{port}.proxy.runpod.net"


class FakeProvider(Provider):
    """Instances as local processes running the real worker: the whole lifecycle -- launch,
    bootstrap, lease, crash, reap, idle stop -- exercised without an account."""

    name = "fake"

    def __init__(self, workdir: Path, *, python: str = sys.executable, extra_env: dict | None = None):
        self.workdir = Path(workdir)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.python = python
        self.extra_env = extra_env or {}
        self.procs: dict[str, subprocess.Popen] = {}
        self.meta: dict[str, Instance] = {}
        self.launched: list[str] = []

    def launch(self, worker_id, pool, boot):
        env = {**os.environ, **self.extra_env, **boot}
        log = open(self.workdir / f"{worker_id}.log", "ab")  # noqa: SIM115 -- the process keeps it
        proc = subprocess.Popen([self.python, "-m", "smc.cloud.cli", "worker"], env=env,
                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        instance = Instance(str(proc.pid), worker_id, pool.name, "running", time.time())
        self.procs[instance.id] = proc
        self.meta[instance.id] = instance
        self.launched.append(worker_id)
        return instance

    def crash(self, worker_id: str) -> None:
        """Kill a worker's process outright, as a lost server would be."""
        for iid, inst in self.meta.items():
            if inst.worker_id == worker_id and self.procs[iid].poll() is None:
                os.killpg(self.procs[iid].pid, signal.SIGKILL)
                self.procs[iid].wait()

    def terminate(self, instance_id):
        """Like deleting a server: it is asked to stop and is gone. Not waited on here -- the
        worker may be the one asking (its goodbye), and a provider's delete returns at once."""
        proc = self.procs.get(instance_id)
        if proc and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)

            def reap():
                try:
                    proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()

            threading.Thread(target=reap, daemon=True).start()
        self.meta.pop(instance_id, None)

    def list(self):
        return [inst for iid, inst in self.meta.items() if self.procs[iid].poll() is None]


def _iso(text: str | None) -> float:
    if not text:
        return time.time()
    from datetime import datetime

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()
