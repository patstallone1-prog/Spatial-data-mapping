"""The cloud's house batches get the maps and photo catalogues the filter reads.

Without them every region came back ``missing_input`` and batches 1-2 "succeeded" having
screened nothing (2026-10-28); batch 3 then crashed pruning an output that was never made."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from smc.cloud.checkpoint import get_pointer, pull_tree
from smc.cloud.migrate import migrate_house_inputs
from smc.cloud.stages import house_batch, house_input_paths
from smc.cloud.store import LocalStore

ROOT = Path(__file__).resolve().parents[1]


def test_a_house_batch_restores_the_house_inputs():
    spec = house_batch(4, 24, "house:batch-00003")
    assert "house-inputs" in spec.shared
    assert house_input_paths("sf-mission") == [
        "docs/app-regions/sf-mission/sf-corridor-3d.json",
        "docs/app-regions/sf-mission/sf-corridor-terrain.json",
        "docs/app-regions/sf-mission/sf-corridor-terrain.bin",
        "data/regions/sf-mission/catalog/observations"]
    assert house_input_paths("sf-corridor")[0] == "docs/sf-corridor-3d.json"


def test_the_house_inputs_carry_only_the_open_providers_rows(tmp_path):
    root = tmp_path / "repo"
    page = root / "docs/app-regions/sf-mission/sf-corridor-3d.json"
    page.parent.mkdir(parents=True)
    page.write_text("{}")
    catalog = root / "data/regions/sf-mission/catalog/observations"
    catalog.mkdir(parents=True)
    pq.write_table(pa.table({"provider": ["mapillary", "pandaset", "kartaview", "panoramax"],
                             "observation_uid": ["a", "b", "c", "d"]}),
                   catalog / "external-000.parquet")
    store = LocalStore(tmp_path / "private")
    row = migrate_house_inputs(store, root, regions=("sf-mission", "sf-sunset"))
    assert row["missing"] == ["sf-sunset"] and row["rows_left_out"] == 1
    pointer = get_pointer(store, "shared-house-inputs")
    assert pointer["tree"] == row["tree"]
    assert "data/regions/sf-mission/catalog/observations" in pointer["paths"]
    # The source catalogue is untouched; the uploaded copy has no PandaSet row.
    assert pq.read_table(catalog / "external-000.parquet").num_rows == 4
    restored = tmp_path / "restored"
    pull_tree(store, row["tree"], restored)
    kept = pq.read_table(restored / "data/regions/sf-mission/catalog/observations/external-000.parquet")
    assert kept.column("provider").to_pylist() == ["mapillary", "kartaview", "panoramax"]


def test_a_filter_with_no_region_inputs_fails_loudly(tmp_path):
    run = subprocess.run(
        [sys.executable, "scripts/filter_frontage_photos.py", "--data-root", str(tmp_path),
         "--regions", "nowhere-a", "nowhere-b", "--sample", "4", "--output", str(tmp_path / "out")],
        cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert run.returncode != 0
    assert "no region has its map and photo catalogue: nowhere-a, nowhere-b" in run.stderr
