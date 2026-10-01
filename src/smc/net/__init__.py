"""Network plumbing shared by every fetch: which certificates to trust, and how long to wait."""

from __future__ import annotations

import os
import threading
import time
import urllib.request


def use_certifi() -> str | None:
    """Point Python's TLS at certifi's bundle when the system's is stale.

    macOS's /etc/ssl/cert.pem lacked the ZeroSSL chain data.sfgov.org serves, so every fetch
    of the city's records failed certificate verification while curl succeeded. certifi's
    bundle is current; setting SSL_CERT_FILE makes the default context use it, in this
    process and in every child. Returns the path, or None when certifi is not installed.
    """
    if os.environ.get("SSL_CERT_FILE"):
        return os.environ["SSL_CERT_FILE"]
    try:
        import certifi
    except ImportError:
        return None
    os.environ["SSL_CERT_FILE"] = certifi.where()
    return certifi.where()


def read_by(response, deadline_s: float) -> bytes:
    """A whole HTTP response body, or ``TimeoutError`` once ``deadline_s`` has passed.

    ``urlopen``'s timeout bounds each socket read, not the response: a server that trickles a
    few bytes a minute never trips it. One did, holding the facade survey in a single read for a
    quarter of an hour. ``read1`` returns after one underlying read, so the deadline is checked
    as often as anything arrives.
    """
    deadline = time.monotonic() + deadline_s
    chunks = []
    while block := response.read1(1 << 16):
        chunks.append(block)
        if time.monotonic() > deadline:
            raise TimeoutError(f"response still arriving after {deadline_s:.0f} s")
    return b"".join(chunks)


def fetch(request: urllib.request.Request | str, deadline_s: float,
          read_timeout_s: float = 60.0) -> bytes:
    """GET a URL, all of it -- connection, headers and body -- within ``deadline_s``.

    ``read_by`` bounds the body; it cannot bound the wait for the headers, and a connection
    through a proxy that never answered held the survey in the status-line read for a quarter
    of an hour with the socket timeout set. So the request runs on a daemon thread and is
    abandoned at the deadline: the caller gets ``TimeoutError`` and retries, and the stuck
    thread ends whenever its connection does.
    """
    box: dict[str, object] = {}

    def run() -> None:
        try:
            with urllib.request.urlopen(request, timeout=read_timeout_s) as response:
                box["body"] = read_by(response, deadline_s)
        except BaseException as exc:  # handed to the caller's thread
            box["error"] = exc

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(deadline_s)
    if worker.is_alive():
        raise TimeoutError(f"no complete response within {deadline_s:.0f} s")
    if "error" in box:
        raise box["error"]  # type: ignore[misc]
    return box["body"]  # type: ignore[return-value]


#: Public Overpass instances, tried in turn: the main one answers 504 under load.
OVERPASS_ENDPOINTS = ("https://overpass-api.de/api/interpreter",
                      "https://overpass.private.coffee/api/interpreter",
                      "https://maps.mail.ru/osm/tools/overpass/api/interpreter")


def overpass(query: str, purpose: str, attempts: int = 3) -> dict:
    """An Overpass QL query's JSON, retried with backoff across the public instances."""
    import json
    import urllib.error
    import urllib.parse

    last: Exception | None = None
    for attempt in range(attempts):
        for endpoint in OVERPASS_ENDPOINTS:
            request = urllib.request.Request(
                endpoint, data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": f"Kerbside/0.1 ({purpose})"})
            try:
                return json.loads(fetch(request, 300, 200))
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                last = exc
        time.sleep(10 * 2 ** attempt)
    raise RuntimeError(f"Overpass unavailable for {purpose}: {last}")
