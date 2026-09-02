"""A polite HTTP client for provider APIs.

Both providers here are free public services run by mapping communities rather than by anyone
being paid for the traffic. The client is built around that: a request rate that stays modest by
default, honest backoff when a server says it is busy, and a hard distinction between a failure
that means "this will never work" and one that means "not right now".

That distinction matters more than it sounds. A provider outage must never be recorded as a
deleted image -- the catalogue would quietly lose real coverage that comes back an hour later.
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

USER_AGENT = "Kerbside/0.1 (street-imagery catalogue; +https://github.com/patstallone1-prog/Spatial-data-mapping)"


class TransientError(RuntimeError):
    """The request failed in a way that may succeed later: timeout, 5xx, rate limit."""


class PermanentError(RuntimeError):
    """The request failed in a way that will not change: 404, malformed response."""


@dataclass
class HttpClient:
    """Retrying, rate-limited JSON client."""

    timeout_s: float = 30.0
    #: Minimum seconds between requests. 10/s is far below anything either provider throttles at
    #: and still finishes a corridor sweep in minutes.
    min_interval_s: float = 0.1
    max_attempts: int = 4
    #: First backoff, doubled per attempt with jitter. Jitter matters when a run resumes after an
    #: outage and would otherwise retry everything in lockstep.
    backoff_base_s: float = 1.0
    user_agent: str = USER_AGENT

    requests_made: int = field(default=0, init=False)
    retries: int = field(default=0, init=False)
    failures: list[str] = field(default_factory=list, init=False)
    _last_request_at: float = field(default=0.0, init=False)

    def _wait_turn(self) -> None:
        gap = time.monotonic() - self._last_request_at
        if gap < self.min_interval_s:
            time.sleep(self.min_interval_s - gap)
        self._last_request_at = time.monotonic()

    def get_json(self, url: str, *, params: dict[str, Any] | None = None) -> Any:
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            url = f"{url}{'&' if '?' in url else '?'}{query}"
        return self._json(url, data=None)

    def post_json(self, url: str, data: dict[str, Any]) -> Any:
        body = urllib.parse.urlencode(data).encode("utf-8")
        return self._json(url, data=body)

    def _json(self, url: str, *, data: bytes | None) -> Any:
        raw = self.fetch(url, data=data)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PermanentError(f"{url}: response was not JSON ({exc})") from exc

    def fetch(self, url: str, *, data: bytes | None = None) -> bytes:
        """Bytes from a URL, with retries. Raises Transient/PermanentError."""
        last: Exception | None = None
        for attempt in range(self.max_attempts):
            if attempt:
                self.retries += 1
                delay = self.backoff_base_s * (2 ** (attempt - 1))
                time.sleep(delay + random.uniform(0, delay * 0.25))
            self._wait_turn()
            headers = {"User-Agent": self.user_agent, "Accept": "application/json, */*"}
            if data is not None:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            request = urllib.request.Request(url, data=data, headers=headers)
            try:
                self.requests_made += 1
                with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                    return response.read()
            except urllib.error.HTTPError as exc:
                if exc.code in (400, 401, 403, 404, 410):
                    raise PermanentError(f"{url}: HTTP {exc.code}") from exc
                if exc.code == 429:
                    # Obey the server's own number when it gives one; guessing shorter is how a
                    # polite client becomes a rate-limited one.
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    try:
                        time.sleep(min(float(retry_after), 60.0)) if retry_after else None
                    except (TypeError, ValueError):
                        pass
                last = exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = exc

        self.failures.append(f"{url}: {last}")
        raise TransientError(f"{url}: {last} (after {self.max_attempts} attempts)")

    @property
    def stats(self) -> dict[str, int]:
        return {
            "requests": self.requests_made,
            "retries": self.retries,
            "failed_urls": len(self.failures),
        }
