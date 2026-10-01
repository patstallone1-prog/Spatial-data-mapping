"""The floor-plan datasets: what each is, its licence, how it is obtained, and whether it is in.

A dataset that needs an agreement signed, or an account, is listed with that stated rather than
left out: knowing a source exists and what it would take is part of the record.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dataset:
    key: str
    title: str
    url: str
    license_id: str
    commercial_use: bool
    access: str          # download | agreement | account
    size_bytes: int | None
    adapter: str | None  # the module that reads it, when there is one
    notes: str = ""


DATASETS: tuple[Dataset, ...] = (
    Dataset("swiss_dwellings", "Swiss Dwellings v3.0.0 (Archilyse)",
            "https://zenodo.org/records/7788422", "CC-BY-4.0", True, "download", 931_868_205,
            "smc.interiors.swiss_dwellings",
            "45k apartments in 3,184 real multi-storey buildings: rooms, walls, windows, doors, "
            "fixtures, storeys with elevations. Local coordinates (published without positions). "
            "Areas checked against source plans (median deviation 1.2%)."),
    Dataset("resplan", "ResPlan: 17,000 residential floor plans",
            "https://github.com/m-agour/ResPlan", "CC-BY-4.0", True, "download", 100_106_537,
            "smc.interiors.resplan",
            "Single-level residential units in metres from real-estate listings; rooms by kind, "
            "walls, doors, windows, front door. Takedown process in the repository's TAKEDOWN.md."),
    Dataset("cubicasa5k", "CubiCasa5K", "https://zenodo.org/records/2613548",
            "CC-BY-NC-SA-4.0", False, "download", 5_469_500_000, None,
            "5,000 Finnish plans as images with SVG annotation, no metric scale. Non-commercial "
            "and share-alike: stripped at the commercial transition. Not downloaded: without a "
            "scale its rooms cannot be matched to a building's metres."),
    Dataset("rplan", "RPLAN", "http://staff.ustc.edu.cn/~fuxm/projects/DeepLayout/index.html",
            "research-agreement", False, "agreement", None, None,
            "80k Asian apartment plans; released on request under a research agreement."),
    Dataset("structured3d", "Structured3D", "https://structured3d-dataset.org/",
            "research-agreement", False, "agreement", None, None,
            "3.5k synthetic houses with full 3D; terms of use must be agreed before download."),
    Dataset("zind", "Zillow Indoor Dataset", "https://github.com/zillow/zind",
            "zillow-non-commercial", False, "agreement", None, None,
            "1.5k real homes with panoramas and floor plans; access by application."),
)


def by_key(key: str) -> Dataset:
    for dataset in DATASETS:
        if dataset.key == key:
            return dataset
    raise KeyError(key)
