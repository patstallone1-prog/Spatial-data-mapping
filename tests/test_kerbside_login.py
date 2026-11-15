"""Logging in to Kerbside: a username and password make a player the same account on every device.

The store side (supabase/kerbside_login.sql) runs here against a throwaway PostgreSQL when one is
installed, as the public ``anon`` role the page's key has; the page side (docs/kerbside-account.mjs)
runs against a stand-in store.
"""

from __future__ import annotations

import glob
import json
import shutil
import socket
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "supabase/kerbside_login.sql"
ACCOUNT = ROOT / "docs/kerbside-account.mjs"
A, B, C = "deviceAAAAAAAAAAAAAAAAAAAAAA", "deviceBBBBBBBBBBBBBBBBBBBBBB", "deviceCCCCCCCCCCCCCCCCCCCCCC"


def _pg_bin() -> Path | None:
    found = shutil.which("initdb")
    if found:
        return Path(found).parent
    for pattern in ("/Library/PostgreSQL/*/bin", "/usr/lib/postgresql/*/bin", "/opt/homebrew/opt/postgresql*/bin"):
        for path in sorted(glob.glob(pattern), reverse=True):
            if (Path(path) / "initdb").exists():
                return Path(path)
    return None


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    bin_dir = _pg_bin()
    if bin_dir is None:
        pytest.skip("PostgreSQL is not installed")
    data = tmp_path_factory.mktemp("pg") / "data"
    subprocess.run([bin_dir / "initdb", "-D", data, "-U", "kb", "-A", "trust"], check=True, capture_output=True)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    subprocess.run([bin_dir / "pg_ctl", "-D", data, "-w", "-l", data / "log", "-o",
                    f"-p {port} -c unix_socket_directories='' -c listen_addresses=127.0.0.1", "start"], check=True, capture_output=True)

    def sql(text: str, role: str | None = None) -> str:
        prefix = f"set role {role};\n" if role else ""
        out = subprocess.run([bin_dir / "psql", "-h", "127.0.0.1", "-p", str(port), "-U", "kb", "-d", "postgres",
                              "-tAq", "-v", "ON_ERROR_STOP=1"], input=prefix + text, capture_output=True, text=True)
        if out.returncode:
            raise RuntimeError(out.stderr)
        return out.stdout.strip()

    try:
        # What Supabase has: the two API roles, and pgcrypto in the extensions schema.
        sql("create role anon nologin; create role authenticated nologin; create schema extensions;"
            "create extension pgcrypto schema extensions; grant usage on schema extensions, public to anon, authenticated;")
        for name in ("kerbside_exterior_edits", "kerbside_device_accounts", "kerbside_login", "kerbside_login"):
            sql((ROOT / "supabase" / f"{name}.sql").read_text())   # the log-in file twice: safe to run again
        yield sql
    finally:
        subprocess.run([bin_dir / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True)


def _call(sql, fn: str, *args: str) -> dict:
    quoted = ", ".join("'" + a.replace("'", "''") + "'" for a in args)
    return json.loads(sql(f"select to_jsonb({fn}({quoted}));", role="anon"))


def test_an_account_is_made_once_and_logged_in_to_from_another_device(store):
    made = _call(store, "kerbside_sign_up", A, "Coral.Heron", "correct horse")
    assert made["ok"] and made["signed_in"] and made["username"] == "Coral.Heron" and not made["verified"]
    assert _call(store, "kerbside_sign_up", B, "coral.heron", "another one") == {"ok": False, "why": "that username is taken"}
    assert not _call(store, "kerbside_sign_up", B, "x", "correct horse")["ok"]
    assert not _call(store, "kerbside_sign_up", B, "okname", "short")["ok"]
    assert not _call(store, "kerbside_sign_up", "nope", "okname", "correct horse")["ok"]
    # A wrong password and an unknown name say the same thing.
    assert _call(store, "kerbside_sign_in", B, "coral.heron", "wrong") == _call(store, "kerbside_sign_in", B, "nobody", "wrong")
    assert _call(store, "kerbside_sign_in", B, "CORAL.HERON", "correct horse")["ok"]
    assert _call(store, "kerbside_account_of", A) == _call(store, "kerbside_account_of", B) == made["account"]
    assert store("select bool_and(password_hash like '$2a$10$%') from kerbside_accounts;") == "t"


def test_the_public_key_reaches_the_accounts_only_through_the_functions(store):
    for statement in ("select 1 from kerbside_accounts;", "select 1 from kerbside_login_attempts;",
                      "select kerbside_link_device('x', gen_random_uuid());", "select kerbside_login_state('x');"):
        with pytest.raises(RuntimeError, match="permission denied"):
            store(statement, role="anon")


def test_the_owner_verifies_an_account_and_its_devices_follow_while_logged_in(store):
    store("update kerbside_accounts set verified = true where lower(username) = 'coral.heron';")
    assert _call(store, "kerbside_editor_whoami", A)["verified"] and _call(store, "kerbside_editor_whoami", B)["verified"]
    renamed = _call(store, "kerbside_account_rename", A, "Larry")
    assert renamed["name"] == "Larry" and _call(store, "kerbside_editor_whoami", B)["name"] == "Larry"
    _call(store, "kerbside_sign_out", B)
    assert not _call(store, "kerbside_editor_whoami", B)["verified"], "logged out, the borrowed verification goes"
    assert _call(store, "kerbside_login_whoami", B) == {"ok": True, "signed_in": False}
    assert _call(store, "kerbside_editor_whoami", A)["verified"]
    # A device the owner verified on its own keeps that, in and out, whatever the account is.
    _call(store, "kerbside_register_device", C, "Own Device")
    store("update kerbside_editors set verified = true where name = 'Own Device'; update kerbside_accounts set verified = false;")
    assert not _call(store, "kerbside_editor_whoami", A)["verified"]
    assert _call(store, "kerbside_sign_in", C, "coral.heron", "correct horse")["verified"]
    _call(store, "kerbside_sign_out", C)
    assert _call(store, "kerbside_editor_whoami", C)["verified"]


def test_wrong_passwords_are_limited_and_the_owner_can_reset_one(store):
    import importlib.util
    spec = importlib.util.spec_from_file_location("editor_accounts", ROOT / "scripts/editor_accounts.py")
    accounts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accounts)
    line, password = accounts.reset_password_line("Coral.Heron")
    store(line)
    assert not _call(store, "kerbside_sign_in", B, "coral.heron", "correct horse")["ok"]
    assert _call(store, "kerbside_sign_in", B, "coral.heron", password)["ok"]
    for i in range(10):
        _call(store, "kerbside_sign_in", B, "coral.heron", f"bad {i}")
    assert _call(store, "kerbside_sign_in", B, "coral.heron", password)["why"] == "too many wrong passwords; wait 15 minutes"
    store(accounts.login_verify_line("Coral.Heron"))
    assert store("select verified from kerbside_accounts;") == "t"


def test_the_page_logs_in_logs_out_and_keeps_no_password():
    """Against a stand-in store: logging in takes the account's name and verification, the
    password goes only in the log-in call, and logging out gives the device its own name back."""
    if not shutil.which("node"):
        pytest.skip("Node required")
    script = """
const store = new Map(), calls = [];
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = {};
let signedIn = false;
const state = () => signedIn ? { ok: true, signed_in: true, account: "acct-1", username: "coral.heron", name: "Coral", verified: true } : { ok: true, signed_in: false };
globalThis.fetch = async (url, init) => {
  const name = url.split("/rpc/")[1], body = JSON.parse(init.body);
  calls.push([name, Object.keys(body).sort().join(",")]);
  let out = null;
  if (name === "kerbside_register_device") out = { registered: true, verified: false, name: body.name };
  else if (name === "kerbside_editor_whoami") out = { registered: true, verified: false };
  else if (name === "kerbside_sign_in") { signedIn = body.password === "correct horse"; out = signedIn ? state() : { ok: false, why: "wrong username or password" }; }
  else if (name === "kerbside_sign_out") { signedIn = false; out = state(); }
  else if (name === "kerbside_login_whoami") out = state();
  return { ok: true, status: 200, text: async () => JSON.stringify(out) };
};
const m = await import(process.argv[1]);
await new Promise((r) => setTimeout(r, 20));
const own = m.account().name;
const wrong = await m.logIn("coral.heron", "nope");
const empty = await m.logIn("", "");
const right = await m.logIn(" coral.heron ", "correct horse");
const inside = m.account();
const kept = [...store.values()].some((v) => v.includes("correct horse"));
const out = await m.logOut();
console.log(JSON.stringify({ own, wrong, empty, right: right.ok, inside, kept, after: out.account, calls,
  login: store.get("kerbside:login") ?? null }));
"""
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script, ACCOUNT.as_uri()],
                                    capture_output=True, text=True, check=True).stdout)
    assert out["wrong"] == {"ok": False, "why": "wrong username or password"}
    assert out["empty"]["ok"] is False and not any(c[0] == "kerbside_sign_in" and c[1] == "" for c in out["calls"])
    assert out["right"] and out["inside"]["username"] == "coral.heron" and out["inside"]["accountId"] == "acct-1"
    assert out["inside"]["name"] == "Coral" and out["inside"]["verified"] and out["inside"]["editor"] == "Coral"
    assert not out["kept"], "no password is kept on the device"
    assert {c[1] for c in out["calls"] if "password" in c[1]} == {"key,password,username"}
    assert all(c[0] == "kerbside_sign_in" for c in out["calls"] if "password" in c[1])
    assert out["after"]["username"] is None and out["after"]["name"] == out["own"] and out["login"] is None


def test_the_home_screen_offers_log_in_from_the_name_corner():
    lobby = (ROOT / "docs/home-lobby.mjs").read_text()
    assert 'autocomplete: "current-password"' in lobby and 'type: "password"' in lobby
    assert "ctx.account.signUp" in lobby and "ctx.account.logIn" in lobby and "ctx.account.logOut()" in lobby
    sql = SQL.read_text()
    assert "revoke all on kerbside_accounts, kerbside_login_attempts from anon, authenticated;" in sql
    assert "grant execute on function kerbside_sign_in(text, text, text) to anon, authenticated;" in sql
