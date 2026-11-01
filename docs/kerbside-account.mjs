// Your Kerbside account on this device: a name, and -- for a verified editor -- the editor key
// that lets what you save change the world everyone sees.
//
// Nothing here is a password store. A verified editor is someone the owner has issued a key to
// (scripts/editor_accounts.py); the key lives in this browser (localStorage) and is checked by the
// canonical store, a Supabase project whose tables are closed to the public key: everything goes
// through the functions in supabase/kerbside_exterior_edits.sql, each of which checks the key's
// SHA-256 against the editors table. Anyone may read the canonical edits; only a verified key may
// write them. A key arrives by a private link (#editor-key=...), which is read once and taken out
// of the address bar, or pasted into the Verify box.

export const STORE = {
  url: "https://tpbugonqwaoxtcswxyki.supabase.co",
  // The publishable key: safe in a page by design (the tables are closed to it; see above).
  key: "sb_publishable_kYqbDWABU2nqK3JFUAfxAw_DysNJ4m_",
};
const KEY = "kerbside:editor-key";
const NAME = "kerbside:player-name";
const VERIFIED = "kerbside:editor-verified";

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch { return false; } },
};

async function rpc(name, body, { timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(`${STORE.url}/rest/v1/rpc/${name}`, {
      method: "POST", signal: controller.signal,
      headers: { apikey: STORE.key, Authorization: `Bearer ${STORE.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(r.status === 404 ? "the canonical store is not set up yet" : `${r.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

//: A key from a private link, taken out of the address bar so it is not left in history.
function keyFromLink() {
  const match = /(?:^#|&)editor-key=([A-Za-z0-9_-]{20,128})/.exec(location.hash || "");
  if (!match) return null;
  const rest = location.hash.replace(match[0], "").replace(/^#&?/, "");
  history.replaceState(null, "", location.pathname + location.search + (rest ? `#${rest}` : ""));
  return match[1];
}

const listeners = new Set();
let checking = null;
const state = {
  name: storage.get(NAME) || null,
  key: storage.get(KEY) || null,
  verified: storage.get(VERIFIED) === "1",
  editor: storage.get(VERIFIED) === "1" ? storage.get(NAME) : null,
  problem: null,
};

export function account() { return { name: state.name, verified: state.verified && Boolean(state.key), editor: state.editor, problem: state.problem }; }
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) try { fn(account()); } catch {} };

export function setName(name) {
  state.name = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24) || null;
  storage.set(NAME, state.name);
  changed();
}

//: Ask the store whether ``key`` is a verified editor's; keep it if so.
export async function verify(key) {
  key = String(key || "").trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(key)) return { ok: false, why: "That is not an editor key." };
  try {
    const who = await rpc("kerbside_editor_whoami", { key });
    if (!who?.verified) return { ok: false, why: "That key is not a verified editor's." };
    state.key = key; state.verified = true; state.editor = who.name || state.name; state.problem = null;
    if (!state.name && who.name) state.name = who.name;
    storage.set(KEY, key); storage.set(VERIFIED, "1"); storage.set(NAME, state.name);
    changed();
    return { ok: true, name: state.editor };
  } catch (error) {
    return { ok: false, why: `Could not check it: ${error.message}.` };
  }
}

export function signOutEditor() {
  state.key = null; state.verified = false; state.editor = null;
  storage.set(KEY, null); storage.set(VERIFIED, null);
  changed();
}

//: Re-check a kept key now and then (a revoked key stops writing at once anyway: the store checks).
export function recheck() {
  if (!state.key) return Promise.resolve(account());
  return (checking ??= rpc("kerbside_editor_whoami", { key: state.key })
    .then((who) => {
      state.verified = Boolean(who?.verified); state.editor = who?.name || null;
      storage.set(VERIFIED, state.verified ? "1" : null);
      state.problem = null;
    })
    .catch((error) => { state.problem = error.message; })
    .finally(() => { checking = null; changed(); })
    .then(() => account()));
}

//: Save an exterior edit to the canonical world. Resolves {canonical: true} when it is written,
//: {canonical: false, why} when it stays on this device only.
export async function saveCanonicalEdit(edit) {
  if (!state.key || !state.verified) return { canonical: false, why: "not a verified editor" };
  try {
    const out = await rpc("kerbside_save_exterior_edit", { key: state.key, edit });
    return out?.saved ? { canonical: true, updated: out.updated } : { canonical: false, why: out?.why || "refused" };
  } catch (error) {
    return { canonical: false, why: error.message };
  }
}

export async function removeCanonicalEdit(osmId) {
  if (!state.key || !state.verified) return { canonical: false, why: "not a verified editor" };
  try {
    const out = await rpc("kerbside_remove_exterior_edit", { key: state.key, osm_id: String(osmId) });
    return { canonical: Boolean(out?.removed) };
  } catch (error) {
    return { canonical: false, why: error.message };
  }
}

//: Every canonical edit, by OSM id: what everyone's world draws. Empty when the store is unset.
export async function canonicalEdits() {
  try {
    const out = await rpc("kerbside_exterior_edits", {}, { timeout: 8000 });
    return out && typeof out === "object" ? out : {};
  } catch {
    return {};
  }
}

const linked = keyFromLink();
if (linked) verify(linked);
