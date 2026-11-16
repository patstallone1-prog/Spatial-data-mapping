// Who is speaking: a player is the device account that signed in, and nothing a client says
// about who it is counts after that.
//
// A device signs in once with its account secret (docs/kerbside-account.mjs: made on the device,
// never shown). The server takes the secret's SHA-256 as the account, derives the player's id
// from it, and hands back a session token it has signed. Every command carries the token; the
// player id is read out of the token -- never out of the command -- so one player cannot act as
// another by naming them.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const KEY_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
//: A session lasts this long; the page signs in again when it loads, and when one runs out.
export const SESSION_MS = 12 * 3_600_000;

export const keyHash = (key) => createHash("sha256").update(String(key)).digest("hex");
//: The player a device account is: the same in every session, on every server instance.
export const playerId = (hash) => `p${hash.slice(0, 24)}`;

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (secret, body) => b64(createHmac("sha256", secret).update(body).digest());

//: A token for the device whose secret is ``key``, or null when it is not an account secret.
export function openSession(secret, key, now = Date.now()) {
  if (!secret) throw new Error("the city server has no signing secret");
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return null;
  const kh = keyHash(key), pid = playerId(kh), exp = now + SESSION_MS;
  const body = b64(JSON.stringify({ pid, kh, exp }));
  return { pid, exp, token: `${body}.${sign(secret, body)}` };
}

//: Who a token speaks for: {pid, kh}, or null when it was not signed here or has run out.
export function readSession(secret, token, now = Date.now()) {
  if (!secret || typeof token !== "string" || token.length > 600) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot), given = Buffer.from(token.slice(dot + 1)), want = Buffer.from(sign(secret, body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof s.pid !== "string" || typeof s.kh !== "string" || !(s.exp > now) || playerId(s.kh) !== s.pid) return null;
    return { pid: s.pid, kh: s.kh, exp: s.exp };
  } catch { return null; }
}
