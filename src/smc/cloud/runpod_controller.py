"""The controller as a RunPod CPU pod: plan it, create it, and stop or start it.

    smc-cloud runpod-controller plan     # what would be created, secrets masked; no network call
    smc-cloud runpod-controller keys     # asks for the RunPod key and both AWS key pairs (hidden)
                                         # and writes them into controller.env
    smc-cloud runpod-controller storage  # both buckets, their keys and CloudFront, end to end; ~free
    smc-cloud runpod-controller check    # storage, then the key works and what pods exist; no pod made
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
import getpass
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .providers import CONTROLLER_POD, RunPodProvider, controller_pod_body, runpod_proxy_url
from .store import PreconditionFailed, R2Store

ROOT = Path(__file__).resolve().parents[3]
OWNER = "patstallone1-prog"
#: What the controller's pod is given, from the operator's shell (cloud/docs/secrets.md).
REQUIRED = ("KERBSIDE_SECRET", "KERBSIDE_OPS_TOKEN", "RUNPOD_API_KEY", "AWS_REGION",
            "S3_PRIVATE_BUCKET", "S3_PRIVATE_ACCESS_KEY_ID", "S3_PRIVATE_SECRET_ACCESS_KEY",
            "S3_PUBLIC_BUCKET", "S3_PUBLIC_ACCESS_KEY_ID", "S3_PUBLIC_SECRET_ACCESS_KEY",
            "S3_PUBLIC_BASE")
OPTIONAL = ("S3_ENDPOINT_URL", "MAPILLARY_ACCESS_TOKEN", "MAPILLARY_TOKEN", "HUGGINGFACE_TOKEN")
#: The page origin the viewer reads the public bucket from (cloud/infra/s3-cors.json).
SITE_ORIGIN = "https://spatial-data-mapping.vercel.app"


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


ENV_FILE = ROOT / "cloud/config/controller.env"


def iam_user(key_id: str, secret: str, region: str) -> str:
    """The IAM user an access key belongs to (STS GetCallerIdentity, which needs no permission)."""
    import boto3

    arn = boto3.client("sts", region_name=region or "us-east-1", aws_access_key_id=key_id,
                       aws_secret_access_key=secret).get_caller_identity()["Arn"]
    return arn.rsplit("/", 1)[-1]


def runpod_key_works(key: str) -> None:
    RunPodProvider(key).all_pods()


#: What AWS's error codes mean for a pasted key pair.
AWS_HINTS = {
    "InvalidClientTokenId": "AWS doesn't know that access key ID: check it was copied whole, is "
                            "Active in IAM, and wait a minute if it was just created",
    "SignatureDoesNotMatch": "the ID is right but the secret isn't its own: paste the secret "
                             "shown beside this ID when it was created",
    "AccessDenied": "the key works but isn't allowed to identify itself (unexpected for STS)",
}


def _aws_code(exc: Exception) -> str:
    return getattr(exc, "response", {}).get("Error", {}).get("Code", "") or type(exc).__name__


def _clean(value: str) -> str:
    """A pasted value without the spaces, newlines or quotes a copy can pick up."""
    return "".join(value.split()).strip("'\"")


def _save(env_file: Path, values: dict[str, str]) -> None:
    text = env_file.read_text()
    for name, value in values.items():
        line = f"{name}='{value}'"
        text, found = re.subn(rf"^{name}=.*$", lambda _m, line=line: line, text, flags=re.M)
        if not found:
            text += f"\n{line}\n"
    tmp = env_file.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.chmod(0o600)
    tmp.replace(env_file)


def set_keys(env_file: Path = ENV_FILE, *, ask=getpass.getpass, ask_plain=input, whoami=iam_user,
             runpod_check=runpod_key_works, say=print, tries: int = 3) -> int:
    """Write the RunPod key and both buckets' key pairs into controller.env, typed at hidden
    prompts so they never pass through a chat or a log. Each is checked with its service before
    it is saved, and saved as soon as it passes, so a later mistake loses nothing. Each AWS pair
    goes to the bucket its IAM user is for: a user named with "private" gets the private
    bucket, one with "pub" the public bucket. Enter at a prompt skips it. Nothing secret is
    printed: only the first 8 characters of an access key ID, and AWS's error code."""
    current = dict(re.findall(r"^([A-Z0-9_]+)=(.*)$", env_file.read_text(), flags=re.M))
    region = os.environ.get("AWS_REGION") or current.get("AWS_REGION", "").strip("'\" ")
    saved: list[str] = []
    for _ in range(tries):
        runpod = _clean(ask("RunPod API key (hidden; Enter to skip): "))
        if not runpod:
            break
        if not runpod.startswith("rpa_"):
            say(f"that isn't a RunPod key (they start rpa_; got {len(runpod)} characters). Again:")
            continue
        try:
            runpod_check(runpod)
        except Exception as exc:
            say(f"RunPod refused that key ({exc.__class__.__name__}: {str(exc)[:80]}). Again:")
            continue
        _save(env_file, {"RUNPOD_API_KEY": runpod})
        saved.append("RUNPOD_API_KEY")
        say("RunPod key works: saved")
        break
    roles: dict[str, str] = {}
    for _ in range(2 * tries):
        if len(roles) == 2:
            break
        key_id = _clean(ask_plain(f"AWS access key ID ({2 - len(roles)} pair(s) to go; Enter to "
                                  "stop): "))
        if not key_id:
            break
        if not re.fullmatch(r"A[KS]IA[A-Z0-9]{16}", key_id):
            say(f"an access key ID is 20 letters and digits starting AKIA (got {len(key_id)}). "
                "Again:")
            continue
        secret = _clean(ask(f"secret access key for {key_id[:8]}... (hidden): "))
        if len(secret) != 40:
            say(f"a secret access key is 40 characters (got {len(secret)}). Again:")
            continue
        try:
            user = whoami(key_id, secret, region)
        except Exception as exc:
            code = _aws_code(exc)
            say(f"{key_id[:8]}...: AWS said {code}: {AWS_HINTS.get(code, 'see the message above')}"
                ". Again:")
            continue
        role = "PRIVATE" if "private" in user.lower() else "PUBLIC" if "pub" in user.lower() else ""
        if not role:
            say(f"{key_id[:8]}... belongs to IAM user {user}, which is neither bucket's. Again:")
            continue
        if role in roles:
            say(f"{key_id[:8]}... is {user}'s too, already saved; paste the other user's pair:")
            continue
        _save(env_file, {f"S3_{role}_ACCESS_KEY_ID": key_id, f"S3_{role}_SECRET_ACCESS_KEY": secret})
        roles[role] = user
        saved += [f"S3_{role}_ACCESS_KEY_ID", f"S3_{role}_SECRET_ACCESS_KEY"]
        say(f"{key_id[:8]}... belongs to {user}: saved for the {role.lower()} bucket")
    say(f"saved {', '.join(saved) or 'nothing'} in {env_file} (values not shown)")
    return 0 if saved else 1


def _step(out: dict, name: str, fn) -> bool:
    try:
        fn()
    except Exception as exc:  # each step reports its own failure; none hides the next
        out[name] = f"FAIL: {type(exc).__name__}: {exc}"
        return False
    out[name] = "ok"
    return True


def check_storage(env=os.environ, fetch=urllib.request.urlopen, open_s3=R2Store.s3_from_env) -> dict:
    """Prove the buckets work as the cloud will use them, with one small probe object each:

    - each key writes, reads and deletes in its own bucket, and a conditional write
      (If-None-Match) is refused on an existing key, as the release pointer and the queue
      backups rely on;
    - the private (worker) key is refused by the public bucket, so a worker cannot publish;
    - the public probe answers through CloudFront (``S3_PUBLIC_BASE``) with CORS for the site.
    """
    out: dict = {}
    probe = f"_probe/check-{int(time.time())}.txt"
    body = b"kerbside storage check"
    for role, prefix in (("private", "S3_PRIVATE"), ("public", "S3_PUBLIC")):
        try:
            store = open_s3(env.get(f"{prefix}_BUCKET", ""), prefix, env)
        except RuntimeError as exc:
            out[f"{role}: key"] = f"FAIL: {exc}"
            continue

        def write(store=store):
            store.put(probe, body, content_type="text/plain", cache_control="no-store")

        def read_back(store=store):
            if store.get(probe) != body:
                raise RuntimeError("read back different bytes")

        def conditional_write(store=store):
            try:
                store.put(probe, body, if_none_match=True)
            except PreconditionFailed:
                return
            raise RuntimeError("a conditional write over an existing key was accepted")

        if not _step(out, f"{role}: write", write):
            continue
        _step(out, f"{role}: read back", read_back)
        _step(out, f"{role}: conditional write refused", conditional_write)
        if role == "public":
            _step(out, "public: through CloudFront with CORS",
                  lambda: _cloudfront(env, probe, body, fetch))
        _step(out, f"{role}: delete", lambda store=store: store.delete(probe))

    def worker_cannot_publish():
        crossed = open_s3(env.get("S3_PUBLIC_BUCKET", ""), "S3_PRIVATE", env)
        try:
            crossed.put(probe + ".worker", body)
        except Exception as exc:
            if any(s in str(exc) for s in ("AccessDenied", "Forbidden", "403")):
                return
            raise
        crossed.delete(probe + ".worker")
        raise RuntimeError("the private key can write the public bucket: scope its policy")

    if out.get("private: write") == "ok":
        _step(out, "private key refused by the public bucket", worker_cannot_publish)
    out["all_ok"] = all(v == "ok" for v in out.values())
    return out


def _cloudfront(env, key: str, body: bytes, fetch) -> None:
    base = env.get("S3_PUBLIC_BASE", "").rstrip("/")
    if not base.startswith("https://"):
        raise RuntimeError("S3_PUBLIC_BASE should be the https:// CloudFront address")
    req = urllib.request.Request(f"{base}/{key}", headers={"Origin": SITE_ORIGIN})
    try:
        with fetch(req, timeout=30) as r:
            got, allow = r.read(), r.headers.get("Access-Control-Allow-Origin")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} from CloudFront: check the distribution's origin is "
                           "the public bucket with Origin access control, and that the bucket "
                           "policy CloudFront offered was applied") from None
    if got != body:
        raise RuntimeError("CloudFront served different bytes")
    if allow not in ("*", SITE_ORIGIN):
        raise RuntimeError("no Access-Control-Allow-Origin: apply cloud/infra/s3-cors.json to the "
                           "public bucket, and set the CloudFront behaviour's origin request "
                           "policy to CORS-S3Origin")


def find(provider: RunPodProvider) -> dict | None:
    return next((p for p in provider.all_pods() if p.get("name") == CONTROLLER_POD), None)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="smc-cloud runpod-controller", description=__doc__.split("\n\n")[0])
    ap.add_argument("action", choices=["keys", "plan", "storage", "check", "create", "status",
                                       "stop", "start"])
    ap.add_argument("--tag", help="the image build to run (default: origin/main's commit)")
    ap.add_argument("--flavor", default="cpu3c", help="RunPod CPU flavour for the controller")
    ap.add_argument("--vcpus", type=int, default=2)
    ap.add_argument("--replace", action="store_true",
                    help="create: delete the existing controller pod first (to move it onto a new "
                         "build); its queue comes back from the private bucket's backup")
    args = ap.parse_args(argv)
    if args.action == "keys":
        return set_keys()
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
        # A controller that cannot reach its buckets would bill for nothing: prove them first.
        storage = check_storage()
        if not storage["all_ok"]:
            print(json.dumps({"storage": storage}, indent=1))
            raise SystemExit("storage check failed: nothing created")
    if args.action in ("storage", "check"):
        storage = check_storage()
        print(json.dumps({"storage": storage}, indent=1))
        if args.action == "storage" or not storage["all_ok"]:
            return 0 if storage["all_ok"] else 1
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
        if pod and not args.replace:
            raise SystemExit(f"{CONTROLLER_POD} exists already ({pod.get('id')}): start it, or "
                             "create --replace to move it onto this build")
        if pod:
            provider.terminate(pod["id"])
        made = provider.create_pod(body)
        url = runpod_proxy_url(made["id"])
        # The address is not secret; operator commands and github-secrets.sh read it from here.
        if ENV_FILE.exists():
            _save(ENV_FILE, {"KERBSIDE_CONTROLLER_URL": url})
        print(json.dumps({"created": made.get("id"), "url": url, "replaced": pod.get("id") if pod
                          else None, "usd_per_hour": made.get("costPerHr"), "image_tag": tag},
                         indent=1))
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
