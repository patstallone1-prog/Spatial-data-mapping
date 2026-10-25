"""Object storage behind one small interface: a local folder, or a Cloudflare R2 bucket.

Two buckets, two sets of credentials (``cloud/docs/secrets.md``):

* ``kerbside-private`` -- raw inputs, model caches, checkpoints, queue backups. Never public.
* ``kerbside-public``  -- approved, immutable chunks and release manifests. Read by browsers.

Writes that must not race -- the release pointer -- use a conditional put: ``if_match`` (the
object is still the version read) or ``if_none_match`` (nothing is there yet). R2 honours both on
PutObject; the local store emulates them under a lock.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar


class PreconditionFailed(Exception):
    """A conditional write lost: someone else changed the object first."""


@dataclass(frozen=True)
class Head:
    key: str
    size: int
    etag: str


class ObjectStore:
    """The operations the cloud system needs, and nothing more."""

    name = "store"

    def put(self, key: str, data: bytes, *, content_type: str = "application/octet-stream",
            cache_control: str | None = None, if_match: str | None = None,
            if_none_match: bool = False) -> str:
        raise NotImplementedError

    def put_file(self, key: str, path: Path, **kw) -> str:
        return self.put(key, Path(path).read_bytes(), **kw)

    def get(self, key: str) -> bytes:
        raise NotImplementedError

    def get_file(self, key: str, path: Path) -> int:
        data = self.get(key)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        return len(data)

    def head(self, key: str) -> Head | None:
        raise NotImplementedError

    def list(self, prefix: str = "") -> Iterator[str]:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def get_json(self, key: str, default=None):
        try:
            return json.loads(self.get(key))
        except KeyError:
            return default

    def put_json(self, key: str, value, **kw) -> str:
        kw.setdefault("content_type", "application/json")
        return self.put(key, json.dumps(value, indent=1, sort_keys=True).encode(), **kw)


class LocalStore(ObjectStore):
    """A folder that behaves like a bucket: keys are paths, the etag is the content's sha256.
    Content types and cache headers are kept beside each object so a test server can serve them."""

    _locks: ClassVar[dict[str, threading.Lock]] = {}

    def __init__(self, root: Path | str, name: str = "local"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.name = name
        self._lock = self._locks.setdefault(str(self.root.resolve()), threading.Lock())

    def _path(self, key: str) -> Path:
        if not key or key.startswith("/") or ".." in Path(key).parts:
            raise ValueError(f"bad key {key!r}")
        return self.root / key

    def put(self, key, data, *, content_type="application/octet-stream", cache_control=None,
            if_match=None, if_none_match=False) -> str:
        path = self._path(key)
        with self._lock:
            current = self.head(key)
            if if_none_match and current is not None:
                raise PreconditionFailed(key)
            if if_match is not None and (current is None or current.etag != if_match):
                raise PreconditionFailed(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            meta = {"content_type": content_type, "cache_control": cache_control}
            path.with_name(f".{path.name}.meta").write_text(json.dumps(meta))
        return hashlib.sha256(data).hexdigest()

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise KeyError(key) from None

    def get_file(self, key: str, path: Path) -> int:
        source = self._path(key)
        if not source.is_file():
            raise KeyError(key)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.part")
        shutil.copyfile(source, tmp)
        os.replace(tmp, path)
        return path.stat().st_size

    def head(self, key: str) -> Head | None:
        path = self._path(key)
        if not path.is_file():
            return None
        return Head(key, path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())

    def meta(self, key: str) -> dict:
        path = self._path(key)
        side = path.with_name(f".{path.name}.meta")
        return json.loads(side.read_text()) if side.is_file() else {}

    def list(self, prefix: str = "") -> Iterator[str]:
        for path in sorted(self.root.rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                key = path.relative_to(self.root).as_posix()
                if key.startswith(prefix):
                    yield key

    def delete(self, key: str) -> None:
        path = self._path(key)
        path.unlink(missing_ok=True)
        path.with_name(f".{path.name}.meta").unlink(missing_ok=True)


class R2Store(ObjectStore):
    """A Cloudflare R2 bucket through its S3 API (``pip install -e ".[cloud]"`` for boto3).

    Credentials come from the environment, never the repository: ``R2_ACCOUNT_ID`` and, per
    bucket, an access key pair scoped to that bucket alone (``<PREFIX>_ACCESS_KEY_ID`` /
    ``<PREFIX>_SECRET_ACCESS_KEY``, e.g. ``R2_PRIVATE_...``)."""

    def __init__(self, bucket: str, *, account_id: str = "", access_key_id: str,
                 secret_access_key: str, client=None, endpoint_url: str | None = None,
                 region: str = "auto"):
        self.bucket = bucket
        self.name = bucket
        if client is None:
            import boto3
            from botocore.config import Config

            if endpoint_url is None and account_id:
                endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
            client = boto3.client(
                "s3", endpoint_url=endpoint_url,
                aws_access_key_id=access_key_id, aws_secret_access_key=secret_access_key,
                region_name=region,
                config=Config(retries={"max_attempts": 8, "mode": "adaptive"},
                              signature_version="s3v4", max_pool_connections=32))
        self.client = client

    @classmethod
    def from_env(cls, bucket_env: str, prefix: str, env=os.environ) -> R2Store:
        missing = [k for k in ("R2_ACCOUNT_ID", bucket_env, f"{prefix}_ACCESS_KEY_ID",
                               f"{prefix}_SECRET_ACCESS_KEY") if not env.get(k)]
        if missing:
            raise RuntimeError(f"R2 store needs {', '.join(missing)} (cloud/docs/secrets.md)")
        return cls(env[bucket_env], account_id=env["R2_ACCOUNT_ID"],
                   access_key_id=env[f"{prefix}_ACCESS_KEY_ID"],
                   secret_access_key=env[f"{prefix}_SECRET_ACCESS_KEY"])

    @classmethod
    def s3_from_env(cls, bucket: str, prefix: str, env=os.environ) -> R2Store:
        """An S3 bucket (AWS, or any S3-compatible service at ``S3_ENDPOINT_URL``): the same
        calls as R2, conditional writes included (S3 has had If-Match / If-None-Match on
        PutObject since 2024). ``AWS_REGION`` names the bucket's region; per bucket, an access
        key pair scoped to it alone (``S3_PRIVATE_...`` / ``S3_PUBLIC_...``)."""
        need = ("AWS_REGION", f"{prefix}_ACCESS_KEY_ID", f"{prefix}_SECRET_ACCESS_KEY")
        missing = [k for k in need if not env.get(k)]
        if missing:
            raise RuntimeError(f"S3 store needs {', '.join(missing)} (cloud/docs/secrets.md)")
        return cls(bucket, access_key_id=env[f"{prefix}_ACCESS_KEY_ID"],
                   secret_access_key=env[f"{prefix}_SECRET_ACCESS_KEY"],
                   endpoint_url=env.get("S3_ENDPOINT_URL") or None, region=env["AWS_REGION"])

    def _missing(self, exc) -> bool:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
        return code in ("NoSuchKey", "404", "NotFound")

    def put(self, key, data, *, content_type="application/octet-stream", cache_control=None,
            if_match=None, if_none_match=False) -> str:
        # Integrity is checked end to end instead: a content-addressed object is named by its
        # sha256, and every reader hashes what it fetched (checkpoint.py).
        args = {"Bucket": self.bucket, "Key": key, "Body": data, "ContentType": content_type}
        if cache_control:
            args["CacheControl"] = cache_control
        if if_match is not None:
            args["IfMatch"] = if_match
        if if_none_match:
            args["IfNoneMatch"] = "*"
        try:
            out = self.client.put_object(**args)
        except Exception as exc:  # botocore.exceptions.ClientError, without importing it here
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            if code in ("PreconditionFailed", "412", "ConditionalRequestConflict"):
                raise PreconditionFailed(key) from exc
            raise
        return out["ETag"].strip('"')

    def get(self, key: str) -> bytes:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception as exc:
            if self._missing(exc):
                raise KeyError(key) from None
            raise

    def head(self, key: str) -> Head | None:
        try:
            out = self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if self._missing(exc):
                return None
            raise
        return Head(key, out["ContentLength"], out["ETag"].strip('"'))

    def list(self, prefix: str = "") -> Iterator[str]:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                yield item["Key"]

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def open_store(url: str, *, role: str = "private", env=os.environ) -> ObjectStore:
    """``file:///path`` (or a bare path) for a local store; ``r2://bucket`` for R2 and
    ``s3://bucket`` for S3, with the credentials for ``role`` (``private`` or ``public``) from
    the environment."""
    if url.startswith("s3://"):
        bucket = url[len("s3://"):].strip("/")
        prefix = {"private": "S3_PRIVATE", "public": "S3_PUBLIC"}[role]
        return R2Store.s3_from_env(bucket, prefix, env)
    if url.startswith("r2://"):
        bucket = url[len("r2://"):].strip("/")
        prefix = {"private": "R2_PRIVATE", "public": "R2_PUBLIC"}[role]
        merged = {**env, "_BUCKET": bucket}
        return R2Store.from_env("_BUCKET", prefix, merged)
    path = url[len("file://"):] if url.startswith("file://") else url
    return LocalStore(path, name=Path(path).name)
