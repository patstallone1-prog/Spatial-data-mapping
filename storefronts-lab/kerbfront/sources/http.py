"""Cached HTTP: every response is kept with its URL and retrieval time.

The cache is the provenance record as well as a speed-up: a merged field cites the source and
``retrieved_at`` of the response it came from. Query secrets (``access_token``) are stripped
from what is stored. ``KERBFRONT_OFFLINE=1`` serves the cache only.
"""

from __future__ import annotations

import hashlib
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ..config import CACHE, USER_AGENT

def _context() -> ssl.SSLContext:
    """certifi's bundle when installed: the uv-managed Python ships without system roots."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL = _context()
SECRET_PARAMS = {"access_token", "key", "token"}


class Offline(RuntimeError):
    pass


def _clean(params: dict | None) -> dict:
    return {k: v for k, v in (params or {}).items() if k not in SECRET_PARAMS}


def cache_path(source: str, url: str, params: dict | None, data: str | None = None) -> Path:
    blob = json.dumps([url, sorted(_clean(params).items()), data], sort_keys=True, default=str)
    return CACHE / "http" / source / (hashlib.sha1(blob.encode()).hexdigest()[:20] + ".json")


def get_json(source: str, url: str, params: dict | None = None, *, data: str | None = None,
             refresh: bool = False, attempts: int = 4, timeout: int = 120) -> dict:
    """``{"url", "params", "retrieved_at", "body"}`` for a GET (or form POST when ``data``)."""
    path = cache_path(source, url, params, data)
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    if os.environ.get("KERBFRONT_OFFLINE") == "1":
        raise Offline(f"{source}: not cached and offline: {url}")
    full = url + ("?" + urllib.parse.urlencode(params) if params else "")
    body = data.encode() if data is not None else None
    last: Exception | None = None
    for i in range(attempts):
        req = urllib.request.Request(full, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL) as r:
                payload = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404):
                raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
        time.sleep(2 ** i * 3)
    else:
        raise RuntimeError(f"{source}: {url} failed after {attempts} attempts: {last}")
    rec = {"url": url, "params": _clean(params), "retrieved_at":
           datetime.now(timezone.utc).isoformat(timespec="seconds"), "body": payload}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rec))
    return rec


def get_bytes(source: str, url: str, dest: Path, *, attempts: int = 4, timeout: int = 120) -> Path:
    if dest.exists():
        return dest
    if os.environ.get("KERBFRONT_OFFLINE") == "1":
        raise Offline(f"{source}: not cached and offline: {dest.name}")
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout, context=SSL) as r:
                blob = r.read()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(blob)
            return dest
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 ** i * 2)
    raise RuntimeError(f"{source}: download failed: {last}")
