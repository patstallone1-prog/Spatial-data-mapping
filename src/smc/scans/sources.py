"""Where scans come from, and what each source allows done automatically.

None of the three community sources can be pulled end to end by a program: Sketchfab's search is
public but its downloads need the user's own login or token; Polycam's API is Enterprise-only and
covers only the account's own library, and Explore captures are downloaded through the app;
OpenHeritage3D sends download links by email after a form with the requester's name. So each
source has a catalogue step where one is possible, and a local import for what the user fetches.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScanSource:
    key: str
    title: str
    catalogue: str   # "public api" | "none"
    download: str    # how a file is obtained
    credential: str | None
    notes: str


SOURCES = (
    ScanSource("sketchfab", "Sketchfab (CC-licensed downloadable models)", "public api",
               "Download API: needs the user's Sketchfab token in .env.local "
               "(SKETCHFAB_API_TOKEN) or a file placed in data/scans/sketchfab/inbox/",
               "SKETCHFAB_API_TOKEN",
               "Attribution (author, model link, licence) must follow the model everywhere it "
               "is used, and the app must say downloadable models are provided by Sketchfab."),
    ScanSource("polycam", "Polycam Explore", "none",
               "Saved and exported from the Polycam app by the user into "
               "data/scans/polycam/inbox/, with a sidecar giving its licence and author",
               None,
               "No public API: the Content Management API is Enterprise-only and covers the "
               "account's own captures. Not scraped."),
    ScanSource("openheritage3d", "OpenHeritage3D / CyArk", "none",
               "Requested through openheritage3d.org (download links are emailed after a form "
               "with the requester's name); placed in data/scans/openheritage3d/inbox/",
               None,
               "About 25 GB a site; licences per dataset, mostly non-commercial; the FAQ says "
               "data is often not georeferenced -- so georeferencing is checked per dataset, "
               "not assumed."),
    ScanSource("usgs_3dep", "USGS 3DEP lidar", "public api", "already read by smc.lidar.ept",
               None, "The reference the aligner scores scans against (§A5), not a scan source."),
)

#: Sketchfab licence labels to identifiers, and which may be used. No-Derivatives licences are
#: refused: blending a scan into the world (§A6) is a derivative. Store licences are not
#: Creative Commons at all.
LICENCES = {
    "CC Attribution": ("CC-BY-4.0", True, True),
    "CC Attribution-ShareAlike": ("CC-BY-SA-4.0", True, True),
    "CC0 Public Domain": ("CC0-1.0", True, True),
    "CC Attribution-NonCommercial": ("CC-BY-NC-4.0", True, False),
    "CC Attribution-NonCommercial-ShareAlike": ("CC-BY-NC-SA-4.0", True, False),
    "CC Attribution-NoDerivs": ("CC-BY-ND-4.0", False, True),
    "CC Attribution-NonCommercial-NoDerivs": ("CC-BY-NC-ND-4.0", False, False),
}


def licence(label: str | None) -> tuple[str, bool, bool, str]:
    """(identifier, usable, commercial_use, reason) for a licence label."""
    if label in LICENCES:
        ident, usable, commercial = LICENCES[label]
        reason = "" if usable else "no-derivatives licence: blending it in would be a derivative"
        return ident, usable, commercial, reason
    return (label or "unknown"), False, False, "not a Creative Commons licence"
