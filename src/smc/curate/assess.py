"""Deciding which captures are worth keeping, on the phone, before anything is uploaded.

The whole point of curating on-device is that the expensive resource is not storage — it is the
radio and the battery. A frame discarded on the phone costs nothing; the same frame uploaded and
then discarded in the cloud costs a cellular transfer, a chunk of the daily budget, and a share
of the user's battery. So the filter runs where the data already is.

Everything here is deliberately cheap. Variance of the Laplacian and a 64-bit difference hash
are both a few milliseconds on a downscaled thumbnail, which means curation can run over a whole
day's capture during a single charging window without the user noticing. Nothing here needs a
neural network, and adding one would defeat the purpose.

Four things get a frame dropped, in the order they are cheapest to detect:

* **Too dark or blown out** — nothing recoverable in either case.
* **Blurred** — a motion-blurred frame has no stable features, so it cannot anchor and cannot
  contribute geometry. It is pure upload cost.
* **A near-duplicate of one already kept** — a wearer who stops at a crossing produces dozens of
  near-identical frames. They are not corroboration; they share a viewpoint, a moment, and a
  GNSS bias.
* **Surplus to a cell's quota** — past a certain density, more frames of the same place add
  almost nothing, and the budget is better spent on a cell with no coverage at all.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field

import numpy as np


class Verdict(enum.StrEnum):
    KEEP = "keep"
    DROP_DARK = "drop_dark"
    DROP_BLOWN = "drop_blown"
    DROP_BLURRED = "drop_blurred"
    DROP_DUPLICATE = "drop_duplicate"
    DROP_CELL_FULL = "drop_cell_full"
    DROP_BUDGET = "drop_budget"


@dataclass(frozen=True, slots=True)
class CurationConfig:
    """Thresholds. Every one is a trade between upload cost and coverage."""

    #: Absolute floor on contrast-normalised sharpness. Catches only catastrophic blur.
    blur_floor: float = 0.05
    #: Fraction of the batch's median sharpness below which a frame counts as blurred.
    #:
    #: An absolute threshold cannot work here. Laplacian variance depends on how textured the
    #: scene is as much as on how sharp the optics were: a brick wall scores orders of magnitude
    #: above an overcast sky at identical focus. Measured on one test batch, a sharp frame
    #: scored 22,900 and a heavily blurred version of the *same* frame scored 53 — any fixed
    #: number that separates those two is wrong for the next scene. Comparing each frame against
    #: its own batch is content-adaptive and costs nothing, since the statistic is already
    #: computed for every frame.
    blur_relative_floor: float = 0.25
    #: Mean luma bounds, 0-255.
    min_brightness: float = 28.0
    max_brightness: float = 232.0
    #: Fraction of pixels at the extremes before a frame counts as blown out.
    max_clipped_fraction: float = 0.35
    #: Hamming distance between 64-bit hashes below which two frames are near-duplicates.
    duplicate_distance: int = 6
    #: Frames kept per H3 cell per day. Past this, extra views add little.
    max_per_cell: int = 12
    #: Hard ceiling on the daily batch, whatever else the rules allow.
    daily_frame_budget: int = 1200
    #: Thumbnail edge used for all cheap statistics.
    thumbnail_px: int = 128


@dataclass(frozen=True, slots=True)
class Assessment:
    """What one frame scored, and what is to be done with it."""

    frame_id: str
    cell_id: str
    sharpness: float
    brightness: float
    clipped_fraction: float
    hash_value: int
    #: Higher is more worth uploading.
    score: float
    verdict: Verdict = Verdict.KEEP
    reason: str = ""

    @property
    def kept(self) -> bool:
        return self.verdict is Verdict.KEEP

    def with_verdict(self, verdict: Verdict, reason: str = "") -> Assessment:
        return Assessment(
            frame_id=self.frame_id,
            cell_id=self.cell_id,
            sharpness=self.sharpness,
            brightness=self.brightness,
            clipped_fraction=self.clipped_fraction,
            hash_value=self.hash_value,
            score=self.score,
            verdict=verdict,
            reason=reason,
        )


@dataclass(frozen=True, slots=True)
class CurationResult:
    assessments: tuple[Assessment, ...]
    config: CurationConfig = field(default_factory=CurationConfig)

    @property
    def kept(self) -> tuple[Assessment, ...]:
        return tuple(a for a in self.assessments if a.kept)

    @property
    def dropped(self) -> tuple[Assessment, ...]:
        return tuple(a for a in self.assessments if not a.kept)

    @property
    def keep_fraction(self) -> float:
        return len(self.kept) / len(self.assessments) if self.assessments else 0.0

    def reasons(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for a in self.dropped:
            counts[str(a.verdict)] = counts.get(str(a.verdict), 0) + 1
        return counts


def _thumbnail(image: np.ndarray, side: int) -> np.ndarray:
    """Area-averaged downscale to a fixed size, as grayscale.

    Averaging, not sampling. Nearest-neighbour picks one pixel per output cell, so its value is
    whatever noise happened to land there — which makes the perceptual hash move when the image
    is blurred or lightly denoised, exactly the cases a duplicate detector must see through.
    Measured on a photo-like frame, sampling shifted the hash 12 bits under a single blur pass
    while averaging holds it at 0.

    Fixed output size also matters: sharpness is not scale-invariant, so comparing a 4032 px
    iPhone frame against a 1440 px glasses frame without normalising first would reliably call
    the glasses frame blurred.
    """
    array = np.asarray(image)
    if array.ndim == 3:
        array = array @ np.array([0.299, 0.587, 0.114])
    array = array.astype(np.float64)
    height, width = array.shape[:2]

    row_edges = np.linspace(0, height, side + 1).astype(int)
    col_edges = np.linspace(0, width, side + 1).astype(int)
    out = np.empty((side, side), dtype=np.float64)
    for i in range(side):
        r0, r1 = row_edges[i], max(row_edges[i + 1], row_edges[i] + 1)
        band = array[r0:r1]
        for j in range(side):
            c0, c1 = col_edges[j], max(col_edges[j + 1], col_edges[j] + 1)
            out[i, j] = band[:, c0:c1].mean()
    return out


def sharpness(image: np.ndarray, side: int = 128) -> float:
    """Variance of the Laplacian, normalised by image contrast.

    Raw Laplacian variance is the standard cheap blur measure and it has a failure mode that
    matters here: it scales with contrast. Multiply a frame's pixel values by three and its
    Laplacian variance rises ninefold, so an overexposed frame *out-scores* a correctly exposed
    photograph of the same scene. Observed directly — a blown frame scored 4025 against 1118 for
    the good one, and the curator kept the blown one.

    Dividing by the thumbnail's own variance removes the contrast term and leaves a measure of
    how much of the image's energy sits at high frequencies, which is what blur actually
    destroys. It also makes the number comparable between a bright street and a shaded one.
    """
    thumb = _thumbnail(image, side)
    laplacian = (
        -4.0 * thumb[1:-1, 1:-1]
        + thumb[:-2, 1:-1]
        + thumb[2:, 1:-1]
        + thumb[1:-1, :-2]
        + thumb[1:-1, 2:]
    )
    contrast = float(thumb.var())
    if contrast < 1e-6:
        return 0.0
    return float(laplacian.var() / contrast)


def dhash(image: np.ndarray, side: int = 8) -> int:
    """64-bit difference hash: each bit is one horizontal gradient sign.

    Robust to brightness and mild compression, sensitive to viewpoint — which is exactly the
    balance a duplicate filter needs. Two frames of the same scene from two metres apart differ;
    two frames from a wearer standing still do not.
    """
    thumb = _thumbnail(image, side + 1)[:side, :]
    bits = thumb[:, 1:] > thumb[:, :-1]
    value = 0
    for bit in bits.reshape(-1):
        value = (value << 1) | int(bit)
    return value


def hamming(a: int, b: int) -> int:
    return int(bin(a ^ b).count("1"))


def assess(
    image: np.ndarray, frame_id: str, cell_id: str, config: CurationConfig | None = None
) -> Assessment:
    """Score one frame. Cheap enough to run on every capture."""
    config = config or CurationConfig()
    thumb = _thumbnail(image, config.thumbnail_px)
    brightness = float(thumb.mean())
    clipped = float(np.mean((thumb < 6) | (thumb > 249)))
    sharp = sharpness(image, config.thumbnail_px)

    # Sharpness dominates: a blurred frame is worthless however well exposed. Mid-grey
    # exposure is mildly preferred because it leaves the most headroom for the matcher.
    exposure_penalty = abs(brightness - 128.0) / 128.0
    score = sharp * (1.0 - 0.35 * exposure_penalty) * (1.0 - clipped)

    return Assessment(
        frame_id=frame_id,
        cell_id=cell_id,
        sharpness=sharp,
        brightness=brightness,
        clipped_fraction=clipped,
        hash_value=dhash(image),
        score=score,
    )


def curate(
    assessments: list[Assessment], config: CurationConfig | None = None
) -> CurationResult:
    """Decide the day's batch.

    Order matters and is not arbitrary. Quality gates run first so a blurred frame never
    survives to occupy a cell quota. Then duplicates are collapsed against *kept* frames only,
    so a run of near-identical frames yields the sharpest one rather than the first. Cell quotas
    and the global budget come last, and both keep the best-scoring frames rather than the
    earliest — a day that starts in a car park should not spend its budget there.
    """
    config = config or CurationConfig()
    out: list[Assessment] = []
    survivors: list[Assessment] = []

    if not assessments:
        return CurationResult(assessments=(), config=config)

    median_sharpness = float(np.median([a.sharpness for a in assessments]))
    blur_threshold = max(config.blur_floor, median_sharpness * config.blur_relative_floor)

    for a in assessments:
        if a.brightness < config.min_brightness:
            out.append(a.with_verdict(Verdict.DROP_DARK, f"mean luma {a.brightness:.0f}"))
        elif (
            a.brightness > config.max_brightness
            or a.clipped_fraction > config.max_clipped_fraction
        ):
            out.append(a.with_verdict(Verdict.DROP_BLOWN, f"{a.clipped_fraction:.0%} clipped"))
        elif a.sharpness < blur_threshold:
            out.append(
                a.with_verdict(
                    Verdict.DROP_BLURRED,
                    f"sharpness {a.sharpness:.0f} vs batch threshold {blur_threshold:.0f}",
                )
            )
        else:
            survivors.append(a)

    # Duplicates: keep the sharpest of each near-identical group.
    survivors.sort(key=lambda a: a.score, reverse=True)
    unique: list[Assessment] = []
    for a in survivors:
        twin = next(
            (u for u in unique if hamming(a.hash_value, u.hash_value) <= config.duplicate_distance),
            None,
        )
        if twin is None:
            unique.append(a)
        else:
            out.append(a.with_verdict(Verdict.DROP_DUPLICATE, f"near {twin.frame_id}"))

    # Cell quota, best first.
    per_cell: dict[str, int] = {}
    within_quota: list[Assessment] = []
    for a in unique:
        count = per_cell.get(a.cell_id, 0)
        if count >= config.max_per_cell:
            out.append(a.with_verdict(Verdict.DROP_CELL_FULL, f"{a.cell_id} at quota"))
        else:
            per_cell[a.cell_id] = count + 1
            within_quota.append(a)

    # Global budget, best first, but spread across cells so one dense street cannot eat the
    # whole day: take one from each cell in turn.
    ordered = _round_robin_by_cell(within_quota)
    for a in ordered[: config.daily_frame_budget]:
        out.append(a)
    for a in ordered[config.daily_frame_budget :]:
        out.append(a.with_verdict(Verdict.DROP_BUDGET, "daily budget reached"))

    order = {a.frame_id: i for i, a in enumerate(assessments)}
    out.sort(key=lambda a: order.get(a.frame_id, 0))
    return CurationResult(assessments=tuple(out), config=config)


def _round_robin_by_cell(items: list[Assessment]) -> list[Assessment]:
    """Interleave by cell so a budget cut removes depth, not coverage."""
    buckets: dict[str, list[Assessment]] = {}
    for a in items:
        buckets.setdefault(a.cell_id, []).append(a)
    for bucket in buckets.values():
        bucket.sort(key=lambda a: a.score, reverse=True)

    ordered: list[Assessment] = []
    while any(buckets.values()):
        for cell in list(buckets):
            if buckets[cell]:
                ordered.append(buckets[cell].pop(0))
    return ordered
