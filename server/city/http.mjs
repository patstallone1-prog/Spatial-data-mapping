// The city server's one door: a JSON request in, a JSON answer out -- the same under Vercel
// (api/city.mjs), under ``node server/city/serve.mjs`` on one machine, and in the tests.
//
// What it needs from its surroundings (environment variables):
//
//   KERBSIDE_CITY_SECRET   signs sessions and opens the store. Without it the server answers
//                          503 "not_configured" and every page plays its offline practice world.
//   KERBSIDE_CITY_STORE    "supabase" (the default when deployed), "file:<path>" or "memory".
//   KERBSIDE_SUPABASE_URL, KERBSIDE_SUPABASE_KEY   the project and its publishable key (the
//                          defaults are the ones the pages already use; the tables are closed to
//                          that key -- only the secret opens them).
import { readFileSync } from "node:fs";

import { loadRules } from "../../docs/city/core.mjs";
import { CityAuthority } from "./authority.mjs";
import { Canon } from "./canon.mjs";
import { FileStore, MemoryStore, SupabaseStore } from "./storage.mjs";

//: The project and publishable key the pages use (docs/kerbside-account.mjs STORE).
export const SUPABASE = Object.freeze({ url: "https://tpbugonqwaoxtcswxyki.supabase.co", key: "sb_publishable_kYqbDWABU2nqK3JFUAfxAw_DysNJ4m_" });
const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

export function loadCity() {
  const R = loadRules(json("../../docs/city/rules.json"));
  const canon=new Canon(json("./canon/marina.json"),R);canon.interiorEnvelopes=new Map(Object.entries(json("./canon/interiors.json").buildings));return {R,canon};
}

export function storeFrom(env) {
  const kind = env.KERBSIDE_CITY_STORE || "supabase";
  if (kind === "memory") return new MemoryStore();
  if (kind.startsWith("file:")) return new FileStore(kind.slice(5));
  return new SupabaseStore({ url: env.KERBSIDE_SUPABASE_URL || SUPABASE.url, key: env.KERBSIDE_SUPABASE_KEY || SUPABASE.key, secret: env.KERBSIDE_CITY_SECRET });
}

let shared = null;
//: The authority for this process (made once: a warm instance keeps its rules and its record).
export function authority(env = process.env) {
  if (!env.KERBSIDE_CITY_SECRET) return null;
  return (shared ||= new CityAuthority({ ...loadCity(), store: storeFrom(env), secret: env.KERBSIDE_CITY_SECRET, voices: Boolean(env.DEEPSEEK_API_KEY) }));
}

export const HEADERS = Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" });

//: {method, body} -> {status, body}. ``body`` is the parsed JSON (or its text).
export async function handle({ method, body }, city = authority()) {
  if (method === "OPTIONS") return { status: 204, body: null };
  if (!city) return { status: 503, body: { ok: false, code: "not_configured", error: "the city's server is not set up yet" } };
  if (method === "GET") return { status: 200, body: { ok: true, city: city.worldId, places: city.canon.places.size } };
  if (method !== "POST") return { status: 405, body: { ok: false, error: "POST a request" } };
  let ask = body;
  if (typeof ask === "string") { try { ask = JSON.parse(ask); } catch { return { status: 400, body: { ok: false, error: "not JSON" } }; } }
  try {
    return { status: 200, body: await city.handle(ask) };
  } catch (error) {
    if (error?.code === "not_configured") return { status: 503, body: { ok: false, code: "not_configured", error: error.message } };
    console.error("kerbside city:", error);
    return { status: 500, body: { ok: false, code: "server", error: "the city's server could not do that" } };
  }
}
