"""Sketchfab: catalogue downloadable, openly licensed models that name a place we map.

The search API is public; nothing is downloaded without the user's own token
(``SKETCHFAB_API_TOKEN`` in ``.env.local``). Sketchfab carries no coordinates, so a catalogued
model is a *candidate* for a region, never a placement: it stays unplaced until the aligner
(docs/24 §A5) fits it to the lidar or rejects it.
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from smc.scans.sources import licence

API = "https://api.sketchfab.com/v3"
#: Categories that are never a place: filtered at the catalogue, before any download.
NOT_PLACES = {"animals-pets", "characters-creatures", "weapons-military", "fashion-style",
              "food-drink", "music", "electronics-gadgets", "sports-fitness", "people",
              "cars-vehicles", "furniture-home", "science-technology"}
MAX_PAGES = 8


@dataclass
class Candidate:
    uid: str
    name: str
    author: str
    author_url: str
    viewer_url: str
    licence_label: str | None
    licence_id: str
    usable: bool
    commercial_use: bool
    face_count: int
    archives: dict
    tags: list[str]
    categories: list[str]
    published: str
    description: str = ""
    queries: list[str] = field(default_factory=list)
    refused: str = ""

    def attribution(self) -> str:
        return (f'"{self.name}" by {self.author} ({self.viewer_url}), {self.licence_id}; '
                "provided by Sketchfab")

    def to_json(self) -> dict:
        out = {k: v for k, v in self.__dict__.items() if k != "description"}
        out["attribution"] = self.attribution()
        return out


def _get(url: str, token: str | None = None, attempts: int = 4) -> dict:
    headers = {"User-Agent": "kerbside-scan-catalogue/1"}
    if token:
        headers["Authorization"] = f"Token {token}"
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                        timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as err:
            if err.code == 429 or err.code >= 500:
                time.sleep(2 ** attempt * 3)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** attempt * 3)
    raise RuntimeError(f"Sketchfab unreachable after {attempts} attempts")


def candidate(result: dict) -> Candidate:
    label = (result.get("license") or {}).get("label")
    ident, usable, commercial, reason = licence(label)
    categories = [c.get("slug") or c.get("name", "") for c in result.get("categories") or []]
    user = result.get("user") or {}
    refused = reason
    if not refused and set(categories) & NOT_PLACES:
        refused = "category is not a place: " + ", ".join(sorted(set(categories) & NOT_PLACES))
    archives = {kind: {"size": (spec or {}).get("size"), "faces": (spec or {}).get("faceCount")}
                for kind, spec in (result.get("archives") or {}).items() if spec}
    return Candidate(
        uid=result["uid"], name=result.get("name", ""),
        author=user.get("displayName") or user.get("username") or "unknown",
        author_url=user.get("profileUrl", ""), viewer_url=result.get("viewerUrl", ""),
        licence_label=label, licence_id=ident, usable=usable and not refused,
        commercial_use=commercial, face_count=int(result.get("faceCount") or 0),
        archives=archives, tags=[t.get("slug", "") for t in result.get("tags") or []],
        categories=categories, published=result.get("publishedAt", ""),
        description=(result.get("description") or "")[:500], refused=refused)


def names_place(item: Candidate, place: str) -> bool:
    """The place is named as a phrase in the title, tags or description. Search matches single
    words anywhere ("Berkeley Pl", "San José, Costa Rica" for San Jose), so this is the first,
    textual, filter; the aligner is the second and the one that decides."""
    import re

    pattern = re.compile(r"\b" + re.escape(place.lower()) + r"\b")
    text = " ".join([item.name, " ".join(item.tags).replace("-", " "), item.description]).lower()
    return bool(pattern.search(text))


def search(query: str, max_pages: int = MAX_PAGES, pause_s: float = 1.0) -> list[Candidate]:
    params = urllib.parse.urlencode({"type": "models", "q": query, "downloadable": "true",
                                     "count": 24})
    url: str | None = f"{API}/search?{params}"
    found: list[Candidate] = []
    for _ in range(max_pages):
        if not url:
            break
        page = _get(url)
        for result in page.get("results", []):
            item = candidate(result)
            item.queries.append(query)
            found.append(item)
        url = page.get("next")
        time.sleep(pause_s)
    return found


def region_queries(region: dict) -> list[str]:
    """Search terms for a region: its city and the named district in its description."""
    city = region.get("city", "").replace("-", " ").title()
    district = (region.get("description") or "").split(":")[0].strip()
    terms = [city] if city else []
    if district and district.lower() not in city.lower():
        terms.append(f"{district} {city}".strip())
    for extra in region.get("scan_queries", []):
        terms.append(extra)
    return terms


def download_url(uid: str, token: str) -> dict:
    """The signed archive links (valid for minutes) for one model, with the user's token."""
    return _get(f"{API}/models/{uid}/download", token=token)


def token() -> str | None:
    return os.environ.get("SKETCHFAB_API_TOKEN") or None
