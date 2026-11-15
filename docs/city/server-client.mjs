// The page's line to the city's server (server/city, deployed at /api/city).
//
// The browser is a client: it signs in with this device's account, sends the actions its player
// takes, and is shown its own part of the one world. It holds no books of its own while it is
// connected, and nothing it has saved is ever sent up -- the server decides every outcome.
//
// Pure but for ``fetch`` (tests/city_server.test.mjs runs it against the server's own handler).

export const API_PATH = "/api/city";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

//: Where this page's city server is: the page's own origin when it is served over http(s) from
//: a real host; on a development machine only where ``?cityServer=`` names another local
//: address (the account secret is never sent to an address a link could choose).
export function cityServerUrl(location) {
  if (!location || !/^https?:$/.test(location.protocol || "")) return null;
  if (!LOCAL.test(location.hostname)) return `${location.origin}${API_PATH}`;
  try {
    const named = new URLSearchParams(location.search || "").get("cityServer");
    if (!named) return null;
    const url = new URL(named, location.href);
    return LOCAL.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

//: ``open()`` signs in; ``send(command, args)`` asks for an action; ``sync()`` asks what has
//: changed; ``grants()`` has the server pay in what the backend granted. Each resolves to the
//: server's answer, or {ok: false, error, code} -- "offline" when it could not be reached,
//: "not_configured" when it is not set up.
export function cityClient({ url, key, fetch: f = globalThis.fetch, timeout = 10_000 }) {
  let token = null, pid = null, version = 0, n = 0;
  const run = Math.random().toString(36).slice(2, 8);
  async function post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      // text/plain: a simple request, so another origin's page needs no preflight to send it.
      const r = await f(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
      const out = await r.json().catch(() => null);
      if (out && typeof out === "object") return out;
      return { ok: false, code: r.status === 404 ? "not_configured" : "offline", error: "the city's server did not answer" };
    } catch {
      return { ok: false, code: "offline", error: "the city's server could not be reached" };
    } finally { clearTimeout(timer); }
  }
  async function open() {
    const r = await post({ op: "session", key });
    if (r.ok) { token = r.token; pid = r.pid; }
    return r;
  }
  //: Signed, and signed in again once if the session has run out.
  async function signed(body) {
    if (!token) { const o = await open(); if (!o.ok) return o; }
    let r = await post({ ...body, token });
    if (!r.ok && r.code === "session") { const o = await open(); if (!o.ok) return o; r = await post({ ...body, token }); }
    if (r.ok && r.version) version = Math.max(version, r.version);
    return r;
  }
  return {
    open, get pid() { return pid; }, get version() { return version; },
    send: (command, args = {}) => signed({ op: "cmd", req: `${run}:${n += 1}`, command, args }),
    sync: (since = version) => signed({ op: "sync", since }),
    grants: () => signed({ op: "grants" }),
  };
}
