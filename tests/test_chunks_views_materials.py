"""Fit tiles and the asset map; every photograph of a house kept together; materials laid over."""

from __future__ import annotations

import json
import runpy
import subprocess
from pathlib import Path

import pytest

from smc.facades.view_store import ViewStore
from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def _review(folder: Path, key: str, status: str, captured: str) -> Path:
    path = folder / f"{key}.json"
    row = {"region": "sf-mission", "building_id": "42", "status": status, "pixel_sha256": f"px-{key}",
           "address": {"formatted": "1 Test St"},
           "candidate": {"observation": {"observation_uid": key, "provider": "mapillary",
                                         "captured_at": captured, "longitude": -122.4, "latitude": 37.7},
                         "camera": {"focal_px": 900}, "wall": {"a": [0, 0], "b": [7, 0]},
                         "pose_status": "provider_solved", "rank": [1, 1.0]}}
    path.write_text(json.dumps(row))
    for suffix in (".jpg", ".labels.png", ".context.jpg"):
        path.with_suffix(suffix).write_bytes(b"pixels")
    return path


def test_every_screened_photograph_of_a_house_is_filed_with_the_others(tmp_path: Path) -> None:
    review = tmp_path / "review"
    review.mkdir()
    store = ViewStore(tmp_path / "views")
    a = _review(review, "sf-mission-42-aaaa", "screened_candidate_needs_privacy_and_identity_review", "2023-05-01")
    b = _review(review, "sf-mission-42-bbbb", "verified", "2021-02-01")
    c = _review(review, "sf-mission-42-cccc", "pixel_rejected", "2022-01-01")
    for path in (a, b, c):
        store.file(json.loads(path.read_text()), path)
    assert store.file(json.loads(a.read_text()), a) is False, "filed once"
    folder = tmp_path / "views" / "sf-mission" / "42"
    manifest = json.loads((folder / "manifest.json").read_text())
    assert manifest["view_count"] == 2 and [v["key"] for v in manifest["views"]] == [
        "sf-mission-42-bbbb", "sf-mission-42-aaaa"], "in the order they were taken; the rejected left out"
    view = manifest["views"][0]
    assert view["full_frame_pixel_sha256"] == "px-sf-mission-42-bbbb" and view["camera"] == {"focal_px": 900}
    assert set(view["files"]) == {"jpg", "labels.png", "context.jpg"}
    assert (folder / "sf-mission-42-bbbb.jpg").stat().st_ino == b.with_suffix(".jpg").stat().st_ino, "linked"


def test_a_house_without_its_own_material_takes_the_one_read_off_its_photographs(tmp_path: Path) -> None:
    m = runpy.run_path(str(ROOT / "scripts/match_frontage_facades.py"))
    (tmp_path / "materials.json").write_text(json.dumps({"houses": {
        "sf-mission:1": {"class": "wood_siding", "p": 0.61, "basis": "image_clip_zero_shot_scanned_views"},
        "sf-mission:2": {"class": "brick", "p": 0.7}, "sf-mission:3": {"class": None}}}))
    fits = {"1": {"region": "sf-mission", "appearance": {"colour": "#fff", "material": "unknown"}},
            "2": {"region": "sf-mission", "appearance": {"material": "stucco_render"}},
            "3": {"region": "sf-mission", "appearance": {}}}
    out = m["with_materials"](tmp_path, fits)
    assert out["1"]["appearance"]["material"] == "wood_siding" and out["1"]["appearance"]["colour"] == "#fff"
    assert out["2"]["appearance"]["material"] == "stucco_render", "a fit's own reading stands"
    assert "material" not in out["3"]["appearance"]


def _fit(key: str, region: str, lon: float, lat: float) -> dict:
    return {"building_id": key, "region": region, "a": [lon, lat], "b": [lon + 0.0001, lat],
            "canonical_footprint": [[lon, lat], [lon + 0.0001, lat], [lon + 0.0001, lat + 0.0001]],
            "openings": [{"id": "o", "kind": "window", "role": "window", "u": 1, "v": 3, "w": 1, "h": 1.5,
                          "opening_reasoning": {"big": "x" * 500}, "image_edge_support": {"y": 1},
                          "design": {"vertical_bars": [0.5], "panel_lines": {"horizontal": [], "vertical": [],
                                                                             "noise": 1}}}],
            "opening_decisions": ["x" * 1000], "neighbourhood_reference": {"z": "y" * 1000},
            "details": [{"kind": "canopy", "render": False}, {"kind": "balcony", "render": True}],
            "certainty": {"tier": "medium", "ai_review_required": True, "front": "x"}}


def test_the_fits_are_cut_to_what_the_page_draws_and_filed_in_immutable_tiles(tmp_path: Path) -> None:
    m = runpy.run_path(str(ROOT / "tools/tile_frontage_fits.py"))
    m["tile"].__globals__["DOCS"] = tmp_path
    fits = {"1": _fit("1", "sf-mission", -122.415, 37.755), "2": _fit("2", "sf-mission", -122.4149, 37.7551),
            "3": _fit("3", "sf-sunset", -122.49, 37.75)}
    manifest = m["tile"](fits)
    assert manifest["houses"] == 3 and len(manifest["tiles"]) == 2
    tile = next(t for t in manifest["tiles"] if t["region"] == "sf-mission")
    body = json.loads((tmp_path / tile["path"]).read_text())
    house = body["buildings"]["1"]
    assert "opening_decisions" not in house and "neighbourhood_reference" not in house
    assert "opening_reasoning" not in house["openings"][0] and house["openings"][0]["design"]["vertical_bars"] == [0.5]
    assert "panel_lines" not in house["openings"][0]["design"], "empty panel lines go"
    assert [d["kind"] for d in house["details"]] == ["balcony"] and house["certainty"] == {
        "tier": "medium", "ai_review_required": True}
    assert tile["sha256"][:12] in tile["path"], "named by its content"
    # A change makes a new tile; the old one leaves the site's copy.
    fits["1"]["height_m"] = 9.0
    again = m["tile"](fits)
    new = next(t for t in again["tiles"] if t["region"] == "sf-mission")
    assert new["path"] != tile["path"] and not (tmp_path / tile["path"]).exists()


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_page_loads_only_its_own_tiles_and_follows_the_asset_map() -> None:
    js = _page_js()
    script = "\n".join([
        """
        const location = { href: "https://site.test/app-regions/sf-mission/app-model.html", origin: "https://site.test" };
        const DATA = { bbox: { west: -122.43, east: -122.40, south: 37.74, north: 37.77 } };
        const LIGHT_SPEC = null;
        const sharedAsset = (name) => new URL(name, "https://site.test/").href;
        const asked = [];
        globalThis.fetch = async (url) => { asked.push(String(url));
          if (String(url).endsWith("manifest.json")) return { ok: true, json: async () => ({ tiles: [
            { path: "fits/sf-mission/a.json", bbox: [-122.42, 37.75, -122.41, 37.76] },
            { path: "fits/sf-sunset/b.json", bbox: [-122.50, 37.75, -122.49, 37.76] } ] }) };
          return { ok: true, json: async () => ({ buildings: { [String(url).includes("a.json") ? "1" : "2"]: {} } }) }; };
        """,
        "async " + _extract("loadFrontageFits", js).removeprefix("async "),
        "let ASSET_MAP = null;",
        _extract("viaStore", js),
        """
        (async () => {
          const fits = await loadFrontageFits();
          const plain = viaStore("https://site.test/app-regions/sf-mission/sf-corridor-3d.json");
          ASSET_MAP = { base: "https://storage.googleapis.com/bucket", files: {
            "app-regions/sf-mission/sf-corridor-3d.json": "chunks/abc.json" } };
          const stored = viaStore("https://site.test/app-regions/sf-mission/sf-corridor-3d.json");
          const other = viaStore("https://site.test/app-regions/sf-mission/regions.json");
          console.log(JSON.stringify({ houses: Object.keys(fits.buildings), asked, plain, stored, other }));
        })();
        """,
    ])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    assert result["houses"] == ["1"] and not any("sf-sunset" in u for u in result["asked"])
    assert result["plain"].startswith("https://site.test/")
    assert result["stored"] == "https://storage.googleapis.com/bucket/chunks/abc.json"
    assert result["other"] == "https://site.test/app-regions/sf-mission/regions.json"
