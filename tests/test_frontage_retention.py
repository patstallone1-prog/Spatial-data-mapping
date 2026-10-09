import json

import pytest

from smc.facades.frontage_retention import prune_rejected
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
