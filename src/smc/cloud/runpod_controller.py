"""The controller as a RunPod CPU pod: plan it, create it, and stop or start it.

    smc-cloud runpod-controller plan     # what would be created, secrets masked; no network call
    smc-cloud runpod-controller check    # the key works and what pods exist; reads only, costs nothing
    smc-cloud runpod-controller create   # creates the pod (it bills from here) and prints its address
    smc-cloud runpod-controller status | stop | start

Run from the repository with the controller's settings in the shell (``set -a; source
cloud/config/controller.env; set +a``). ``RUNPOD_API_KEY`` is read from there and never printed.
The workers the controller starts run the same build as the controller: ``--tag`` (default: the
commit at the tip of origin/main), checked to exist on GHCR for both images before anything is
created. The controller finds its own address from its pod id (controller.Config.load); its
queue is backed up to the private bucket every five minutes and restored on start, so a stopped
pod loses at most those five minutes, and a stopped pod costs nothing (no volume).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from .providers import CONTROLLER_POD, RunPodProvider, controller_pod_body, runpod_proxy_url

ROOT = Path(__file__).resolve().parents[3]
OWNER = "patstallone1-prog"
#: What the controller's pod is given, from the operator's shell (cloud/docs/secrets.md).
REQUIRED = ("KERBSIDE_SECRET", "KERBSIDE_OPS_TOKEN", "RUNPOD_API_KEY", "AWS_REGION",
            "S3_PRIVATE_BUCKET", "S3_PRIVATE_ACCESS_KEY_ID", "S3_PRIVATE_SECRET_ACCESS_KEY",
            "S3_PUBLIC_BUCKET", "S3_PUBLIC_ACCESS_KEY_ID", "S3_PUBLIC_SECRET_ACCESS_KEY",
            "S3_PUBLIC_BASE")
OPTIONAL = ("S3_ENDPOINT_URL", "MAPILLARY_ACCESS_TOKEN", "MAPILLARY_TOKEN", "HUGGINGFACE_TOKEN")


def controller_env(env=os.environ) -> dict[str, str]:
    missing = [k for k in REQUIRED if not env.get(k)]
    if missing:
        raise SystemExit(f"set {', '.join(missing)} (cloud/config/controller.env; cloud/docs/secrets.md)")
    return {k: env[k] for k in (*REQUIRED, *OPTIONAL) if env.get(k)}


def masked(body: dict) -> dict:
    """The pod body as it may be shown: every value in its environment hidden but the names."""
    shown = {k: ("<set>" if k not in ("AWS_REGION", "S3_PRIVATE_BUCKET", "S3_PUBLIC_BUCKET",
                                      "S3_PUBLIC_BASE", "KERBSIDE_IMAGE_TAG", "KERBSIDE_PORT",
                                      "S3_ENDPOINT_URL") else v)
             for k, v in body["env"].items()}
    return {**body, "env": shown}


def default_tag(root: Path = ROOT) -> str:
    subprocess.run(["git", "fetch", "-q", "origin", "main"], cwd=root, check=False)
    return subprocess.run(["git", "rev-parse", "origin/main"], cwd=root, capture_output=True,
                          text=True, check=True).stdout.strip()


def image_exists(repo: str, tag: str) -> bool:
    """Whether ghcr.io/<owner>/<repo>:<tag> is there and public (an anonymous pull token)."""
    try:
        with urllib.request.urlopen(f"https://ghcr.io/token?scope=repository:{OWNER}/{repo}:pull",
                                    timeout=30) as r:
            token = json.loads(r.read())["token"]
        req = urllib.request.Request(f"https://ghcr.io/v2/{OWNER}/{repo}/manifests/{tag}", method="HEAD",
                                     headers={"Authorization": f"Bearer {token}", "Accept": ", ".join((
                                         "application/vnd.oci.image.index.v1+json",
                                         "application/vnd.oci.image.manifest.v1+json",
                                         "application/vnd.docker.distribution.manifest.v2+json"))})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except OSError:
        return False


def build_body(env: dict, tag: str, *, flavor: str, vcpus: int) -> dict:
    return controller_pod_body(f"ghcr.io/{OWNER}/kerbside-cpu:{tag}", {**env, "KERBSIDE_IMAGE_TAG": tag},
                               flavor=flavor, vcpus=vcpus)


def find(provider: RunPodProvider) -> dict | None:
    return next((p for p in provider.all_pods() if p.get("name") == CONTROLLER_POD), None)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="smc-cloud runpod-controller", description=__doc__.split("\n\n")[0])
    ap.add_argument("action", choices=["plan", "check", "create", "status", "stop", "start"])
    ap.add_argument("--tag", help="the image build to run (default: origin/main's commit)")
    ap.add_argument("--flavor", default="cpu3c", help="RunPod CPU flavour for the controller")
    ap.add_argument("--vcpus", type=int, default=2)
    args = ap.parse_args(argv)
    if args.action in ("plan", "create"):
        env = controller_env()
        tag = args.tag or default_tag()
        body = build_body(env, tag, flavor=args.flavor, vcpus=args.vcpus)
        images = {repo: image_exists(repo, tag) for repo in ("kerbside-cpu", "kerbside-gpu")}
        if args.action == "plan":
            print(json.dumps({"would_create": masked(body), "images_on_ghcr": images}, indent=1))
            return 0 if all(images.values()) else 1
        if not all(images.values()):
            raise SystemExit(f"not on GHCR for {tag}: {[r for r, ok in images.items() if not ok]}")
    key = os.environ.get("RUNPOD_API_KEY")
    if not key:
        raise SystemExit("set RUNPOD_API_KEY (cloud/config/controller.env)")
    provider = RunPodProvider(key)
    pod = find(provider)
    if args.action == "check":
        pods = provider.all_pods()
        print(json.dumps({"key": "works", "pods": [{"id": p.get("id"), "name": p.get("name"),
                          "status": p.get("desiredStatus"), "usd_per_hour": p.get("costPerHr")}
                         for p in pods]}, indent=1))
        return 0
    if args.action == "create":
        if pod:
            raise SystemExit(f"{CONTROLLER_POD} exists already ({pod.get('id')}): start it instead")
        made = provider.create_pod(body)
        print(json.dumps({"created": made.get("id"), "url": runpod_proxy_url(made["id"]),
                          "usd_per_hour": made.get("costPerHr"), "image_tag": tag}, indent=1))
        return 0
    if not pod:
        raise SystemExit(f"no pod named {CONTROLLER_POD}: create it first")
    if args.action == "stop":
        provider.stop(pod["id"])
    elif args.action == "start":
        provider.start(pod["id"])
    pod = provider.get(pod["id"])
    print(json.dumps({"id": pod.get("id"), "status": pod.get("desiredStatus"),
                      "url": runpod_proxy_url(pod["id"]), "usd_per_hour": pod.get("costPerHr")}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
