"""Pack planned release assets from a storage manifest."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tarfile
from typing import Any


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def pack_release_assets(
    manifest_path: Path,
    *,
    capture_root: Path,
    out_dir: Path,
) -> list[dict[str, Any]]:
    """Create tar files and checksum sidecars for every planned release asset."""

    manifest = load_manifest(manifest_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    packed: list[dict[str, Any]] = []
    for asset in manifest.get("release_assets", []):
        asset_name = str(asset["asset_name"])
        tar_path = out_dir / asset_name
        checksum_path = out_dir / str(asset["sha256_manifest"])
        image_lines: list[str] = []

        with tarfile.open(tar_path, "w") as tar:
            for image in asset.get("images", []):
                relative = Path(str(image["path"]))
                source = capture_root / relative
                if not source.exists():
                    raise FileNotFoundError(source)
                arcname = f"captures/{relative.as_posix()}"
                tar.add(source, arcname=arcname)
                image_lines.append(f"{_sha256(source)}  {arcname}")

        tar_sha = _sha256(tar_path)
        checksum_path.write_text("\n".join([*image_lines, f"{tar_sha}  {asset_name}", ""]), encoding="utf-8")
        packed.append(
            {
                "asset_name": asset_name,
                "path": str(tar_path),
                "sha256_manifest": str(checksum_path),
                "sha256": tar_sha,
                "bytes": tar_path.stat().st_size,
                "image_count": int(asset.get("image_count", 0)),
                "release_tag": asset.get("release_tag"),
            }
        )
    return packed
