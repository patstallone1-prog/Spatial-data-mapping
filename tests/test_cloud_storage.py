"""Content-addressed checkpoints, the publisher's releases, and the viewer reading them."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from smc.cloud.checkpoint import cas_key, pull_tree, push_tree, read_tree
from smc.cloud.publish import Publisher
from smc.cloud.selftest import _Public
from smc.cloud.store import LocalStore, PreconditionFailed

ROOT = Path(__file__).resolve().parents[1]


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def test_a_tree_round_trips_sends_each_file_once_and_follows_a_linked_cell(tmp_path):
    store = LocalStore(tmp_path / "bucket")
    drive = tmp_path / "drive/cell"
    write(drive / "ingest.json", '{"stages": {}}')
    write(drive / "site/payload.json", "x" * 1000)
    write(drive / "lidar-cache/tile.laz", "cached")
    src = tmp_path / "src"
    (src / "data/regions").mkdir(parents=True)
    (src / "data/regions/cell").symlink_to(drive)
    first = push_tree(store, src, ["data/regions/cell"])
    assert first.files == 2 and first.bytes_sent == first.bytes_total  # the cache is left out
    again = push_tree(store, src, ["data/regions/cell"])
    assert again.tree == first.tree and again.bytes_sent == 0
    dst = tmp_path / "dst"
    got = pull_tree(store, first.tree, dst)
    assert got.bytes_received == first.bytes_total
    assert (dst / "data/regions/cell/site/payload.json").read_text() == "x" * 1000
    # Restoring again moves nothing; a leftover from a failed attempt is removed.
    write(dst / "data/regions/cell/leftover.json", "partial")
    assert pull_tree(store, first.tree, dst).bytes_received == 0
    assert not (dst / "data/regions/cell/leftover.json").exists()


def test_a_corrupt_object_is_never_restored(tmp_path):
    store = LocalStore(tmp_path / "bucket")
    write(tmp_path / "src/a/f.json", "good")
    tree = push_tree(store, tmp_path / "src", ["a"]).tree
    sha = read_tree(store, tree)["files"]["a/f.json"][0]
    (store.root / cas_key(sha)).write_text("bad!")
    with pytest.raises(ValueError, match="expected"):
        pull_tree(store, tree, tmp_path / "dst")
    assert not (tmp_path / "dst/a/f.json").exists()


def test_conditional_writes_are_exclusive(tmp_path):
    store = LocalStore(tmp_path / "b")
    etag = store.put("p", b"1", if_none_match=True)
    with pytest.raises(PreconditionFailed):
        store.put("p", b"2", if_none_match=True)
    store.put("p", b"2", if_match=etag)
    with pytest.raises(PreconditionFailed):
        store.put("p", b"3", if_match=etag)


def cell(tmp_path, name, payload="{}"):
    base = tmp_path / "cells" / name
    write(base / "site/sf-corridor-3d.json", payload)
    write(base / "site/sf-corridor-ground.json", '{"trees": []}')
    return base


PASS = {"decision": "pass"}


def test_releases_are_incremental_verified_and_roll_back(tmp_path):
    store = LocalStore(tmp_path / "public")
    answers = {"ok": True}
    pub = Publisher(store, "https://assets.example", answers=lambda url: answers["ok"])
    with pytest.raises(PermissionError):
        pub.publish_cell("a", cell(tmp_path, "a"), gate={"decision": "hold"})
    one = pub.publish_cell("a", cell(tmp_path, "a", '{"a": 1}'), gate=PASS, tree="t1")
    two = pub.publish_cell("b", cell(tmp_path, "b", '{"b": 1}'), gate=PASS, tree="t2")
    assert one["files"] == 2 and two["parent"] == one["version"]
    live = pub.current()
    assert set(live["cells"]) == {"a", "b"} and "regions/a/sf-corridor-3d.json" in live["files"]
    # Republishing an unchanged cell changes nothing.
    assert not pub.publish_cell("b", cell(tmp_path, "b", '{"b": 1}'), gate=PASS, tree="t2")["changed"]
    # A cell whose chunks do not answer publicly is not released.
    answers["ok"] = False
    with pytest.raises(RuntimeError, match="not moved"):
        pub.publish_cell("c", cell(tmp_path, "c", '{"c": 1}'), gate=PASS)
    assert pub.current()["version"] == two["version"]
    answers["ok"] = True
    back = pub.rollback(reason="test")
    assert back == {"from": two["version"], "to": one["version"]}
    assert set(pub.current()["cells"]) == {"a"}


def test_two_publishers_racing_both_land(tmp_path):
    store = LocalStore(tmp_path / "public")
    pub = Publisher(store, "https://assets.example", answers=lambda url: True)
    pub.publish_cell("a", cell(tmp_path, "a", '{"a": 1}'), gate=PASS)
    real_move = pub._move_pointer
    calls = {"n": 0}

    def racing(release, etag, pointer):
        # The first time, another publisher moves the pointer between our read and our write.
        if calls["n"] == 0:
            calls["n"] += 1
            other = Publisher(store, "https://assets.example", answers=lambda url: True)
            other.publish_cell("b", cell(tmp_path, "b", '{"b": 1}'), gate=PASS)
        return real_move(release, etag, pointer)

    pub._move_pointer = racing
    pub.publish_cell("c", cell(tmp_path, "c", '{"c": 1}'), gate=PASS)
    assert set(pub.current()["cells"]) == {"a", "b", "c"}


def test_withdrawing_a_cell_keeps_the_rest(tmp_path):
    pub = Publisher(LocalStore(tmp_path / "public"), "https://x", answers=lambda url: True)
    pub.publish_cell("a", cell(tmp_path, "a", "1"), gate=PASS)
    pub.publish_cell("b", cell(tmp_path, "b", "2"), gate=PASS)
    assert pub.withdraw_cell("a", "test")["changed"]
    assert set(pub.current()["cells"]) == {"b"}
    assert not any(k.startswith("regions/a/") for k in pub.current()["files"])


def _render_function(name: str) -> str:
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    start = source.index(f"function {name}(")
    depth, i = 0, source.index("{", start)
    while True:
        depth += {"{": 1, "}": -1}.get(source[i], 0)
        i += 1
        if depth == 0:
            return source[start:i]


def test_the_viewer_reads_a_released_cell_from_the_public_origin(tmp_path):
    """The renderer's own ``viaStore`` (extracted from the page source), given a release as its
    asset map, sends the page's request for a cell's payload to the public origin, and the bytes
    that come back are the cell's."""
    if not shutil.which("node"):
        pytest.skip("node is needed to run the renderer's lookup")
    store = LocalStore(tmp_path / "public")
    handler = partial(_Public, directory=str(store.root))
    _Public.store = store
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        payload = json.dumps({"ways": [{"kind": "building", "osm_id": 1}]})
        pub = Publisher(store, base)
        pub.publish_cell("gap-p1", cell(tmp_path, "gap-p1", payload), gate=PASS)
        release = pub.current()
        script = f"""
const location = {{ href: "https://kerbside.example/app-regions/gap-p1/app-model.html",
                    origin: "https://kerbside.example" }};
const ASSET_MAP = {json.dumps(release)};
{_render_function("viaStore")}
const url = viaStore(new URL("../../regions/gap-p1/sf-corridor-3d.json", location.href).href);
const r = await fetch(url);
console.log(JSON.stringify({{ url, status: r.status, cors: r.headers.get("access-control-allow-origin"),
  type: r.headers.get("content-type"), body: await r.text() }}));
"""
        out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script],
                                        capture_output=True, text=True, check=True).stdout)
        assert out["url"].startswith(f"{base}/chunks/")
        assert out["status"] == 200 and out["cors"] == "*" and out["type"] == "application/json"
        assert hashlib.sha256(out["body"].encode()).hexdigest() == hashlib.sha256(payload.encode()).hexdigest()
    finally:
        server.shutdown()


def test_a_file_that_vanishes_mid_push_is_left_out_of_the_tree(tmp_path) -> None:
    """The house run is still being written while it is uploaded: a file moved on between the
    walk and the upload must not leave the tree naming an object the store doesn't have."""
    from smc.cloud.checkpoint import push_tree, read_tree
    from smc.cloud.store import LocalStore

    root = tmp_path / "src"
    (root / "run").mkdir(parents=True)
    (root / "run" / "keep.json").write_text('{"a": 1}')
    (root / "run" / "review.json").write_text('{"b": 2}')
    store = LocalStore(tmp_path / "store")
    real = store.put_file

    def put_file(key, path, **kw):
        if Path(path).name == "review.json":
            Path(path).unlink()
            raise FileNotFoundError(path)
        return real(key, path, **kw)

    store.put_file = put_file
    stats = push_tree(store, root, ["run"])
    tree = read_tree(store, stats.tree)
    assert sorted(tree["files"]) == ["run/keep.json"] and stats.files == 1


def test_a_carried_folder_is_not_fetched_and_stays_referenced(tmp_path) -> None:
    from smc.cloud.checkpoint import carry_forward, pull_tree, push_tree, read_tree
    from smc.cloud.store import open_store

    store = open_store(str(tmp_path / "store"))
    src = tmp_path / "src"
    (src / "run/pixels").mkdir(parents=True)
    (src / "run/journal.json").write_text("{}")
    (src / "run/pixels/old.bin").write_bytes(b"x" * 1000)
    base = push_tree(store, src, ["run"]).tree
    work = tmp_path / "work"
    pulled = pull_tree(store, base, work, carry=("run/pixels",))
    assert (work / "run/journal.json").exists() and not (work / "run/pixels/old.bin").exists()
    assert pulled.files == 1
    (work / "run/pixels").mkdir(parents=True)
    (work / "run/pixels/new.bin").write_bytes(b"y" * 10)
    saved = push_tree(store, work, ["run"]).tree
    merged = carry_forward(store, saved, base, ("run/pixels",))
    assert set(read_tree(store, merged.tree)["files"]) == {"run/journal.json", "run/pixels/old.bin", "run/pixels/new.bin"}
