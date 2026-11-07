// Your Kerbside account on this device: a name, and whether the owner has verified it -- a
// verified account's saved edits change the world everyone sees.
//
// There is no sign-in and no code to type. Each device makes its own account the first time it is
// used: a random secret kept in this browser (localStorage), registered with the canonical store
// under the device's name (kerbside_register_device). The store keeps only the secret's SHA-256.
// The owner verifies an account on the backend -- in the Supabase dashboard, `verified` on its
// row in kerbside_editors (scripts/editor_accounts.py --verify prints the line) -- and from then on
// that device's saves are written to the canonical world, with nothing more to do on the device.
// The tables are closed to the public key: everything goes through the functions in
// supabase/kerbside_exterior_edits.sql and supabase/kerbside_device_accounts.sql, each of which
// checks the secret against the editors table. Anyone may read the canonical edits; only a
// verified account may write them.

export const STORE = {
  url: "https://tpbugonqwaoxtcswxyki.supabase.co",
  // The publishable key: safe in a page by design (the tables are closed to it; see above).
  key: "sb_publishable_kYqbDWABU2nqK3JFUAfxAw_DysNJ4m_",
};
const KEY = "kerbside:editor-key";
const NAME = "kerbside:player-name";
const VERIFIED = "kerbside:editor-verified";
const REGISTERED = "kerbside:account-registered";

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

//: This device's account secret: made once, kept in this browser. A secret kept from an earlier
//: verified editor key is the same thing and stays as it is.
function deviceSecret() {
  const kept = storage.get(KEY);
  if (kept && /^[A-Za-z0-9_-]{20,128}$/.test(kept)) return kept;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  storage.set(KEY, secret);
  return secret;
}

//: A name for someone who has not chosen one: a word and a Bay Area creature and a number, so a
//: walker in a party, a lobby or a saved edit is somebody from the moment they arrive. It is kept
//: on this device and can be changed like any other (setName); clearing it draws a new one.
const NAME_WORDS = ["Coral", "Foggy", "Golden", "Misty", "Sunny", "Cedar", "Harbor", "Mossy", "Swift", "Quiet",
  "Amber", "Breezy", "Copper", "Indigo", "Lucky", "Rusty", "Sandy", "Silver", "Tidal", "Velvet"];
const NAME_CREATURES = ["Heron", "Otter", "Pelican", "Sea Lion", "Quail", "Coyote", "Egret", "Seal", "Crab", "Hawk",
  "Raven", "Fox", "Gull", "Owl", "Deer", "Salmon", "Bobcat", "Sparrow", "Whale", "Plover"];
export function autoName(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length) % list.length];
  return `${pick(NAME_WORDS)} ${pick(NAME_CREATURES)} ${10 + Math.floor(random() * 90)}`;
}
const cleanText = (name) => String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24);
function startingName() {
  const stored = cleanText(storage.get(NAME));
  if (stored) return stored;
  const name = autoName();
  storage.set(NAME, name);
  return name;
}

const listeners = new Set();
let checking = null;
const state = {
  name: startingName(),
  key: deviceSecret(),
  verified: storage.get(VERIFIED) === "1",
  editor: storage.get(VERIFIED) === "1" ? storage.get(NAME) : null,
  registered: storage.get(REGISTERED) === "1",
  problem: null,
};

//: ``registered``: the store knows this device's account (so the owner can find it to verify it).
export function account() {
  return { name: state.name, verified: state.verified, editor: state.editor, registered: state.registered, problem: state.problem };
}
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) try { fn(account()); } catch {} };

//: Tell the store about this device's account, under its name (again after a rename). Unverified
//: until the owner says otherwise; a store not yet set up for it leaves saves on this device.
export async function register() {
  if (typeof document === "undefined") return account();   // only a page registers (not a test)
  try {
    const out = await rpc("kerbside_register_device", { key: state.key, name: state.name });
    state.registered = Boolean(out?.registered);
    state.verified = Boolean(out?.verified);
    state.editor = state.verified ? (out.name || state.name) : null;
    storage.set(REGISTERED, state.registered ? "1" : null);
    storage.set(VERIFIED, state.verified ? "1" : null);
    state.problem = null;
  } catch (error) {
    state.problem = error.message;
  }
  changed();
  return account();
}

export function setName(name) {
  state.name = cleanText(name) || autoName();
  storage.set(NAME, state.name);
  changed();
  register();
}

//: Ask the store whether the owner has verified this device's account yet (a device the store has
//: not heard of is registered first). An account the owner un-verifies stops writing at once anyway:
//: the store checks the secret on every save.
export function recheck() {
  if (!state.registered) return (checking ??= register().finally(() => { checking = null; }));
  return (checking ??= rpc("kerbside_editor_whoami", { key: state.key })
    .then((who) => {
      state.verified = Boolean(who?.verified); state.editor = state.verified ? (who.name || state.name) : null;
      if (who && who.registered === false) { state.registered = false; storage.set(REGISTERED, null); }
      storage.set(VERIFIED, state.verified ? "1" : null);
      state.problem = null;
    })
    .catch((error) => { state.problem = error.message; })
    .finally(() => { checking = null; changed(); })
    .then(() => (state.registered ? account() : recheck())));
}

//: Save an exterior edit to the canonical world. Resolves {canonical: true} when it is written,
//: {canonical: false, why} when it stays on this device only.
export async function saveCanonicalEdit(edit) {
  if (!state.verified) return { canonical: false, why: "this account is not verified yet" };
  try {
    const out = await rpc("kerbside_save_exterior_edit", { key: state.key, edit });
    return out?.saved ? { canonical: true, updated: out.updated } : { canonical: false, why: out?.why || "refused" };
  } catch (error) {
    return { canonical: false, why: error.message };
  }
}

export async function removeCanonicalEdit(osmId) {
  if (!state.verified) return { canonical: false, why: "this account is not verified yet" };
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

// Known to the store from the first visit, so the owner can find it and verify it.
if (!state.registered && typeof fetch === "function") register();
