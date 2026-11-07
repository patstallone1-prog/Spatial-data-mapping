#!/usr/bin/env python3
"""Archive licensed NPC/vehicle packs on a mounted library volume; never install them.

Archives, source pages, licenses, checksums and a model index stay outside the web/native
runtime. Re-running verifies existing archives, and the external-volume/reserve guards
prevent a missing drive silently filling the system disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

PACKS = {
    "car-kit": "vehicle",
    "toy-car-kit": "vehicle",
    "racing-kit": "vehicle",
    "blocky-characters": "npc",
    "mini-characters": "npc",
    "animated-characters-protagonists": "npc",
    "animated-characters-survivors": "npc",
    "animated-characters-retro": "npc",
}
MODEL_EXTENSIONS = {".glb", ".gltf", ".fbx", ".obj", ".blend"}
MAX_ARCHIVE_BYTES = 512 * 1024**2


def fetch(url, referer=None):
    headers = {"User-Agent": "KerbsideAssetArchive/1.0"}
    if referer:
        headers["Referer"] = referer
        headers["Accept"] = "application/json" if "/download-link/" in url else "*/*"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ValueError("source exceeds archive size limit")
    return data


def safe_members(archive):
    for member in archive.infolist():
        p = PurePosixPath(member.filename)
        if p.is_absolute() or ".." in p.parts or "\\" in member.filename:
            raise ValueError("unsafe archive path")
        if ((member.external_attr >> 16) & 0o170000) == 0o120000:
            raise ValueError("archive symlink is not allowed")
    if sum(m.file_size for m in archive.infolist()) > 2 * 1024**3:
        raise ValueError("unpacked archive exceeds library limit")
    return archive.infolist()


def acquire(root, slug, kind):
    folder = root / slug
    folder.mkdir(parents=True, exist_ok=True)
    page_url = "https://kenney.nl/assets/" + slug
    page = fetch(page_url)
    if b"creativecommons.org/publicdomain/zero" not in page:
        raise ValueError("publisher page no longer confirms CC0; review manually")
    links = re.findall(r"href=[\"\']([^\"\']+\.zip(?:\?[^\"\']*)?)[\"\']", page.decode())
    if links:
        url = urllib.parse.urljoin(page_url, links[-1])
    else:
        # The publisher's Continue-without-donating button requests this public link.
        token = re.search(r"data-download-id=[\"']([a-f0-9]+)[\"']", page.decode())
        if not token:
            raise ValueError("publisher page has no archive download")
        url = json.loads(fetch("https://kenney.nl/download-link/" + token[1], page_url))["url"]
    if urllib.parse.urlparse(url).hostname != "kenney.nl":
        raise ValueError("archive left approved publisher host")
    archive_path = folder / "source.zip"
    receipt_path = folder / "receipt.json"
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
    if archive_path.exists():
        data = archive_path.read_bytes()
        if not receipt or hashlib.sha256(data).hexdigest() != receipt["sha256"]:
            raise ValueError("existing archive has no matching receipt; preserve for review")
        url = receipt["archive_url"]
    else:
        data = fetch(url, page_url)
        temporary = folder / "source.zip.part"
        temporary.write_bytes(data)
        with zipfile.ZipFile(temporary) as archive:
            safe_members(archive)
            if archive.testzip():
                raise ValueError("archive CRC failure")
        temporary.replace(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        members = safe_members(archive)
        unpacked = sum(m.file_size for m in members)
        if shutil.disk_usage(root).free - unpacked < 12 * 1024**3:
            raise RuntimeError("12 GiB external reserve would be exceeded")
        archive.extractall(folder / "files")
    (folder / "publisher-page.html").write_bytes(page)
    models = sorted(
        str(p.relative_to(folder))
        for p in (folder / "files").rglob("*")
        if p.suffix.lower() in MODEL_EXTENSIONS
    )
    licenses = sorted(
        str(p.relative_to(folder))
        for p in (folder / "files").rglob("*")
        if p.is_file() and "license" in p.name.lower()
    )
    if licenses and not any(b"CC0" in (folder / name).read_bytes().upper() for name in licenses):
        raise ValueError("bundled license does not confirm CC0; retain archive for review")
    if not models or not licenses:
        raise ValueError("archive needs models and its bundled license")
    result = dict(
        id=slug,
        kind=kind,
        publisher="Kenney",
        source_url=page_url,
        archive_url=url,
        license="CC0-1.0",
        license_files=licenses,
        sha256=hashlib.sha256(data).hexdigest(),
        bytes=len(data),
        models=models,
        model_files=len(models),
        status="archived_not_integrated",
        reviewed_at=datetime.now(UTC).isoformat(),
    )
    receipt_path.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if len(root.parts) < 4 or root.parts[1] != "Volumes" or not Path(*root.parts[:3]).is_mount():
        parser.error("library must be beneath a mounted external volume")
    root.mkdir(parents=True, exist_ok=True)
    rows, failures = [], []
    for slug, kind in PACKS.items():
        try:
            if shutil.disk_usage(root).free < 13 * 1024**3:
                raise RuntimeError("external volume below 13 GiB acquisition reserve")
            row = acquire(root, slug, kind)
            rows.append(row)
            print(slug, row["model_files"], "model files archived", flush=True)
        except Exception as error:
            failures.append(dict(id=slug, error=str(error)))
            print(slug, str(error), flush=True)
        report = root / "catalogue.json"
        temporary = report.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(
                dict(
                    schema="kerbside.background_assets/1",
                    integrated=False,
                    packs=rows,
                    failures=failures,
                ),
                indent=2,
            )
            + "\n"
        )
        os.replace(temporary, report)
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
