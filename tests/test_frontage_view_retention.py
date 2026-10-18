"""Pictures go once the matcher has passed their house; records and needed pictures stay."""
import hashlib
import json

from smc.facades.frontage_retention import prune_settled_views, still_needed
from smc.reconstruction.pixel_store import blob_key

SCREENED = "screened_candidate_needs_privacy_and_identity_review"


def make_run(tmp_path):
    live, match = tmp_path / "live", tmp_path / "match"
    (live / "review").mkdir(parents=True)
    (match / "views" / "r").mkdir(parents=True)

    def photo(key, building, status, digest, rank=(1, 1.0)):
        row = {"region": "r", "building_id": building, "status": status, "pixel_sha256": digest,
               "candidate": {"rank": list(rank)}}
        (live / "review" / f"{key}.json").write_text(json.dumps(row))
        for suffix in (".jpg", ".labels.png", ".context.jpg"):
            (live / "review" / f"{key}{suffix}").write_bytes(key.encode() + suffix.encode())
        folder = match / "views" / "r" / building
        folder.mkdir(exist_ok=True)
        (folder / "manifest.json").write_text("{}")
        (folder / f"{key}.jpg").write_bytes(b"view")
        blob = live / "pixel-store" / blob_key(digest)
        blob.parent.mkdir(parents=True, exist_ok=True)
        blob.write_bytes(b"frame")

    def decide(building, bucket, digest, rank=(1, 1.0)):
        (match / bucket / "r").mkdir(parents=True, exist_ok=True)
        (match / bucket / "r" / f"{building}.json").write_text(json.dumps(
            {"building_id": building, "fit_rank": list(rank), "image_sha256": digest}))
    return live, match, photo, decide


def test_settled_and_rejected_pictures_go_and_waiting_ones_stay(tmp_path):
    live, match, photo, decide = make_run(tmp_path)
    a, b, c, d = ("a" * 64, "b" * 64, "c" * 64, "d" * 64)
    photo("r-1-x", "1", SCREENED, a)            # decided on this photo: goes
    photo("r-2-x", "2", SCREENED, b)            # undecided: stays
    photo("r-3-x", "3", "pixel_rejected", c)    # rejected by the filter: goes
    photo("r-4-x", "4", SCREENED, d, rank=(2, 1.0))  # ranks above its decision: stays
    decide("1", "rejected", a)
    decide("4", "houses", "e" * 64, rank=(1, 1.0))
    # The materials worker has read house 4's picture, so only the matcher holds it.
    journal = match / "materials-journal.jsonl"
    journal.write_text(json.dumps({"image": hashlib.sha256(b"r-4-x.jpg").hexdigest()}) + "\n")
    report = prune_settled_views(live, match)
    review = live / "review"
    assert not (review / "r-1-x.jpg").exists() and not (match / "views/r/1/r-1-x.jpg").exists()
    assert not (live / "pixel-store" / blob_key(a)).exists()
    assert not (review / "r-3-x.labels.png").exists() and not (live / "pixel-store" / blob_key(c)).exists()
    assert (review / "r-2-x.jpg").exists() and (live / "pixel-store" / blob_key(b)).exists()
    assert (review / "r-4-x.jpg").exists()
    # Every record and manifest is kept, unchanged.
    assert json.loads((review / "r-1-x.json").read_text())["status"] == SCREENED
    assert (match / "views/r/1/manifest.json").exists()
    assert report["photos_kept_for_matcher"] == 2


def test_an_accepted_house_keeps_its_picture_until_materials_has_read_it(tmp_path):
    live, match, photo, decide = make_run(tmp_path)
    photo("r-5-x", "5", SCREENED, "f" * 64)
    decide("5", "houses", "f" * 64)
    prune_settled_views(live, match)
    assert (live / "review" / "r-5-x.jpg").exists()
    (match / "materials-journal.jsonl").write_text(
        json.dumps({"image": hashlib.sha256(b"r-5-x.jpg").hexdigest()}) + "\n")
    prune_settled_views(live, match)
    assert not (live / "review" / "r-5-x.jpg").exists()


def test_still_needed_is_the_matchers_own_test():
    settled = {("r", "1"): {"fit_rank": [1, 1.0], "image_sha256": "x"}}
    row = {"region": "r", "building_id": "1", "status": SCREENED, "pixel_sha256": "y",
           "candidate": {"rank": [1, 0.5]}}
    assert not still_needed(row, settled)
    row["candidate"]["rank"] = [2, 0.0]
    assert still_needed(row, settled)
    assert still_needed({**row, "building_id": "9"}, settled)
    assert not still_needed({**row, "status": "pixel_rejected", "building_id": "9"}, settled)
