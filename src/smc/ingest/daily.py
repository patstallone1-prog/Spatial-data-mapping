"""The nightly batch, fully implemented.

Assess, delete rejects immediately, compress what survives, send once, delete only what was
acknowledged. Runs the same code the phone would; the only platform-specific piece is what
wakes it up at 02:00.

Two ordering decisions carry the design:

**Rejects are deleted the moment they are judged, not at send time.** A wearer fills a phone in
an afternoon, and holding frames already known to be worthless until 2am is the difference
between a full disk and a working one.

**Deletion keys on server acknowledgement, never on "upload returned".** The journal is the only
copy of a capture until the far end confirms it. The gap between "the request completed" and
"the server has it" is precisely where data is lost for good.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import numpy as np

from smc.curate.assess import Assessment, CurationConfig, assess, curate
from smc.curate.compress import CompressionProfile, ImageFormat
from smc.curate.people import PeopleConfig, assess_people
from smc.ingest.destinations import Destination
from smc.ingest.journal import EntryState, LocalPhotoJournal, mark

#: Pillow format names for each target.
_PIL_FORMAT = {ImageFormat.AVIF: "AVIF", ImageFormat.HEIC: "HEIF", ImageFormat.JPEG: "JPEG"}


@dataclass(frozen=True, slots=True)
class BatchPolicy:
    hour_of_day: int = 2
    max_batch_megabytes: float = 250.0
    max_journal_age_days: int = 7
    require_unmetered: bool = True
    require_charging: bool = True
    compression: CompressionProfile = field(default_factory=CompressionProfile)
    curation: CurationConfig = field(default_factory=CurationConfig)
    people: PeopleConfig = field(default_factory=PeopleConfig)
    #: Run the people filter. Slower than the other gates, so it runs last, on survivors only.
    privacy_filter: bool = True


@dataclass(frozen=True, slots=True)
class BatchReport:
    assessed: int = 0
    dropped_quality: int = 0
    dropped_privacy: int = 0
    compressed: int = 0
    sent: int = 0
    acknowledged: int = 0
    deleted: int = 0
    bytes_sent: int = 0
    bytes_reclaimed: int = 0
    carried_over: int = 0
    reasons: dict[str, int] = field(default_factory=dict)
    deferred: bool = False
    message: str = ""

    @property
    def keep_rate(self) -> float:
        kept = self.assessed - self.dropped_quality - self.dropped_privacy
        return kept / self.assessed if self.assessed else 0.0

    def describe(self) -> str:
        if self.deferred:
            return f"deferred: {self.message}"
        lines = [
            f"assessed {self.assessed}, kept {self.keep_rate:.0%} "
            f"({self.dropped_quality} on quality, {self.dropped_privacy} on privacy)",
            f"compressed {self.compressed}, sent {self.sent}, acknowledged {self.acknowledged}",
            f"{self.bytes_sent / 1e6:.1f} MB sent, "
            f"{self.bytes_reclaimed / 1e6:.1f} MB reclaimed, {self.deleted} deleted",
        ]
        if self.carried_over:
            lines.append(f"{self.carried_over} carried to tomorrow")
        if self.reasons:
            ordered = sorted(self.reasons.items(), key=lambda kv: -kv[1])
            lines.append("  " + ", ".join(f"{k} {v}" for k, v in ordered))
        return "\n".join(lines)


def next_window(now: datetime, policy: BatchPolicy | None = None) -> datetime:
    """The next scheduled run after ``now``, in **local** time.

    The hour is local by definition: 02:00 is chosen because it is when a phone is usually
    charging, on Wi-Fi, and not in use, and none of that is true of 02:00 UTC somewhere else.
    Computing it in UTC put the window at 19:00 local — the middle of the evening, on cellular,
    in the user's hand, which is exactly what batching exists to avoid.
    """
    policy = policy or BatchPolicy()
    local = now.astimezone()
    target = local.replace(hour=policy.hour_of_day, minute=0, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return target


def encode(image: np.ndarray, profile: CompressionProfile) -> tuple[bytes, str]:
    """Re-encode through Pillow, falling back if a format is unavailable.

    On a phone this is the hardware encoder; the policy is identical and only the call differs.
    Metadata is stripped: EXIF carries location, device identifiers and timestamps that have no
    business leaving the device, and orientation is already baked into the pixels by the loader.
    """
    from PIL import Image

    pil = Image.fromarray(np.asarray(image, dtype=np.uint8))
    longest = max(pil.width, pil.height)
    if longest > profile.max_edge_px:
        scale = profile.max_edge_px / longest
        pil = pil.resize((round(pil.width * scale), round(pil.height * scale)), Image.LANCZOS)

    for target in (profile.format, profile.fallback, ImageFormat.JPEG):
        buffer = io.BytesIO()
        try:
            if target is ImageFormat.HEIC:
                import pillow_heif

                pillow_heif.register_heif_opener()
            pil.save(buffer, _PIL_FORMAT[target], quality=profile.quality)
        except Exception:
            continue
        return buffer.getvalue(), str(target)
    raise RuntimeError("no image format could be encoded")


def decode(payload: bytes) -> np.ndarray:
    import pillow_heif
    from PIL import Image

    pillow_heif.register_heif_opener()
    return np.asarray(Image.open(io.BytesIO(payload)).convert("RGB"))


def run_batch(
    journal: LocalPhotoJournal,
    destination: Destination,
    *,
    policy: BatchPolicy | None = None,
    now: datetime | None = None,
    charging: bool = True,
    unmetered: bool = True,
) -> BatchReport:
    """Run one night's batch."""
    policy = policy or BatchPolicy()
    now = now or datetime.now(UTC)

    if (policy.require_charging and not charging) or (policy.require_unmetered and not unmetered):
        return BatchReport(deferred=True, message="waiting for charger and unmetered connection")

    # Clear anything a previous run judged but did not get to delete. A crash between marking
    # and purging leaves rejects on disk forever otherwise, and they are the frames most
    # obviously not worth the space.
    orphaned = [e.frame_id for e in journal.entries(EntryState.REJECTED)]
    journal.purge(orphaned)

    # Expire next, so stale frames consume neither the assessment pass nor the batch budget.
    # Measured from when the frame entered the journal, not when the photograph was taken.
    cutoff = now - timedelta(days=policy.max_journal_age_days)
    stale = [e.frame_id for e in journal.entries() if e.journaled_at < cutoff]
    bytes_before = journal.total_bytes()
    journal.purge(stale)

    captured = journal.entries(EntryState.CAPTURED)
    if not captured:
        return BatchReport(
            deleted=len(stale),
            bytes_reclaimed=bytes_before - journal.total_bytes(),
            message="nothing new to send",
        )

    # 1. Cheap quality gates over the whole batch.
    assessments = []
    images: dict[str, np.ndarray] = {}
    for entry in captured:
        image = decode(journal.read(entry.frame_id))
        images[entry.frame_id] = image
        assessments.append(assess(image, entry.frame_id, entry.cell_id, policy.curation))
    result = curate(assessments, policy.curation)

    by_id = {e.frame_id: e for e in captured}
    reasons: dict[str, int] = dict(result.reasons())
    rejected: list[str] = []

    for a in result.dropped:
        entry = by_id[a.frame_id]
        journal.update(mark(entry, EntryState.REJECTED, verdict=str(a.verdict), reason=a.reason))
        rejected.append(a.frame_id)
    dropped_quality = len(rejected)

    # 2. Privacy filter, on survivors only — it is the expensive gate and there is no point
    #    running a person detector over frames already discarded for blur.
    dropped_privacy = 0
    kept: list[Assessment] = []
    for a in result.kept:
        entry = by_id[a.frame_id]
        if policy.privacy_filter:
            people = assess_people(images[a.frame_id], policy.people)
            if people.is_subject:
                journal.update(
                    mark(entry, EntryState.REJECTED, verdict="drop_person_subject",
                         reason=people.reason, flags=people.flags)
                )
                rejected.append(a.frame_id)
                dropped_privacy += 1
                reasons["drop_person_subject"] = reasons.get("drop_person_subject", 0) + 1
                continue
        kept.append(a)
        journal.update(
            mark(entry, EntryState.KEPT, sharpness=a.sharpness, perceptual_hash=a.hash_value)
        )

    journal.purge(rejected)

    # 3. Compress survivors.
    compressed = 0
    for a in kept:
        entry = journal.get(a.frame_id)
        payload, _ = encode(images[a.frame_id], policy.compression)
        journal.replace_payload(entry.frame_id, payload)
        journal.update(mark(entry, EntryState.COMPRESSED, compressed_bytes=len(payload)))
        compressed += 1

    # 4. Send newest first — fresh coverage beats a backlog.
    budget = int(policy.max_batch_megabytes * 1e6)
    sent = acknowledged = bytes_sent = 0
    ready = sorted(
        journal.entries(EntryState.COMPRESSED), key=lambda e: e.captured_at, reverse=True
    )
    for entry in ready:
        size = entry.bytes_on_disk
        if bytes_sent + size > budget:
            break
        sent += 1
        if destination.send(entry, journal.read(entry.frame_id)):
            journal.update(mark(entry, EntryState.ACKNOWLEDGED))
            acknowledged += 1
            bytes_sent += size
        else:
            journal.update(mark(entry, EntryState.COMPRESSED, attempts=entry.attempts + 1))

    # 5. Delete only the acknowledged.
    acked_ids = [e.frame_id for e in journal.entries(EntryState.ACKNOWLEDGED)]
    before = journal.total_bytes()
    deleted = journal.purge(acked_ids)
    reclaimed = (
        (bytes_before - journal.total_bytes())
        if stale
        else (before - journal.total_bytes())
    )

    carried = journal.count(EntryState.COMPRESSED)
    return BatchReport(
        assessed=len(captured),
        dropped_quality=dropped_quality,
        dropped_privacy=dropped_privacy,
        compressed=compressed,
        sent=sent,
        acknowledged=acknowledged,
        deleted=deleted + len(stale),
        bytes_sent=bytes_sent,
        bytes_reclaimed=reclaimed,
        carried_over=carried,
        reasons=reasons,
        message="batch complete" if carried == 0 else f"{carried} carried over",
    )
