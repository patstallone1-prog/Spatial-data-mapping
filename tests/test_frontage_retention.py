import hashlib
import json

import pytest

from smc.facades.frontage_retention import prune_finalized, prune_rejected, retained_fact
from smc.reconstruction.pixel_store import blob_key


def test_rejected_photos_removed_but_retained_shared_pixels_and_metadata_survive(tmp_path):
    review = tmp_path / "review"
    store = tmp_path / "pixel-store"
    review.mkdir()
    store.mkdir()
    rejected, shared = "a" * 64, "b" * 64
    for key, digest, status in (
        ("bad", rejected, "pixel_rejected"),
        ("blocked", shared, "pixel_rejected"),
        ("good", shared, "verified"),
    ):
        (review / f"{key}.json").write_text(
            json.dumps({"building_id": key, "pixel_sha256": digest, "status": status})
        )
        for suffix in (".jpg", ".context.jpg", ".labels.png"):
            (review / f"{key}{suffix}").write_bytes(b"photo")
        blob = store / blob_key(digest)
        blob.parent.mkdir(parents=True, exist_ok=True)
        blob.write_bytes(b"pixels")
    result = prune_rejected(tmp_path)
    assert result["files_removed"] == 7
    assert not (store / blob_key(rejected)).exists()
    assert (store / blob_key(shared)).exists()
    assert (review / "good.jpg").exists()
    assert json.loads((review / "bad.json").read_text())["local_pixels_deleted"]
    assert prune_rejected(tmp_path)["files_removed"] == 0


def test_prune_cannot_follow_symlinks_outside_scratch(tmp_path):
    (tmp_path / "review").mkdir()
    (tmp_path / "pixel-store").mkdir()
    outside = tmp_path / "source.jpg"
    outside.write_bytes(b"keep")
    (tmp_path / "review/bad.jpg").symlink_to(outside)
    (tmp_path / "review/bad.json").write_text(
        json.dumps({"building_id": "bad", "status": "pixel_rejected"})
    )
    with pytest.raises(ValueError, match="symlink"):
        prune_rejected(tmp_path)
    assert outside.read_bytes() == b"keep"


def test_only_reviewed_durably_saved_high_facts_allow_raw_removal(tmp_path):
    review = tmp_path / "review"
    review.mkdir()
    store = tmp_path / "pixel-store"
    store.mkdir()
    digest = "b" * 64
    for key in ("high", "low"):
        (review / f"{key}.json").write_text(
            json.dumps({"building_id": key, "pixel_sha256": digest, "status": "verified"})
        )
        (review / f"{key}.jpg").write_bytes(b"photo")
    blob = store / blob_key(digest)
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"shared")
    fact = tmp_path / "fact.json"
    fact.write_text(
        json.dumps(
            {
                "image_sha256": digest,
                "review_status": "reviewed_inferred_visual_parameters",
                "certainty": {"tier": "high", "keep_raw_locally": False},
            }
        )
    )
    receipt = {
        "fact_path": str(fact),
        "fact_sha256": hashlib.sha256(fact.read_bytes()).hexdigest(),
        "render_verified": True,
        "reviewer": "fixture",
    }
    assert (
        prune_finalized(tmp_path, {"high": {**receipt, "fact_sha256": "wrong"}})["files_removed"]
        == 0
    )
    assert prune_finalized(tmp_path, {"high": receipt})["files_removed"] == 1
    assert blob.exists() and (review / "low.jpg").exists() and fact.exists()
    assert json.loads((review / "high.json").read_text())["local_pixels_deleted"]


def test_finalized_facts_remain_recoverable_after_raw_deletion_and_are_hash_bound(tmp_path):
    fact = {
        "region": "sf-corridor",
        "building_id": "1",
        "image_sha256": "abc",
        "implementation_sha256": "historical-v1",
        "review_status": "reviewed_inferred_visual_parameters",
        "certainty": {"tier": "high", "keep_raw_locally": False},
    }
    path = tmp_path / "final.json"
    path.write_text(json.dumps(fact))
    row = {
        "region": "sf-corridor",
        "building_id": "1",
        "pixel_sha256": "abc",
        "local_pixels_deleted": True,
        "retention_basis": "high_reviewed_visual_facts_saved",
        "fact_receipt": {
            "fact_path": str(path),
            "fact_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "render_verified": True,
            "reviewer": "fixture",
        },
    }
    assert retained_fact(row) == fact
    path.write_text(json.dumps({**fact, "implementation_sha256": "new-v2"}))
    assert retained_fact(row) is None
