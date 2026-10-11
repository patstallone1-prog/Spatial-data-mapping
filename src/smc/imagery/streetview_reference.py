"""Private noncommercial reference acquisitions; never a public geometry promotion.

Original TAR bundles remain intact. Indexing preserves every correspondence partner
and camera identity, without guessing unknown capture epochs or intrinsics.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import io
import json
import math
import os
import re
import shutil
import sqlite3
import tarfile
import tempfile
import urllib.request
import zlib
from datetime import UTC, datetime
from pathlib import Path

from smc.imagery.archive import RangedHttpFile
from smc.imagery.research_datasets import parse_city_patch
from smc.storage.external_volume import volume_ready

SOURCE_ROOT = "https://datasets.epfl.ch/vilab/eccv16/"
LICENSE_URL = "https://github.com/amir32002/3D_Street_View/blob/master/LICENSE"
FRAME_NAME = re.compile(r"(?:^|/)(\d+)_\d+_\d+_\d+\.txt$")
RESERVE_BYTES = 4 * 1024**3


def fetch_range(url: str, start: int, end: int, total: int) -> bytes:
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    expected = end - start + 1
    with urllib.request.urlopen(request, timeout=60) as response:
        if (response.status != 206 or response.headers.get("Content-Range")
                != f"bytes {start}-{end}/{total}"):
            raise OSError("reference host did not honor the exact download range")
        block = response.read(expected + 1)
        if len(block) != expected:
            raise OSError("reference range is truncated or oversized")
        return block


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w") as stream:
        stream.write(json.dumps(value, indent=2, default=str) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def storage_guard(output: Path, volume: Path, volume_uuid: str, needed: int = 0) -> None:
    if not volume_ready(volume, volume_uuid) or not output.resolve().is_relative_to(volume.resolve()):
        raise OSError("verified external volume is not available")
    if shutil.disk_usage(volume).free < RESERVE_BYTES + needed:
        raise OSError("private acquisition would violate the external storage reserve")


def probe_archive(url: str) -> dict:
    if not re.fullmatch(re.escape(SOURCE_ROOT) + r"dataset_unaligned/\d{4}\.tar", url):
        raise ValueError("not a published unaligned reference archive")
    remote = RangedHttpFile(url, timeout=30)
    # The published .tar files are actually gzip-compressed. Stream only the
    # first records; do not mistake an invalid raw TAR header for empty coverage.
    with tarfile.open(fileobj=io.BufferedReader(remote, buffer_size=65536), mode="r|*") as archive:
        for number, member in enumerate(archive):
            if number > 64:
                break
            if not member.isfile() or not FRAME_NAME.search(member.name) or member.size > 16384:
                continue
            text = archive.extractfile(member).read().decode("utf-8")
            # A-row postprocessing is not a camera calibration. Retain it at full
            # import; this discovery probe needs only the original d-row location.
            patch = parse_city_patch(text.splitlines()[0], member.name)
            lat, lon, _ = patch["target_lat_lon_height"]
            return {"url": url, "size_bytes": remote.size, "sample": patch,
                    "sample_in_sf": 37.65 <= lat <= 37.86 and -122.55 <= lon <= -122.30,
                    "selection_basis": "first_target_in_documented_rectangular_subregion; not full_bbox",
                    "probe_bytes": remote.bytes_read}
    raise ValueError("no documented camera/target metadata found in archive probe")


def download_asset(url: str, destination: Path, volume: Path, volume_uuid: str) -> dict:
    if not url.startswith(SOURCE_ROOT):
        raise ValueError("source is not the official dataset host")
    remote = RangedHttpFile(url, timeout=60)
    storage_guard(destination.parent, volume, volume_uuid)
    destination.parent.mkdir(parents=True, exist_ok=True)
    receipt_path = destination.with_suffix(destination.suffix + ".receipt.json")
    if destination.exists():
        if destination.is_symlink() or not receipt_path.is_file():
            raise ValueError("unverified existing reference asset")
        receipt = json.loads(receipt_path.read_text())
        if (receipt.get("url") != url or destination.stat().st_size != remote.size
                or receipt.get("sha256") != sha256(destination)):
            raise ValueError("existing reference asset checksum or identity changed")
        return receipt
    part = destination.with_suffix(destination.suffix + ".part")
    if part.is_symlink():
        raise ValueError("partial acquisition cannot be a symlink")
    offset = part.stat().st_size if part.exists() else 0
    progress_path = destination.with_suffix(destination.suffix + ".progress.json")
    chunks = []
    if part.exists() and progress_path.exists():
        checkpoint = json.loads(progress_path.read_text())
        if checkpoint.get("url") != url or checkpoint.get("total") != remote.size:
            raise ValueError("partial acquisition source identity changed")
        committed = checkpoint["downloaded"]
        if committed > offset or committed < 0:
            raise ValueError("partial acquisition is smaller than its committed checkpoint")
        if offset > committed:
            with part.open("r+b") as target:
                target.truncate(committed)  # Uncommitted transfer tail, not source evidence.
            offset = committed
        chunks = checkpoint.get("chunks", [])
        with part.open("rb") as target:
            for chunk in chunks:
                target.seek(chunk["offset"])
                if hashlib.sha256(target.read(chunk["size"])).hexdigest() != chunk["sha256"]:
                    raise ValueError("partial acquisition checkpoint bytes changed")
    if offset > remote.size:
        raise ValueError("partial acquisition exceeds source length")
    storage_guard(destination.parent, volume, volume_uuid, remote.size - offset)
    if offset:
        # Verify a substantial prefix before trusting any previous partial bytes.
        with part.open("rb") as previous:
            prefix = previous.read(min(offset, 65536))
        if remote.read(len(prefix)) != prefix:
            raise ValueError("partial acquisition no longer matches remote source")
    chunk_size = 4 * 1024**2
    with part.open("ab") as target, concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pending, submitted = {}, offset
        while offset < remote.size:
            while len(pending) < 4 and submitted < remote.size:
                end = min(submitted + chunk_size, remote.size) - 1
                pending[submitted] = pool.submit(fetch_range, url, submitted, end, remote.size)
                submitted = end + 1
            # Commit only a contiguous, verified prefix: a restart never
            # mistakes out-of-order chunks or sparse holes for downloaded bytes.
            block = pending.pop(offset).result()
            storage_guard(destination.parent, volume, volume_uuid)
            target.write(block)
            target.flush()
            os.fsync(target.fileno())
            chunks.append({"offset": offset, "size": len(block),
                           "sha256": hashlib.sha256(block).hexdigest()})
            offset += len(block)
            atomic_json(progress_path, {
                "url": url, "downloaded": offset, "total": remote.size,
                "at": datetime.now(UTC), "publication": "private_noncommercial_only",
                "parallel_ranges": 4, "max_prefetch_memory_bytes": 4 * chunk_size,
                "chunks": chunks,
            })
    if part.stat().st_size != remote.size:
        raise OSError("download length mismatch")
    digest = sha256(part)
    receipt = {"schema": "kerbside.private_reference_asset/1", "url": url,
               "file": destination.name, "sha256": digest, "size_bytes": remote.size,
               "downloaded_at": datetime.now(UTC), "captured_at": None,
               "license_url": LICENSE_URL, "rights": "noncommercial_no_source_redistribution",
               "production_eligible": False, "vendor_checksum_provided": False,
               "geometry_basis": "manual_reference_not_measured_truth"}
    atomic_json(receipt_path, receipt)
    part.rename(destination)
    return receipt


def index_archive(path: Path, database: Path) -> dict:
    """Store locator/pose/group records, keeping all JPEGs in their original TAR."""
    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS patches (archive TEXT, member TEXT, group_id TEXT, "
                     "panorama_id TEXT, jpeg_member TEXT, jpeg_offset INTEGER, jpeg_size INTEGER, "
                     "metadata TEXT, PRIMARY KEY(archive, member))")
        conn.execute("CREATE TABLE IF NOT EXISTS imports (archive TEXT PRIMARY KEY, sha256 TEXT, rows INTEGER)")
        digest = sha256(path)
        imported = conn.execute("SELECT sha256, rows FROM imports WHERE archive=?", (path.name,)).fetchone()
        if imported:
            if imported[0] != digest:
                raise ValueError("immutable archive changed")
            return {"archive": path.name, "patches": imported[1], "status": "indexed"}
        images, metadata = {}, []
        with open_seekable_archive(path) as source, tarfile.open(fileobj=source, mode="r:") as archive:
            for member in archive:
                if not member.isfile():
                    continue
                if member.name.endswith(".jpg"):
                    images[member.name] = (member.offset_data, member.size)
                elif FRAME_NAME.search(member.name):
                    if member.size > 16384:
                        raise ValueError("unexpectedly large camera metadata")
                    text = archive.extractfile(member).read().decode("utf-8")
                    record = parse_city_patch(text.splitlines()[0], member.name)
                    # Preserve ALL original rows even if a-row format needs further review.
                    record["raw_pose_and_alignment_text"] = text
                    record["intrinsics"] = "unknown; reconstruction must calibrate, not assume"
                    metadata.append((member.name, record))
            if hasattr(source, "export_index"):
                temporary_index = str(path) + ".gzi.tmp"
                source.export_index(temporary_index)
                Path(temporary_index).replace(str(path) + ".gzi")
        for name, record in metadata:
            jpeg = str(Path(name).with_suffix(".jpg"))
            if jpeg not in images:
                raise ValueError("camera record has no matching image")
            offset, size = images[jpeg]
            conn.execute("INSERT INTO patches VALUES (?,?,?,?,?,?,?,?)", (
                path.name, name, record["correspondence_group"], record["panorama_id"], jpeg,
                offset, size, json.dumps(record)))
        conn.execute("INSERT INTO imports VALUES (?,?,?)", (path.name, digest, len(metadata)))
        conn.execute("CREATE INDEX IF NOT EXISTS correspondence ON patches(group_id)")
        conn.commit()
        groups = conn.execute("SELECT count(DISTINCT group_id) FROM patches WHERE archive=?", (path.name,)).fetchone()[0]
    return {"archive": path.name, "patches": len(metadata), "correspondence_groups": groups,
            "status": "indexed", "source_images_extracted": False, "production_eligible": False}


def open_seekable_archive(path: Path):
    with path.open("rb") as header:
        compressed = header.read(2) == b"\x1f\x8b"
    if not compressed:
        return path.open("rb")
    try:
        from indexed_gzip import IndexedGzipFile
        index = Path(str(path) + ".gzi")
        options = {"index_file": str(index)} if index.exists() else {}
        return IndexedGzipFile(filename=str(path), spacing=4 * 1024**2, **options)
    except ImportError:
        if path.stat().st_size > 8 * 1024**2:
            raise RuntimeError("install the reference-audit extra for large gzip reference bundles") from None
        import gzip
        return gzip.open(path, "rb")


def parse_relative_pose_line(text: str) -> dict:
    values = text.split()
    if len(values) != 8 or not all(re.fullmatch(r"\d{4}-\d+", v) for v in values[:2]):
        raise ValueError("invalid documented relative-pose row")
    numbers = [float(v) for v in values[2:]]
    if not all(math.isfinite(v) for v in numbers):
        raise ValueError("nonfinite relative pose")
    return {"a": values[0], "b": values[1],
            "relative_heading_pitch_roll_deg": numbers[:3],
            "relative_longitudinal_lateral_height_m": numbers[3:],
            "rotation_composition_convention": "requires_backend_validation",
            "absolute_geolocation": None, "captured_at": None,
            "intrinsics": None, "production_eligible": False}


def parse_matching_line(text: str) -> dict:
    values = text.split()
    if (len(values) != 5 or not all(re.fullmatch(r"\d{4}-\d+", v) for v in values[:2])
            or values[2] not in {"0", "1"}):
        raise ValueError("invalid documented matching row")
    angles = [float(v) for v in values[3:]]
    if not all(math.isfinite(v) for v in angles):
        raise ValueError("nonfinite matching angles")
    same = values[2] == "1"
    return {"a": values[0], "b": values[1], "same_target": same,
            # The source format explicitly says orientation is invalid for negatives.
            "relative_heading_pitch_deg": angles if same else None,
            "source_raw_line": text, "production_eligible": False}


def index_test_archive(path: Path, database: Path) -> dict:
    """Preserve official evaluation images and labels without treating negatives as overlapping views."""
    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS test_images (archive TEXT, member TEXT, "
                     "image_id TEXT, variant TEXT, offset INTEGER, size INTEGER, "
                     "PRIMARY KEY(archive,member))")
        conn.execute("CREATE TABLE IF NOT EXISTS test_labels (archive TEXT, member TEXT, text TEXT, "
                     "PRIMARY KEY(archive,member))")
        conn.execute("CREATE INDEX IF NOT EXISTS test_image_identity ON test_images(archive,image_id,variant)")
        conn.execute("CREATE TABLE IF NOT EXISTS matching_pairs (archive TEXT, ordinal INTEGER, "
                     "a TEXT,b TEXT,same_target INTEGER,metadata TEXT,PRIMARY KEY(archive,ordinal))")
        conn.execute("CREATE TABLE IF NOT EXISTS relative_poses (archive TEXT, ordinal INTEGER, "
                     "a TEXT,b TEXT,metadata TEXT,PRIMARY KEY(archive,ordinal))")
        conn.execute("CREATE TABLE IF NOT EXISTS test_imports (archive TEXT PRIMARY KEY,sha256 TEXT,images INTEGER)")
        digest = sha256(path)
        previous = conn.execute("SELECT sha256,images FROM test_imports WHERE archive=?", (path.name,)).fetchone()
        if previous:
            if previous[0] != digest:
                raise ValueError("immutable evaluation archive changed")
            return {"archive": path.name, "images": previous[1], "status": "indexed_private_evaluation"}
        count, poses, matches = 0, 0, 0
        with open_seekable_archive(path) as source, tarfile.open(fileobj=source, mode="r:") as archive:
            for member in archive:
                if not member.isfile():
                    continue
                match = re.search(r"(?:^|/)(\d{4}-\d+)_([ip])\.jpg$", member.name)
                if match:
                    conn.execute("INSERT INTO test_images VALUES (?,?,?,?,?,?)", (
                        path.name, member.name, match[1], match[2], member.offset_data, member.size))
                    count += 1
                elif member.name.endswith(".txt"):
                    if member.size > 32 * 1024**2:
                        raise ValueError("unexpectedly large evaluation labels")
                    text = archive.extractfile(member).read().decode("utf-8")
                    conn.execute("INSERT INTO test_labels VALUES (?,?,?)", (path.name, member.name, text))
                    if member.name.endswith("regpairs.txt"):
                        for ordinal, line in enumerate(text.splitlines()):
                            if not line.strip():
                                continue
                            pose = parse_relative_pose_line(line)
                            for identity in (pose["a"], pose["b"]):
                                if not conn.execute("SELECT 1 FROM test_images WHERE archive=? AND image_id=? AND variant='i'",
                                                    (path.name, identity)).fetchone():
                                    raise ValueError("relative-pose partner lacks full-context image")
                            conn.execute("INSERT INTO relative_poses VALUES (?,?,?,?,?)", (
                                path.name, ordinal, pose["a"], pose["b"], json.dumps(pose)))
                            poses += 1
                    elif member.name.endswith("verpairs.txt"):
                        for ordinal, line in enumerate(text.splitlines()):
                            if not line.strip():
                                continue
                            pair = parse_matching_line(line)
                            for identity in (pair["a"], pair["b"]):
                                if not conn.execute("SELECT 1 FROM test_images WHERE archive=? AND image_id=? AND variant='i'",
                                                    (path.name, identity)).fetchone():
                                    raise ValueError("matching partner lacks full-context image")
                            conn.execute("INSERT INTO matching_pairs VALUES (?,?,?,?,?,?)", (
                                path.name, ordinal, pair["a"], pair["b"], int(pair["same_target"]), json.dumps(pair)))
                            matches += 1
            if hasattr(source, "export_index"):
                temporary_index = str(path) + ".gzi.tmp"
                source.export_index(temporary_index)
                Path(temporary_index).replace(str(path) + ".gzi")
        if not count:
            raise ValueError("evaluation archive contains no documented images")
        conn.execute("INSERT INTO test_imports VALUES (?,?,?)", (path.name, digest, count))
        conn.commit()
    return {"archive": path.name, "images": count, "relative_pose_pairs": poses, "matching_pairs": matches,
            "status": "indexed_private_evaluation", "production_eligible": False,
            "matching_negative_labels": "retained_separately; excluded_from_positive_view_graph",
            "absolute_geolocation": None, "captured_at": None,
            "image_variants": {"i": "full_context_640px", "p": "crop_101px_not_full_front"}}


def load_correspondence_group(database: Path, archives: Path, group_id: str, pixel_root: Path) -> dict:
    """Lazy evidence adapter for reconstruction: all views, exact-pixel dedupe, no invented intrinsics.

    Outputs are private pose priors, not solved cameras and not promotable measured facts.
    The original archive remains the acquisition unit; no standalone JPEG collection is retained.
    """
    from smc.reconstruction.pixel_store import CanonicalPixels, LocalBlobStore
    store = LocalBlobStore(pixel_root / "blobs")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as conn:
        rows = conn.execute("SELECT archive,jpeg_member,jpeg_offset,jpeg_size,metadata FROM patches "
                            "WHERE group_id=? ORDER BY archive,member", (group_id,)).fetchall()
    if not rows:
        raise ValueError("reference correspondence group does not exist")
    frames = []
    pixel_root.mkdir(parents=True, exist_ok=True)
    for archive_name, member, offset, size, text in rows:
        record = json.loads(text)
        path = archives / archive_name
        with open_seekable_archive(path) as source:
            source.seek(offset)
            raw = source.read(size)
        if len(raw) != size:
            raise OSError("archive image is truncated")
        with tempfile.NamedTemporaryFile(dir=pixel_root, suffix=".jpg") as temporary:
            temporary.write(raw)
            temporary.flush()
            pixels = CanonicalPixels.from_image(Path(temporary.name))
        store.put_if_absent(pixels.sha256, zlib.compress(pixels.payload(), 6))
        locator = f"{archive_name}#{member}"
        alias = {"locator": locator, "raw_sha256": hashlib.sha256(raw).hexdigest(),
                 "pixel_sha256": pixels.sha256, "license_url": LICENSE_URL,
                 "rights": "private_noncommercial_no_source_redistribution",
                 "privacy_review": "pending", "captured_at": None,
                 "pose_prior": record, "intrinsics": None, "production_eligible": False}
        alias_id = hashlib.sha256(locator.encode()).hexdigest()
        atomic_json(pixel_root / "aliases" / f"{alias_id}.json", alias)
        frames.append(alias)
    acquisition = {"schema": "kerbside.private_reconstruction_input/1", "group_id": group_id,
                   "frames": frames, "view_count": len(frames),
                   "unique_camera_count": len({f["pose_prior"]["panorama_id"] for f in frames}),
                   "camera_calibration_required": True, "captured_at": None,
                   "production_eligible": False, "canonical_geometry_modified": False}
    atomic_json(pixel_root / "groups" / f"{group_id.replace(':', '-')}.json", acquisition)
    return acquisition


def load_test_pair(database: Path, archives: Path, archive_name: str, ordinal: int,
                   pixel_root: Path, *, kind: str = "pose") -> dict:
    """Hand full-context pixels and preserved labels to a PRIVATE pose/matching benchmark."""
    from smc.reconstruction.pixel_store import CanonicalPixels, LocalBlobStore
    if kind not in {"pose", "matching"}:
        raise ValueError("unknown reference benchmark type")
    table = "relative_poses" if kind == "pose" else "matching_pairs"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as conn:
        row = conn.execute(f"SELECT metadata FROM {table} WHERE archive=? AND ordinal=?",
                           (archive_name, ordinal)).fetchone()
        if not row:
            raise ValueError("reference pair does not exist")
        label = json.loads(row[0])
        images = []
        for identity in (label["a"], label["b"]):
            images.append(conn.execute("SELECT member,offset,size FROM test_images "
                                       "WHERE archive=? AND image_id=? AND variant='i'",
                                       (archive_name, identity)).fetchone())
    pixel_root.mkdir(parents=True, exist_ok=True)
    store, frames = LocalBlobStore(pixel_root / "blobs"), []
    with open_seekable_archive(archives / archive_name) as source:
        for identity, image in zip((label["a"], label["b"]), images, strict=True):
            if image is None:
                raise ValueError("reference pair has no full-context image")
            member, offset, size = image
            source.seek(offset)
            raw = source.read(size)
            if len(raw) != size:
                raise OSError("reference image truncated")
            with tempfile.NamedTemporaryFile(dir=pixel_root, suffix=".jpg") as temporary:
                temporary.write(raw)
                temporary.flush()
                pixels = CanonicalPixels.from_image(Path(temporary.name))
            store.put_if_absent(pixels.sha256, zlib.compress(pixels.payload(), 6))
            frame = {"image_id": identity, "locator": f"{archive_name}#{member}",
                     "pixel_sha256": pixels.sha256, "raw_sha256": hashlib.sha256(raw).hexdigest(),
                     "dimensions": [pixels.width, pixels.height], "variant": "full_context_i",
                     "license_url": LICENSE_URL, "publication": "private_noncommercial_only",
                     "privacy_review": "pending", "captured_at": None, "absolute_geolocation": None,
                     "camera_independence": "unknown; image_ids_are_not_verified_panorama_ids"}
            atomic_json(pixel_root / "aliases" / f"{hashlib.sha256(frame['locator'].encode()).hexdigest()}.json", frame)
            frames.append(frame)
    package = {"schema": "kerbside.private_reference_pair/1", "kind": kind, "label": label,
               "frames": frames, "production_eligible": False, "canonical_geometry_modified": False,
               "use_as_positive_overlap": kind == "pose" or label["same_target"]}
    atomic_json(pixel_root / "pairs" / f"{archive_name}-{kind}-{ordinal}.json", package)
    return package


def mesh_inventory(path: Path) -> dict:
    vertices = faces = 0
    low, high = [math.inf] * 3, [-math.inf] * 3
    with path.open() as stream:
        for line in stream:
            if line.startswith("v "):
                xyz = [float(v) for v in line.split()[1:4]]
                if len(xyz) != 3 or not all(math.isfinite(v) for v in xyz):
                    raise ValueError("invalid reference vertex")
                vertices += 1
                low = [min(a, b) for a, b in zip(low, xyz, strict=True)]
                high = [max(a, b) for a, b in zip(high, xyz, strict=True)]
            elif line.startswith("f "):
                faces += 1
    if not vertices or not faces:
        raise ValueError("reference mesh is empty")
    return {"vertices": vertices, "polygon_faces": faces, "bounds_source_xyz": [low, high],
            "horizontal_crs_hypothesis": "EPSG:3857; validate against image target coordinates",
            "vertical_datum": "unknown", "geometry_basis": "manual_reference_not_ground_truth",
            "production_eligible": False}
