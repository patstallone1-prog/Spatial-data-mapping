"""The asset map is read a region at a time (smc.renderer.pages.write_asset_shards, module 00).

The whole map is 444,000 names -- 47 MB of JSON, about 85 MB once parsed -- and the page read all
of it before it drew anything. The deploy splits it: an index of a few kilobytes, and one file a
region holding that region's names. These pin the split (nothing lost, nothing renamed) and the
page's side of it (the index at the start, a region's names when that region is first needed,
the same store addresses as the whole map gave)."""
import json
import subprocess
from pathlib import Path

from smc.renderer.pages import write_asset_shards

ROOT = Path(__file__).resolve().parents[1]


def test_the_split_holds_every_name_once_under_its_region(tmp_path):
    whole = {"schema": "kerbside.asset_map/1", "version": "abc123", "base": "/store", "origin": "https://cdn.test",
             "origins": ["https://site.test"],
             "files": {"regions/alpha/cells/a/1_2.json": "chunks/" + "a" * 24 + ".json",
                       "regions/alpha/facades/c01r02/x.bin": "chunks/" + "b" * 24 + ".bin",
                       "regions/beta/sf-corridor-ground.json": "chunks/" + "c" * 24 + ".json",
                       "shared/thing.json": "chunks/" + "d" * 24 + ".json"}}
    (tmp_path / "asset-map.json").write_text(json.dumps(whole))
    (tmp_path / "asset-map").mkdir()
    (tmp_path / "asset-map" / "gone.json").write_text("{}")   # a region no longer in the map
    assert write_asset_shards(tmp_path) == 2
    index = json.loads((tmp_path / "asset-map" / "index.json").read_text())
    assert index["regions"] == ["alpha", "beta"] and index["base"] == "/store" and index["version"] == "abc123"
    assert index["origins"] == ["https://site.test"] and index["files"] == {"shared/thing.json": "chunks/" + "d" * 24 + ".json"}
    assert not (tmp_path / "asset-map" / "gone.json").exists()
    back = dict(index["files"])
    for region in index["regions"]:
        for name, obj in json.loads((tmp_path / "asset-map" / f"{region}.json").read_text())["files"].items():
            back[f"regions/{region}/{name}"] = obj
    assert back == whole["files"]
    # Nothing to split is nothing written (a checkout without the map).
    assert write_asset_shards(tmp_path / "asset-map") == 0


def test_the_real_map_is_all_regions_and_its_index_is_small():
    source = ROOT / "docs/asset-map.json"
    files = json.loads(source.read_text())["files"]
    assert all(name.startswith("regions/") and name.count("/") >= 2 for name in files), "a name outside a region joins the index"
    ignore = (ROOT / ".gitignore").read_text()
    assert "/docs/asset-map/" in ignore, "the split is made at every deploy, never committed"


def test_the_page_reads_the_index_then_a_region_when_it_is_needed():
    boot = (ROOT / "src/smc/renderer/page/module/00-boot.js").read_text()
    block = boot[boot.index("const ASSET_BASE = ATTACH"):boot.index("const asset = (name) =>")]
    assert 'fetch("/asset-map.json"' not in boot
    script = """
const calls = [];
const A = 'chunks/' + 'a'.repeat(24) + '.json', B = 'chunks/' + 'b'.repeat(24) + '.json';
const docs = {
  '/asset-map/index.json': { base: '/store', version: 'v9', origins: ['https://site.test'], regions: ['alpha', 'beta'], files: {} },
  '/asset-map/alpha.json?v=v9': { files: { 'sf-corridor-ground.json': A } },
  '/asset-map/beta.json?v=v9': { files: { 'cells/x/1_2.json': B } },
};
globalThis.location = new URL('https://site.test/app-regions/alpha/app-model.html');
globalThis.document = { querySelector: () => ({ content: '../../regions/alpha' }) };
globalThis.fetch = async (input, init) => { const url = String(input); calls.push([url, init?.cache || null]);
  const doc = docs[url]; return { ok: Boolean(doc) || !url.startsWith('/asset-map/'), json: async () => doc, url }; };
const ATTACH = null;
""" + block + """
const out = { first: calls.map((c) => c[0]) };
// This page's own region was read before anything asked; its files are in the store.
out.own = viaStore('https://site.test/regions/alpha/sf-corridor-ground.json');
out.unknown = viaStore('https://site.test/regions/alpha/other.json');
out.elsewhere = viaStore('https://other.test/regions/alpha/sf-corridor-ground.json');
// Another region's file, asked for through fetch before its names are in: the names first.
out.before = viaStore('https://site.test/regions/beta/cells/x/1_2.json');
calls.length = 0;
const r = await fetch('https://site.test/regions/beta/cells/x/1_2.json', { cache: 'no-cache' });
out.fetched = calls.slice();
out.after = viaStore('https://site.test/regions/beta/cells/x/1_2.json');
calls.length = 0;
await fetch('https://site.test/regions/beta/cells/x/1_2.json'); await fetch('https://site.test/regions/gamma/x.json');
out.again = calls.map((c) => c[0]);
console.log(JSON.stringify(out));
"""
    done = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, cwd=ROOT)
    assert done.returncode == 0, done.stderr
    out = json.loads(done.stdout)
    a, b = "/store/chunks/" + "a" * 24 + ".json", "/store/chunks/" + "b" * 24 + ".json"
    assert out["first"] == ["/asset-map/index.json", "/asset-map/alpha.json?v=v9"], "the index, then only this page's region"
    assert out["own"] == a
    assert out["unknown"] == "https://site.test/regions/alpha/other.json", "a file the store does not have is the site's"
    assert out["elsewhere"] == "https://other.test/regions/alpha/sf-corridor-ground.json"
    assert out["before"] == "https://site.test/regions/beta/cells/x/1_2.json"
    # The region's names were read, then the file itself from the store, kept by the browser for good.
    assert out["fetched"] == [["/asset-map/beta.json?v=v9", None], [b, "force-cache"]]
    assert out["after"] == b
    # Read once: the same region again asks for no names; a region not in the map asks for none at all.
    assert out["again"] == ["https://site.test/regions/beta/cells/x/1_2.json", "https://site.test/regions/gamma/x.json"]
