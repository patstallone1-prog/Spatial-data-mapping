"""The home screen: up at once on a still of the world, the world loading out of sight behind it."""
import itertools
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDERER = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()


def test_home_opens_before_the_world_streams_in():
    opens = RENDERER.index("home.openHome({ ...homeContext(), account })")
    streaming = RENDERER.index('await import(sharedAsset("world-streaming.mjs')
    assert opens < streaming


def test_world_is_staged_behind_the_home_screen():
    # The camera goes to where Explore world lands while the lobby is up, so its detail streams.
    assert "if (document.body.classList.contains(\"home-open\")) stageWorld();" in RENDERER
    body = RENDERER[RENDERER.index("function stageWorld()"):]
    body = body[:body.index("\n}\n")]
    assert "applySpawn()" in body and "ARRIVAL_DIST" in body
    # Explore world takes the same placement, so a staged world does not move again.
    assert "if (enter) WORLD_READY.then(stageWorld)" in RENDERER


def test_app_shell_uncovers_the_model_for_its_home_screen():
    for path in ("tools/app_template.html", "docs/app.html"):
        page = (ROOT / path).read_text()
        assert 'w.document.getElementById("home")' in page
        assert "if ((done || home) && !completed)" in page
        assert "body.model-home:has(#v-map.on) nav.tabs { display: none; }" in page
    assert 'postMessage({ kerbside: "home", open }, location.origin)' in RENDERER


def test_first_install_does_not_reopen_the_loading_world():
    for path in ("tools/pwa/sw.js", "docs/sw.js"):
        worker = (ROOT / path).read_text()
        assert "upgrade = old.length > 0;" in worker
        assert '(upgrade ? self.clients.matchAll({ type: "window" }) : [])' in worker


def test_no_way_into_the_world_until_it_is_loaded_through():
    # Drawn is not loaded: the lobby waits for everything round the spawn, held for a moment.
    assert "whenReady: () => WORLD_LOADED," in RENDERER
    waiting = RENDERER[RENDERER.index("function worldLoadWaiting()"):]
    waiting = waiting[:waiting.index("\n}\n")]
    for need in ("attaching || attachWanted", "activeGuest && !activeGuest.ready", "cells.active || cells.queued",
                 "tileInFlight || tileQueue.length", "facadeQueue.length || facadeInFlight",
                 "demoCharacterLoaded === undefined", "!catalogueSettled"):
        assert need in waiting, need
    assert "now - settledSince >= SETTLED_FOR_MS" in RENDERER
    # The lobby opens long before the page's end: the promise it waits on must exist by then.
    assert RENDERER.index("const WORLD_LOADED = new Promise") < RENDERER.index("home.openHome({ ...homeContext()")
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    assert "if (!open || !loaded) return false;" in lobby
    # Every button that leaves the lobby for the world waits with it, and says so.
    leaving = [line for line in lobby.splitlines() if "closeHome(" in line and "function closeHome" not in line]
    assert len(leaving) >= 5
    for line in leaving:
        assert ("needs-world" in line or "e.key === \"Enter\"" in line or "close: () =>" in line
                or "if (loaded) { closeHome(true)" in line or "if (loading)" in line), line
    assert 'root.classList.remove("world-loading")' in lobby


def test_enter_world_goes_in_or_to_the_loading_screen():
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    # One big way in, never disabled: in at once when ready, else the loading screen, which goes
    # in by itself once the world is loaded.
    assert '"Enter world"' in lobby and '"Explore world"' not in lobby
    go = next(line for line in lobby.splitlines() if '"Enter world"' in line)
    assert "aria-disabled" not in go and "needs-world" not in go and "enter()" in go
    enter = lobby[lobby.index("function enter()"):]
    enter = enter[:enter.index("\n  }\n")]
    assert "if (loaded) { closeHome(true); return; }" in enter and "loadscreen" in enter
    assert "if (loading) setTimeout(() => closeHome(true)" in lobby
    # The bar is drawn every frame toward the world's fraction, and says how far it is.
    assert "loading.frame = requestAnimationFrame(drawBar)" in lobby and "loading.pct.textContent" in lobby
    assert "fraction: loadFraction" in RENDERER


def _load_fraction(script):
    """Run the page's loadFraction on a fake clock and progress line."""
    code = RENDERER[RENDERER.index("const BOOT_STAGES"):RENDERER.index("window.kerbsideLoadFraction")]
    prelude = """
let clock = 0, line = "", worldReadyNow = false, worldLoadedNow = false, waiting = [];
const performance = { now: () => clock };
const document = { getElementById: () => ({ textContent: line }) };
const worldLoadWaiting = () => waiting;
"""
    out = subprocess.run(["node", "-e", prelude + code + script], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_the_loading_bar_moves_evenly_through_the_build():
    # The stages as an app boot ran them (2026-11-03), sampled every quarter second.
    seen = _load_fraction("""
const timeline = [[0, "Loading the corridor…"], [9000, "Building the streets: 40%"], [11000, "Building the streets: 90%"],
  [13000, "Standing the streets on the ground: 10%"], [18000, ""], [19000, "Standing the ground cover on the hill: 5%"],
  [22000, "Standing the streets on the ground: 60%"], [27000, "Setting the pads on the pavement"],
  [27500, "Painting the crossings and lanes on the road"]];
const out = [];
for (clock = 0; clock <= 40000; clock += 250) {
  for (const [at, text] of timeline) if (clock >= at) line = text;
  if (clock === 31000) { worldReadyNow = true; waiting = ["map cells (12)"]; }
  if (clock === 34000) waiting = ["map cells (3)"];
  if (clock === 38000) worldLoadedNow = true;
  out.push(loadFraction());
}
process.stdout.write(JSON.stringify(out));
""")
    steps = [b - a for a, b in itertools.pairwise(seen)]
    assert min(steps) >= 0                          # never back
    assert max(steps[:-1]) < 0.06                   # no jumps: under 6% in a quarter second
    assert seen[4 * 8] > 0.12                       # the fetch moves the bar, no figure needed
    assert 0.7 <= seen[4 * 30] <= 0.8               # most of the bar is the build before the first frame
    assert seen[-1] == 1


def test_the_loading_bar_is_readable_before_the_build_reaches_the_page_end():
    # The lobby opens early and polls: its state must exist before the home screen opens, or the
    # read throws and the bar stands still for the whole build.
    assert RENDERER.index("function loadFraction()") < RENDERER.index("home.openHome({ ...homeContext(), account })")
    assert RENDERER.index("const bootLoad =") < RENDERER.index("home.openHome({ ...homeContext(), account })")


def test_the_home_screen_is_a_still_of_the_world_not_the_world_loading():
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    assert "backdrop-filter" not in lobby          # nothing of the loading world shows through
    assert "var(--shot,none) center/cover" in lobby
    names = re.findall(r'\["([a-z-]+)", "[^"]+"\]', lobby[lobby.index("export const HOME_SHOTS"):lobby.index("const SHOT_KEY")])
    assert len(names) == 10
    for name in names:
        shot = ROOT / "docs/home-shots" / f"{name}.jpg"
        assert shot.is_file() and shot.stat().st_size < 600_000, name
    # The next still each opening, wrapping round.
    out = subprocess.run(["node", "--input-type=module", "-e", f"""
      import {{ nextShot, HOME_SHOTS }} from {json.dumps((ROOT / "docs/home-lobby.mjs").as_uri())};
      const kept = new Map(); const storage = {{ getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) }};
      const seen = Array.from({{ length: HOME_SHOTS.length + 2 }}, () => nextShot(storage));
      console.log(JSON.stringify(seen));"""], capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]


def test_everyone_has_a_name_from_the_start_and_can_change_it():
    """A name is picked for someone who has none, kept on the device, and theirs to change;
    clearing it picks another rather than leaving them nameless."""
    script = """
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.location = { hash: "", pathname: "/", search: "" };
globalThis.history = { replaceState() {} };
const m = await import(process.argv[1]);
const first = m.account().name;
m.setName("  Larry  ");
const chosen = m.account().name, stored = store.get("kerbside:player-name");
m.setName("");
const cleared = m.account().name;
let seq = [0, 0, 0.999];
const fixed = m.autoName(() => seq.shift());
console.log(JSON.stringify({ first, stored, chosen, cleared, fixed }));
"""
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script, (ROOT / "docs/kerbside-account.mjs").as_uri()],
                                    capture_output=True, text=True, check=True).stdout)
    assert re.fullmatch(r"[A-Z][a-z]+ [A-Z][a-z]+( [A-Z][a-z]+)? \d{2}", out["first"]), out
    assert out["chosen"] == "Larry" and out["stored"] == "Larry"
    assert out["cleared"] and out["cleared"] != "Larry"
    assert out["fixed"] == "Coral Heron 99"
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    assert 'player.addEventListener("click", nameSheet);' in lobby and "Pick another name" in lobby


def test_a_device_makes_its_own_account_and_the_owner_verifies_it_on_the_backend():
    """No sign-in and no code: the device's secret is made once and kept, registered under its
    name, and verified only by the store's answer (the owner ticks it on the backend)."""
    script = """
const store = new Map(), calls = [];
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.location = { hash: "", pathname: "/", search: "" };
globalThis.history = { replaceState() {} };
globalThis.document = {};
let verified = false;
globalThis.fetch = async (url, init) => {
  const name = url.split("/rpc/")[1], body = JSON.parse(init.body);
  calls.push([name, Object.keys(body).sort()]);
  const out = name === "kerbside_register_device" ? { registered: true, verified, name: body.name }
    : name === "kerbside_editor_whoami" ? { registered: true, verified, name: "Larry" } : null;
  return { ok: true, status: 200, text: async () => JSON.stringify(out) };
};
const m = await import(process.argv[1]);
await new Promise((r) => setTimeout(r, 20));
const secret = store.get("kerbside:editor-key");
const before = m.account();
verified = true;                       // the owner ticks the account in the dashboard
const after = await m.recheck();
console.log(JSON.stringify({ secret: secret?.length, kept: store.get("kerbside:editor-key") === secret, before, after,
  calls, exports: Object.keys(m).sort() }));
"""
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script, (ROOT / "docs/kerbside-account.mjs").as_uri()],
                                    capture_output=True, text=True, check=True).stdout)
    assert out["secret"] >= 40 and out["kept"]
    assert out["before"]["registered"] and not out["before"]["verified"]
    assert out["after"]["verified"] and out["after"]["editor"] == "Larry"
    assert out["calls"][0] == ["kerbside_register_device", ["key", "name"]]
    assert "verify" not in out["exports"] and "signOutEditor" not in out["exports"]
    sql = (ROOT / "supabase/kerbside_device_accounts.sql").read_text()
    assert "insert into kerbside_editors (key_sha256, name, verified, last_seen) values (digest_hex, btrim(clean), false, now());" in sql
    assert "grant execute on function kerbside_register_device(text, text) to anon, authenticated;" in sql


def test_the_owner_verifies_an_account_by_its_name():
    import importlib.util
    spec = importlib.util.spec_from_file_location("editor_accounts", ROOT / "scripts/editor_accounts.py")
    accounts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accounts)
    assert accounts.verify_line("Coral Heron 47") == "update kerbside_editors set verified = true where name = 'Coral Heron 47';"
    assert accounts.verify_line("O'Hara Otter 12", False) == "update kerbside_editors set verified = false where name = 'O''Hara Otter 12';"
