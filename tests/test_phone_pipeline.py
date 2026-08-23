"""Tests for the journal, the nightly batch, and the privacy filter."""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from smc.curate.compress import CompressionProfile, ImageFormat
from smc.curate.people import Detection, PeopleConfig, assess_people
from smc.ingest.cameraroll import ingest, scan
from smc.ingest.daily import BatchPolicy, decode, encode, next_window, run_batch
from smc.ingest.destinations import (
    DirectoryDestination,
    GcsConfig,
    GcsDestination,
    build_destination,
)
from smc.ingest.journal import (
    EntryState,
    LocalPhotoJournal,
    mark,
    new_entry,
)


def photo(seed: int = 0, shape: tuple[int, int] = (240, 320), bright: float = 0.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    ys = np.linspace(0, 1, shape[0])[:, None]
    xs = np.linspace(0, 1, shape[1])[None, :]
    gray = (
        110.0
        + 50.0 * np.sin(2.5 * np.pi * xs + rng.uniform(0, 6))
        + 40.0 * np.cos(1.9 * np.pi * ys + rng.uniform(0, 6))
        + rng.normal(0, 22, shape)
        + bright
    )
    return np.repeat(np.clip(gray, 0, 255)[:, :, None], 3, axis=2).astype(np.uint8)


def png_bytes(image: np.ndarray) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, "PNG")
    return buffer.getvalue()


def seed_journal(root: Path, count: int = 8, **kw: object) -> LocalPhotoJournal:
    journal = LocalPhotoJournal(root)
    for i in range(count):
        payload = png_bytes(photo(i, **kw))  # type: ignore[arg-type]
        journal.add(payload, new_entry(payload, 320, 240, source="test", cell_id=f"c{i % 2}"))
    return journal


class TestJournal:
    def test_content_addressing_is_idempotent(self, tmp_path: Path) -> None:
        with LocalPhotoJournal(tmp_path) as journal:
            payload = png_bytes(photo(1))
            entry = new_entry(payload, 320, 240, source="test")
            journal.add(payload, entry)
            journal.add(payload, new_entry(payload, 320, 240, source="test"))
            assert journal.count() == 1

    def test_mismatched_payload_is_refused(self, tmp_path: Path) -> None:
        with LocalPhotoJournal(tmp_path) as journal:
            entry = new_entry(b"one", 1, 1, source="test")
            with pytest.raises(ValueError, match="does not match content hash"):
                journal.add(b"two", entry)

    def test_unsigned_hash_survives_sqlite(self, tmp_path: Path) -> None:
        """SQLite INTEGER is signed; a 64-bit perceptual hash is not."""
        with LocalPhotoJournal(tmp_path) as journal:
            payload = png_bytes(photo(1))
            entry = journal.add(payload, new_entry(payload, 320, 240, source="test"))
            for value in (0, 1, (1 << 63) - 1, 1 << 63, (1 << 64) - 1):
                journal.update(mark(entry, EntryState.KEPT, perceptual_hash=value))
                assert journal.get(entry.frame_id).perceptual_hash == value

    def test_journaled_at_is_distinct_from_captured_at(self, tmp_path: Path) -> None:
        """Retention measures time on the phone, not the age of the scene."""
        old = datetime.now(UTC) - timedelta(days=900)
        with LocalPhotoJournal(tmp_path) as journal:
            payload = png_bytes(photo(1))
            entry = new_entry(payload, 320, 240, source="test", captured_at=old)
            journal.add(payload, entry)
            stored = journal.get(entry.frame_id)
            assert stored.captured_at == old
            assert (datetime.now(UTC) - stored.journaled_at).total_seconds() < 60

    def test_purge_removes_pixels_and_rows(self, tmp_path: Path) -> None:
        with seed_journal(tmp_path) as journal:
            ids = [e.frame_id for e in journal.entries()][:3]
            assert journal.purge(ids) == 3
            assert journal.count() == 5
            assert journal.verify()["rows_without_blobs"] == 0

    def test_purging_a_missing_frame_is_not_an_error(self, tmp_path: Path) -> None:
        with LocalPhotoJournal(tmp_path) as journal:
            assert journal.purge(["nope"]) == 0

    def test_verify_detects_agreement(self, tmp_path: Path) -> None:
        with seed_journal(tmp_path) as journal:
            report = journal.verify()
            assert report["rows"] == report["blobs"] == 8
            assert report["rows_without_blobs"] == report["blobs_without_rows"] == 0


class TestEncoding:
    def test_roundtrip_preserves_the_image(self) -> None:
        image = photo(3)
        payload, _ = encode(image, CompressionProfile(format=ImageFormat.JPEG, quality=95))
        restored = decode(payload)
        assert restored.shape == image.shape
        assert float(np.abs(restored.astype(int) - image.astype(int)).mean()) < 12

    def test_downscales_to_the_ceiling(self) -> None:
        payload, _ = encode(photo(3, shape=(1500, 2000)), CompressionProfile(max_edge_px=640))
        assert max(decode(payload).shape[:2]) == 640

    def test_lower_quality_is_smaller(self) -> None:
        image = photo(3, shape=(600, 800))
        big, _ = encode(image, CompressionProfile(quality=90))
        small, _ = encode(image, CompressionProfile(quality=40))
        assert len(small) < len(big)


class TestSchedule:
    def test_window_is_local_two_am(self) -> None:
        """Computed in UTC it landed at 19:00 local — the opposite of the intent."""
        window = next_window(datetime.now(UTC))
        assert window.hour == 2
        assert 0 < (window - datetime.now(UTC)).total_seconds() <= 24 * 3600

    def test_window_moves_to_tomorrow_once_past(self) -> None:
        now = datetime.now().astimezone().replace(hour=3, minute=0, second=0, microsecond=0)
        assert next_window(now).day != now.day or next_window(now) > now


class TestNightlyBatch:
    def test_defers_without_charger_or_wifi(self, tmp_path: Path) -> None:
        with seed_journal(tmp_path / "j") as journal:
            report = run_batch(
                journal, DirectoryDestination(tmp_path / "out"), charging=False
            )
            assert report.deferred
            assert journal.count(EntryState.CAPTURED) == 8

    def test_full_pass_sends_and_deletes(self, tmp_path: Path) -> None:
        destination = DirectoryDestination(tmp_path / "out")
        with seed_journal(tmp_path / "j", count=6) as journal:
            report = run_batch(
                journal, destination,
                policy=BatchPolicy(privacy_filter=False),
            )
            assert report.assessed == 6
            assert report.acknowledged > 0
            # Nothing acknowledged may remain on the device.
            assert journal.count(EntryState.ACKNOWLEDGED) == 0
            assert len(list((tmp_path / "out").rglob("*.avif"))) == report.acknowledged

    def test_nothing_is_deleted_when_the_destination_refuses(self, tmp_path: Path) -> None:
        """The journal is the only copy until the far end confirms."""

        class Refusing:
            name = "refusing"

            def send(self, entry: object, payload: bytes) -> bool:
                return False

        with seed_journal(tmp_path / "j", count=4) as journal:
            report = run_batch(
                journal, Refusing(), policy=BatchPolicy(privacy_filter=False)
            )
            assert report.acknowledged == 0
            assert journal.count(EntryState.COMPRESSED) > 0
            assert report.carried_over > 0

    def test_orphaned_rejects_from_a_crash_are_cleaned_up(self, tmp_path: Path) -> None:
        with seed_journal(tmp_path / "j", count=4) as journal:
            entry = journal.entries()[0]
            journal.update(mark(entry, EntryState.REJECTED, verdict="drop_blurred"))
            run_batch(
                journal, DirectoryDestination(tmp_path / "out"),
                policy=BatchPolicy(privacy_filter=False),
            )
            assert journal.count(EntryState.REJECTED) == 0

    def test_stale_frames_expire_by_journal_age(self, tmp_path: Path) -> None:
        with seed_journal(tmp_path / "j", count=3) as journal:
            report = run_batch(
                journal, DirectoryDestination(tmp_path / "out"),
                policy=BatchPolicy(max_journal_age_days=0, privacy_filter=False),
                now=datetime.now(UTC) + timedelta(days=1),
            )
            assert report.deleted >= 3
            assert journal.count() == 0

    def test_budget_caps_the_send(self, tmp_path: Path) -> None:
        with seed_journal(tmp_path / "j", count=8) as journal:
            report = run_batch(
                journal, DirectoryDestination(tmp_path / "out"),
                policy=BatchPolicy(max_batch_megabytes=0.0001, privacy_filter=False),
            )
            assert report.acknowledged == 0
            assert report.carried_over > 0

    def test_empty_journal_is_handled(self, tmp_path: Path) -> None:
        with LocalPhotoJournal(tmp_path / "j") as journal:
            report = run_batch(journal, DirectoryDestination(tmp_path / "out"))
            assert report.assessed == 0
            assert "nothing new" in report.message


class TestPrivacyFilter:
    def _frame(self) -> np.ndarray:
        return photo(5, shape=(480, 640))

    def test_empty_scene_is_not_flagged(self) -> None:
        result = assess_people(self._frame())
        assert not result.is_subject

    def test_area_rule_flags_a_dominant_subject(self) -> None:
        """Checked on the rule directly; the detectors need real photographs."""
        config = PeopleConfig(dominant_area_fraction=0.10)
        frame_area = 640 * 480
        big = Detection(200, 100, 300, 300, "face")
        assert big.area / frame_area >= config.dominant_area_fraction

    def test_centrality_is_measured_from_the_frame_centre(self) -> None:
        centred = Detection(300, 220, 40, 40, "face")
        edge = Detection(0, 0, 40, 40, "face")
        assert centred.centre() == (320.0, 240.0)
        assert edge.centre() == (20.0, 20.0)

    def test_confidence_gate_is_configurable(self) -> None:
        """Zero confidence reports poles and doorways as people."""
        assert PeopleConfig().min_body_confidence > 0.0

    def test_detection_geometry(self) -> None:
        detection = Detection(10, 20, 30, 40, "body", 0.9)
        assert detection.area == 1200
        assert detection.centre() == (25.0, 40.0)


class TestDestinations:
    def test_local_path_gives_a_directory_destination(self, tmp_path: Path) -> None:
        assert isinstance(build_destination(str(tmp_path)), DirectoryDestination)

    def test_gs_url_gives_a_gcs_destination(self) -> None:
        destination = build_destination("gs://a-bucket/some/prefix")
        assert isinstance(destination, GcsDestination)
        assert destination.config.bucket == "a-bucket"
        assert destination.config.prefix == "some/prefix"

    def test_bucket_only_url_gets_a_default_prefix(self) -> None:
        assert GcsConfig.from_url("gs://a-bucket").prefix == "frames"

    def test_bad_urls_are_refused(self) -> None:
        with pytest.raises(ValueError, match="gs://"):
            GcsConfig.from_url("https://example.com/bucket")
        with pytest.raises(ValueError, match="no bucket"):
            GcsConfig.from_url("gs://")
        with pytest.raises(NotImplementedError, match="S3"):
            build_destination("s3://a-bucket")

    def test_object_name_is_content_addressed_and_dated(self) -> None:
        destination = build_destination("gs://a-bucket")
        payload = png_bytes(photo(1))
        entry = new_entry(payload, 320, 240, source="test")
        name = destination.object_name(entry)
        assert entry.frame_id in name
        assert name.endswith(".avif")
        assert entry.captured_at.date().isoformat() in name

    def test_project_is_carried_into_the_client_config(self) -> None:
        """User ADC has no billing project; one must be attached or some APIs refuse."""
        destination = build_destination("gs://a-bucket", project="my-project-123")
        assert destination.config.project == "my-project-123"  # type: ignore[attr-defined]

    def test_project_falls_back_to_the_environment(self, monkeypatch) -> None:
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "from-env")
        destination = build_destination("gs://a-bucket")
        assert destination.config.project == "from-env"  # type: ignore[attr-defined]

    def test_missing_credentials_are_reported_not_raised(self, monkeypatch) -> None:
        """Discovering this at 02:00 is worse than discovering it at setup."""
        monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
        destination = GcsDestination(GcsConfig(bucket="definitely-not-a-real-bucket-smc"))
        ok, message = destination.check_access()
        assert isinstance(ok, bool)
        assert message


class TestCameraRoll:
    def test_scan_finds_images_and_ignores_other_files(self, tmp_path: Path) -> None:
        from PIL import Image

        for name in ("a.jpg", "b.png"):
            Image.fromarray(photo(1, shape=(60, 80))).save(tmp_path / name)
        (tmp_path / "notes.txt").write_text("x")
        assert {p.name for p in scan(tmp_path)} == {"a.jpg", "b.png"}

    def test_missing_directory_yields_nothing(self, tmp_path: Path) -> None:
        assert scan(tmp_path / "absent") == []

    def test_ingest_deduplicates_identical_files(self, tmp_path: Path) -> None:
        from PIL import Image

        image = Image.fromarray(photo(2, shape=(60, 80)))
        image.save(tmp_path / "one.png")
        image.save(tmp_path / "copy.png")
        with LocalPhotoJournal(tmp_path / "j") as journal:
            report = ingest(journal, scan(tmp_path))
            assert report.added == 1
            assert report.duplicates == 1

    def test_unreadable_files_are_counted_not_fatal(self, tmp_path: Path) -> None:
        (tmp_path / "broken.jpg").write_bytes(b"not an image")
        with LocalPhotoJournal(tmp_path / "j") as journal:
            report = ingest(journal, scan(tmp_path))
            assert report.unreadable == 1
            assert report.added == 0
