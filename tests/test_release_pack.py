from __future__ import annotations

import json
from pathlib import Path
import tarfile

from smc.storage.release_pack import pack_release_assets


def test_pack_release_assets_creates_tar_and_checksums(tmp_path: Path) -> None:
    capture_root = tmp_path / "captures"
    image_dir = capture_root / "batch-a" / "images"
    image_dir.mkdir(parents=True)
    image = image_dir / "frame.jpg"
    image.write_bytes(b"jpeg-data")

    manifest = tmp_path / "release_shards.json"
    manifest.write_text(
        json.dumps(
            {
                "release_assets": [
                    {
                        "asset_name": "sf-r10-cell-tier1-p000.tar",
                        "sha256_manifest": "sf-r10-cell-tier1-p000.sha256",
                        "release_tag": "sf-test",
                        "image_count": 1,
                        "images": [{"path": "batch-a/images/frame.jpg"}],
                    }
                ]
            }
        )
    )

    packed = pack_release_assets(manifest, capture_root=capture_root, out_dir=tmp_path / "out")

    assert len(packed) == 1
    tar_path = Path(packed[0]["path"])
    assert tar_path.exists()
    assert Path(packed[0]["sha256_manifest"]).read_text().count("sha256") == 0
    with tarfile.open(tar_path) as tar:
        assert tar.getnames() == ["captures/batch-a/images/frame.jpg"]
