"""Delete rejected scratch pixels, never source catalogues or shared retained evidence."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from smc.reconstruction.pixel_store import blob_key


def prune_finalized(root: Path, receipts: dict[str, dict]) -> dict:
    """Keep facts/provenance; discard high-certainty pixels only after durable review.

    Receipts bind source pixels to an existing saved fact artifact's exact bytes.
    Any shared unresolved image protects the canonical blob. No acquisition,
    flight, alias, source catalogue or fact file is deleted by this operation.
    """
    root = root.resolve()
    if root == root.parent or not (root / "review").is_dir() or not (root / "pixel-store").is_dir():
        raise ValueError("explicit frontage scratch root required")
    reports = []
    eligible = set()
    for path in sorted((root / "review").glob("*.json")):
        row = json.loads(path.read_text())
        if not isinstance(row, dict) or not row.get("building_id"):
            continue
        reports.append((path, row))
        receipt = receipts.get(path.stem, {})
        artifact = Path(receipt.get("fact_path", ""))
        if not artifact.is_absolute() or artifact.is_symlink() or not artifact.is_file():
            continue
        raw = artifact.read_bytes()
        if hashlib.sha256(raw).hexdigest() != receipt.get("fact_sha256"):
            continue
        fact = json.loads(raw)
        if (
            fact.get("image_sha256") != row.get("pixel_sha256")
            or fact.get("review_status") != "reviewed_inferred_visual_parameters"
            or fact.get("certainty", {}).get("tier") != "high"
            or not receipt.get("render_verified")
            or not receipt.get("reviewer")
            or fact.get("certainty", {}).get("keep_raw_locally") is not False
        ):
            continue
        eligible.add(path.stem)
    protected = {
        row.get("pixel_sha256")
        for path, row in reports
        if path.stem not in eligible and row.get("status") != "pixel_rejected"
    }
    removed = []
    size = 0
    for path, row in reports:
        if path.stem not in eligible:
            continue
        targets = [path.with_suffix(s) for s in (".jpg", ".context.jpg", ".labels.png")]
        digest = row.get("pixel_sha256", "")
        if re.fullmatch(r"[a-f0-9]{64}", digest) and digest not in protected:
            targets.append(root / "pixel-store" / blob_key(digest))
        # Resolve/check the complete target set before removing any files.
        if any(t.is_symlink() or not t.resolve().is_relative_to(root) for t in targets):
            raise ValueError("unsafe finalized retention target")
        for target in targets:
            if target.is_file():
                size += target.stat().st_size
                target.unlink()
                removed.append(str(target.relative_to(root)))
        row.update(
            local_pixels_deleted=True,
            retention_basis="high_reviewed_visual_facts_saved",
            fact_receipt=receipts[path.stem],
            pixel_blob_retained_for_other_candidate=digest in protected,
        )
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(row, indent=2))
        temporary.replace(path)
    return {
        "files_removed": len(removed),
        "bytes_removed": size,
        "removed": removed,
        "source_catalogues_and_flights_untouched": True,
        "unresolved_blobs_protected": len(protected),
    }


def retained_fact(row: dict) -> dict | None:
    """Recover saved facts after raw deletion, only via an exact-byte receipt."""
    if (
        not row.get("local_pixels_deleted")
        or row.get("retention_basis") != "high_reviewed_visual_facts_saved"
    ):
        return None
    receipt = row.get("fact_receipt", {})
    path = Path(receipt.get("fact_path", ""))
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        return None
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != receipt.get("fact_sha256"):
        return None
    fact = json.loads(raw)
    if (
        fact.get("image_sha256") != row.get("pixel_sha256")
        or str(fact.get("building_id")) != str(row.get("building_id"))
        or fact.get("region") != row.get("region")
        or fact.get("review_status") != "reviewed_inferred_visual_parameters"
        or fact.get("certainty", {}).get("tier") != "high"
        or fact.get("certainty", {}).get("keep_raw_locally") is not False
        or not receipt.get("render_verified")
        or not receipt.get("reviewer")
    ):
        return None
    return fact


def prune_rejected(root: Path) -> dict:
    root = root.resolve()
    review = root / "review"
    store = root / "pixel-store"
    if not review.is_dir() or not store.is_dir() or root == root.parent:
        raise ValueError("expected an explicit frontage scratch output with review and pixel-store")
    reports = []
    for path in sorted(review.glob("*.json")):
        row = json.loads(path.read_text())
        if isinstance(row, dict) and row.get("building_id"):
            reports.append((path, row))
    protected = {
        row.get("pixel_sha256") for _, row in reports if row.get("status") != "pixel_rejected"
    }
    deleted, bytes_removed = [], 0
    for path, row in reports:
        if row.get("status") != "pixel_rejected":
            continue
        digest = row.get("pixel_sha256", "")
        targets = [path.with_suffix(suffix) for suffix in (".jpg", ".context.jpg", ".labels.png")]
        if re.fullmatch(r"[a-f0-9]{64}", digest) and digest not in protected:
            targets.append(store / blob_key(digest))
        for target in targets:
            # Symlinks are not followed; no report-controlled pathname is trusted.
            if target.is_symlink():
                raise ValueError("unexpected symlink in scratch retention target")
            if target.is_file():
                if not target.resolve().is_relative_to(root):
                    raise ValueError("scratch retention escaped output")
                bytes_removed += target.stat().st_size
                target.unlink()
                deleted.append(str(target.relative_to(root)))
        row["local_pixels_deleted"] = True
        row["pixel_blob_retained_for_other_candidate"] = digest in protected
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(row, default=str, indent=2))
        temporary.replace(path)
    return {
        "root": str(root),
        "files_removed": len(deleted),
        "bytes_removed": bytes_removed,
        "removed": deleted,
        "source_catalogues_untouched": True,
    }


SCREENED_FOR_FIT = {"verified", "screened_candidate_needs_privacy_and_identity_review",
                    "screened_candidate_needs_pose_review"}
IMAGE_SUFFIXES = (".jpg", ".labels.png", ".context.jpg")


def settled_houses(match_root: Path) -> dict[tuple[str, str], dict]:
    """The houses the matcher has decided (``houses/`` or ``rejected/``), by (region, id)."""
    settled = {}
    for bucket in ("houses", "rejected"):
        for path in (match_root / bucket).glob("*/*.json"):
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if isinstance(record, dict) and record.get("building_id") and record.get("fit_rank") is not None:
                settled[(path.parent.name, str(record["building_id"]))] = {**record, "_bucket": bucket}
    return settled


def materials_read(match_root: Path) -> set[str]:
    """The pictures the materials worker has already read (its journal, by the jpg's sha256)."""
    read = set()
    try:
        with (match_root / "materials-journal.jsonl").open() as journal:
            for line in journal:
                try:
                    read.add(json.loads(line)["image"])
                except (ValueError, KeyError, TypeError):
                    continue
    except OSError:
        pass
    return read


def still_needed(row: dict, settled: dict) -> bool:
    """A screened photograph the matcher will still use: its house is undecided, or it ranks
    above the photograph the house was decided on (the matcher's own test)."""
    if row.get("status") not in SCREENED_FOR_FIT:
        return False
    done = settled.get((row.get("region"), str(row.get("building_id"))))
    if done is None:
        return True
    rank = (row.get("candidate") or {}).get("rank")
    return (rank is not None and row.get("pixel_sha256") != done.get("image_sha256")
            and list(rank) > list(done["fit_rank"]))


def prune_settled_views(live_root: Path, match_root: Path, *, dry_run: bool = False) -> dict:
    """Delete the pictures of every house the matcher has moved past, and every full frame no
    photograph still waiting on the matcher shares; never a record. An accepted house's pictures
    wait until the materials worker has read them (classify_scanned_materials.py).

    Each review row, view manifest, alias and decision stays, with its provider's image id, so
    any of it can be fetched again (scripts/rehydrate_house_views.py). Rows are not rewritten:
    a missing picture is what the matcher already treats as "nothing new for this house".
    """
    live_root, match_root = live_root.resolve(), match_root.resolve()
    review, store, views = live_root / "review", live_root / "pixel-store", match_root / "views"
    if not review.is_dir() or not views.is_dir() or live_root == live_root.parent:
        raise ValueError("expected the frontage run's review folder and view store")
    settled = settled_houses(match_root)
    rows = []
    for path in review.glob("*.json"):
        try:
            row = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(row, dict) and row.get("building_id"):
            rows.append((path, row))
    read = materials_read(match_root)

    def unread_by_materials(path: Path, row: dict) -> bool:
        done = settled.get((row.get("region"), str(row.get("building_id"))))
        photo, labels = path.with_suffix(".jpg"), path.with_suffix(".labels.png")
        if not done or done["_bucket"] != "houses" or not photo.is_file() or not labels.is_file():
            return False
        return hashlib.sha256(photo.read_bytes()).hexdigest() not in read

    keep = {path.stem for path, row in rows if still_needed(row, settled)
            or row.get("status") in {"awaiting_review", "not_downloaded"}
            or (row.get("status") in SCREENED_FOR_FIT and unread_by_materials(path, row))}
    protected = {row.get("pixel_sha256") for path, row in rows if path.stem in keep}
    removed, size = 0, 0

    def drop(target: Path) -> None:
        nonlocal removed, size
        if target.is_symlink():
            raise ValueError("unexpected symlink in retention target")
        if target.is_file():
            if not (target.resolve().is_relative_to(live_root) or target.resolve().is_relative_to(match_root)):
                raise ValueError("retention escaped the run")
            size += target.stat().st_size
            removed += 1
            if not dry_run:
                target.unlink()

    for path, row in rows:
        if path.stem in keep:
            continue
        for suffix in IMAGE_SUFFIXES:
            drop(path.with_suffix(suffix))
            drop(views / str(row.get("region")) / str(row["building_id"]) / f"{path.stem}{suffix}")
        digest = row.get("pixel_sha256", "")
        if store.is_dir() and re.fullmatch(r"[a-f0-9]{64}", digest) and digest not in protected:
            drop(store / blob_key(digest))
    return {"files_removed": removed, "bytes_removed": size, "photos_kept_for_matcher": len(keep),
            "houses_settled": len(settled), "records_untouched": True, "dry_run": dry_run}
