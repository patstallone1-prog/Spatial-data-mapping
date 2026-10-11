import io
import json
import sqlite3
import tarfile

import pytest
from PIL import Image

from smc.imagery.streetview_reference import (
    SOURCE_ROOT,
    download_asset,
    index_archive,
    index_test_archive,
    load_correspondence_group,
    load_test_pair,
    mesh_inventory,
    parse_matching_line,
    parse_relative_pose_line,
    probe_archive,
)


def bundle(path, missing_image=False):
    image = io.BytesIO()
    Image.new("RGB", (16, 16), (80, 90, 100)).save(image, format="JPEG")
    with tarfile.open(path, "w:gz") as archive:
        for index in range(2):
            stem = f"0006/0000006_{index:07d}_{index:07d}_0000008"
            text = f"d 6 8 {index} {index} 37.79 -122.40 20 1 0 0 37.791 -122.401 10 15 90 0 0\na original_alignment_preserved"
            records = [(stem + ".txt", text.encode())]
            if not missing_image:
                records.append((stem + ".jpg", image.getvalue()))
            for name, data in records:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))


def test_compressed_tar_keeps_all_partners_and_one_canonical_pixel_blob(tmp_path):
    path = tmp_path / "0006.tar"
    bundle(path)
    database = tmp_path / "reference.sqlite"
    result = index_archive(path, database)
    assert result["patches"] == 2 and result["correspondence_groups"] == 1
    assert not result["source_images_extracted"]
    assert index_archive(path, database)["patches"] == 2
    evidence = load_correspondence_group(database, tmp_path, "6:8", tmp_path / "pixels")
    assert evidence["view_count"] == evidence["unique_camera_count"] == 2
    assert evidence["camera_calibration_required"]
    assert not evidence["production_eligible"]
    assert len({f["pixel_sha256"] for f in evidence["frames"]}) == 1
    assert len(list((tmp_path / "pixels/aliases").glob("*.json"))) == 2
    assert "original_alignment_preserved" in evidence["frames"][0]["pose_prior"]["raw_pose_and_alignment_text"]
    assert not list((tmp_path / "pixels").glob("*.jpg"))
    assert json.loads((tmp_path / "pixels/groups/6-8.json").read_text())["captured_at"] is None


def test_missing_partner_image_does_not_commit_an_empty_measurement(tmp_path):
    path = tmp_path / "0006.tar"
    bundle(path, missing_image=True)
    database = tmp_path / "reference.sqlite"
    with pytest.raises(ValueError, match="no matching image"):
        index_archive(path, database)
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT count(*) FROM imports").fetchone()[0] == 0


def test_reference_mesh_is_not_measured_truth_and_empty_mesh_fails(tmp_path):
    path = tmp_path / "mesh.obj"
    path.write_text("v 0 0 0\nv 1 0 0\nv 0 1 2\nf 1 2 3\n")
    record = mesh_inventory(path)
    assert record["vertices"] == 3 and record["polygon_faces"] == 1
    assert not record["production_eligible"] and record["vertical_datum"] == "unknown"
    path.write_text("# not a mesh\n")
    with pytest.raises(ValueError, match="empty"):
        mesh_inventory(path)


def test_discovery_checks_the_real_compressed_tar_not_its_filename(tmp_path, monkeypatch):
    path = tmp_path / "0006.tar"
    bundle(path)

    class Remote(io.BytesIO):
        def __init__(self, *args, **kwargs):
            super().__init__(path.read_bytes())
            self.size = path.stat().st_size
            self.bytes_read = 123
    monkeypatch.setattr("smc.imagery.streetview_reference.RangedHttpFile", Remote)
    result = probe_archive("https://datasets.epfl.ch/vilab/eccv16/dataset_unaligned/0006.tar")
    assert result["sample_in_sf"] and result["sample"]["correspondence_group"] == "6:8"
    with pytest.raises(ValueError, match="published"):
        probe_archive("https://datasets.epfl.ch/vilab/eccv16/dataset_unaligned/../other.tar")


def test_resumable_parallel_download_never_counts_uncommitted_tail_as_complete(tmp_path, monkeypatch):
    import hashlib
    data = b"a" * (5 * 1024**2)
    url = SOURCE_ROOT + "test_set/test_matching.tar"

    class Remote(io.BytesIO):
        def __init__(self, *args, **kwargs):
            super().__init__(data)
            self.size = len(data)
    monkeypatch.setattr("smc.imagery.streetview_reference.RangedHttpFile", Remote)
    monkeypatch.setattr("smc.imagery.streetview_reference.storage_guard", lambda *args: None)
    monkeypatch.setattr("smc.imagery.streetview_reference.fetch_range", lambda u, start, end, total: data[start:end + 1])
    destination = tmp_path / "test_matching.tar"
    destination.with_suffix(".tar.part").write_bytes(data[:1024] + b"bad uncommitted tail")
    destination.with_suffix(".tar.progress.json").write_text(json.dumps({
        "url": url, "total": len(data), "downloaded": 1024,
        "chunks": [{"offset": 0, "size": 1024, "sha256": hashlib.sha256(data[:1024]).hexdigest()}]}))
    receipt = download_asset(url, destination, tmp_path, "fixture")
    assert destination.read_bytes() == data and receipt["size_bytes"] == len(data)
    assert receipt["sha256"] == hashlib.sha256(data).hexdigest()
    assert not receipt["production_eligible"]
    assert not destination.with_suffix(".tar.part").exists()
    assert download_asset(url, destination, tmp_path, "fixture")["sha256"] == receipt["sha256"]


def test_private_source_rights_can_never_satisfy_public_export_requirements():
    from pathlib import Path

    from smc.reconstruction.contracts import load_rights
    rights = load_rights(Path(__file__).resolve().parents[1] / "data/reconstruction/source_rights.json")
    rights["3d-street-view"].require("private_pose_benchmark")
    with pytest.raises(ValueError, match="lacks rights"):
        rights["3d-street-view"].require("persistent_hosting", "redistribution", "commercial_use")


def test_relative_pose_import_preserves_units_and_never_invents_absolute_coordinates(tmp_path):
    row = "0057-0164486 0057-0164485 -44.3 -17.1 0 -37.7 7.64 -0.43"
    pose = parse_relative_pose_line(row)
    assert pose["relative_longitudinal_lateral_height_m"] == [-37.7, 7.64, -0.43]
    assert pose["absolute_geolocation"] is None
    assert pose["intrinsics"] is None
    path = tmp_path / "test_poseregression.tar"
    jpeg = io.BytesIO()
    Image.new("RGB", (640, 640), (80, 90, 100)).save(jpeg, format="JPEG")
    with tarfile.open(path, "w") as archive:
        for identity in (pose["a"], pose["b"]):
            member = tarfile.TarInfo(f"regTest/data/{identity}_i.jpg")
            member.size = len(jpeg.getvalue())
            archive.addfile(member, io.BytesIO(jpeg.getvalue()))
        member = tarfile.TarInfo("regTest/regpairs.txt")
        member.size = len(row)
        archive.addfile(member, io.BytesIO(row.encode()))
    imported = index_test_archive(path, tmp_path / "reference.sqlite")
    assert imported["images"] == 2 and imported["relative_pose_pairs"] == 1
    assert not imported["production_eligible"]
    pair = load_test_pair(tmp_path / "reference.sqlite", tmp_path, path.name, 0, tmp_path / "pixels")
    assert len(pair["frames"]) == 2
    assert pair["frames"][0]["dimensions"] == [640, 640]
    assert len({f["pixel_sha256"] for f in pair["frames"]}) == 1
    assert not pair["production_eligible"]


def test_matching_negatives_cannot_supply_camera_orientation_or_overlap():
    positive = parse_matching_line("0016-0304449 0016-0304447 1 -5.62 -3.37")
    negative = parse_matching_line("0016-0304447 0023-0157227 0 54.36 2.22")
    assert positive["same_target"] and positive["relative_heading_pitch_deg"] == [-5.62, -3.37]
    assert not negative["same_target"] and negative["relative_heading_pitch_deg"] is None
