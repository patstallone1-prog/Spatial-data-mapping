#!/usr/bin/env python3
"""Validate and register immutable source/flight manifests and image pixels.

Examples:
  python scripts/register_reconstruction_source.py flight \
    --acquisition acquisition.json --flight flight.json --assets assets/*.json \
    --catalog-root build/source-catalog
  python scripts/register_reconstruction_source.py image \
    --asset frame.json --image frame.tif --catalog-root build/source-catalog \
    --gcs gs://my-private-bucket/kerbside
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.reconstruction.pixel_store import GcsBlobStore, LocalBlobStore, PixelCatalog
from smc.reconstruction.provenance import (
    AcquisitionManifest,
    FlightManifest,
    SourceAsset,
    validate_flight_bundle,
)


def _read(model: type, path: Path):
    return model.model_validate_json(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    flight = commands.add_parser("flight", help="register a complete ordered flight/sequence")
    flight.add_argument("--acquisition", type=Path, required=True)
    flight.add_argument("--flight", type=Path, required=True)
    flight.add_argument("--assets", type=Path, nargs="+", required=True)
    flight.add_argument("--catalog-root", type=Path, required=True)
    other = commands.add_parser("asset", help="register non-image asset provenance")
    other.add_argument("--asset", type=Path, required=True)
    other.add_argument("--file", type=Path, required=True)
    other.add_argument("--catalog-root", type=Path, required=True)
    image = commands.add_parser("image", help="register image pixels and their source aliases")
    image.add_argument("--asset", type=Path, required=True)
    image.add_argument("--image", type=Path, required=True)
    image.add_argument("--catalog-root", type=Path, required=True)
    image.add_argument("--gcs", help="gs://bucket/optional-prefix for large pixel blobs")
    schema = commands.add_parser("schema", help="print a public JSON schema")
    schema.add_argument("kind", choices=("asset", "acquisition", "flight"))
    args = parser.parse_args()

    if args.command == "schema":
        models = {"asset": SourceAsset, "acquisition": AcquisitionManifest,
                  "flight": FlightManifest}
        print(json.dumps(models[args.kind].model_json_schema(), indent=2))
        return 0

    if args.command == "flight":
        acquisition = _read(AcquisitionManifest, args.acquisition)
        manifest = _read(FlightManifest, args.flight)
        assets = [_read(SourceAsset, path) for path in args.assets]
        validate_flight_bundle(acquisition, manifest, assets)
        root = args.catalog_root / "manifests"
        acquisition.write_immutable(root / "acquisitions" / f"{acquisition.acquisition_id}.json")
        manifest.write_immutable(root / "flights" / f"{manifest.flight_id}.json")
        print(json.dumps({"flight_id": manifest.flight_id, "frames": len(manifest.frame_asset_ids),
                          "overlap_edges": len(manifest.overlap_edges)}))
        return 0

    if args.command == "asset":
        record = _read(SourceAsset, args.asset)
        if record.kind in {"aerial_frame", "street_frame", "orthomosaic", "satellite"}:
            parser.error("image assets must use the image command for pixel deduplication")
        digest = hashlib.sha256()
        size = 0
        with args.file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        if size != record.raw_size_bytes or digest.hexdigest() != record.raw_sha256:
            raise ValueError("source raw byte checksum or length mismatch")
        record.write_immutable(args.catalog_root / "manifests" / "assets" /
                               f"{record.asset_id}.json")
        print(json.dumps({"asset_id": record.asset_id, "kind": record.kind}))
        return 0

    if args.gcs:
        if not args.gcs.startswith("gs://"):
            parser.error("--gcs must be gs://bucket/optional-prefix")
        bucket, _, prefix = args.gcs[5:].partition("/")
        blobs = GcsBlobStore(bucket, prefix)
    else:
        blobs = LocalBlobStore(args.catalog_root / "blobs")
    catalog = PixelCatalog(args.catalog_root / "catalog.sqlite3", blobs,
                           args.catalog_root / "manifests")
    result = catalog.register(_read(SourceAsset, args.asset), args.image)
    print(json.dumps({"asset_id": result.asset_id, "pixel_sha256": result.pixel_sha256,
                      "aliases": len(catalog.aliases_for(result.pixel_sha256))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
