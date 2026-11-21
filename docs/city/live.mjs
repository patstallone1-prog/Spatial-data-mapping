// Told when the city changes, instead of asking every few seconds.
//
// Every page signed in to the city used to ask its server "what is new?" every four seconds
// (view.mjs syncCity): a hundred players were twenty-five calls to the server a second, most of
// them answered "nothing", and each of them a serverless call and, every so often, a call to the
// store. Now the server, once it has committed a change, says the world's new version on one
// channel (server/city/announce.mjs) and every page listening hears it at once and asks for its
// own part then -- the same signed ``sync`` as before, so what a page is shown is still decided
// by the server alone. Only the version number travels on the channel, never anyone's state.
//
// The channel is Supabase Realtime's broadcast (the project the pages already use), spoken here
// in its own small protocol (Phoenix channels over one WebSocket), with no library. When it is
// not up -- not reachable, refused, or this page has no WebSocket -- the page asks every few
// seconds as it did (view.mjs), and while it is up, still now and then (a missed message).
//
// Pure but for ``WebSocket`` and the timers, which the tests pass in.

export const LIVE_VSN = "1.0.0";
//: The socket's heartbeat (Phoenix closes a socket it has not heard from in about a minute).
export const HEARTBEAT_MS = 25_000;
//: Waits before trying again after the socket closes: longer each time, to a minute at most.
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

//: The WebSocket address of a Supabase project's Realtime, signed with its publishable key.
export function liveSocketUrl(projectUrl, key) {
  const u = new URL(String(projectUrl));
  if (!/^https?:$/.test(u.protocol)) return null;
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/realtime/v1/websocket`;
  u.search = new URLSearchParams({ apikey: key, vsn: LIVE_VSN }).toString();
  return u.href;
}

//: What a message off the socket says: {kind: "version", version} for the city's new version,
//: {kind: "joined"} / {kind: "refused", why} for the answer to joining, or null for anything else.
export function readLive(raw, topic) {
  let m = raw;
  if (typeof raw === "string") { try { m = JSON.parse(raw); } catch { return null; } }
  if (!m || typeof m !== "object" || m.topic !== `realtime:${topic}`) return null;
  if (m.event === "phx_reply" && m.ref === "join") {
    return m.payload?.status === "ok" ? { kind: "joined" } : { kind: "refused", why: String(m.payload?.response?.reason || m.payload?.status || "refused").slice(0, 120) };
  }
  if (m.event === "phx_error" || m.event === "phx_close") return { kind: "refused", why: m.event };
  if (m.event !== "broadcast" || m.payload?.event !== "version") return null;
  const v = m.payload?.payload?.version;
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? { kind: "version", version: v } : null;
}

//: Listening on ``topic`` of the project at ``url`` (its publishable ``key``). ``onVersion(v)``
//: for each version announced; ``onState(state)`` as it goes "connecting" -> "live" -> "down".
//: {state(), close()}. Nothing is ever sent on the channel but joining it and the heartbeat.
export function cityLive({ url, key, topic, onVersion = () => {}, onState = () => {},
  WebSocket: WS = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout,
  setRepeat = setInterval, clearRepeat = clearInterval } = {}) {
  const address = url && key && topic ? liveSocketUrl(url, key) : null;
  let socket = null, beat = null, retry = null, tries = 0, state = "down", closed = false, ref = 0;
  const set = (s) => { if (s !== state) { state = s; try { onState(s); } catch { /* the page's */ } } };
  const post = (m) => { try { socket?.send(JSON.stringify(m)); } catch { /* closing */ } };
  function again() {
    if (closed || retry) return;
    const wait = RETRY_MS[Math.min(tries, RETRY_MS.length - 1)];
    tries += 1;
    retry = setTimer(() => { retry = null; open(); }, wait);
  }
  function drop() {
    if (beat) { clearRepeat(beat); beat = null; }
    const s = socket; socket = null;
    if (s) { s.onopen = s.onmessage = s.onclose = s.onerror = null; try { s.close(); } catch { /* gone */ } }
  }
  function open() {
    if (closed || !address || typeof WS !== "function") { set("down"); return; }
    set("connecting");
    try { socket = new WS(address); } catch { set("down"); again(); return; }
    socket.onopen = () => {
      post({ topic: `realtime:${topic}`, event: "phx_join", ref: "join",
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false } } });
      beat = setRepeat(() => post({ topic: "phoenix", event: "heartbeat", payload: {}, ref: `hb${ref += 1}` }), HEARTBEAT_MS);
    };
    socket.onmessage = (e) => {
      const m = readLive(e.data, topic);
      if (!m) return;
      if (m.kind === "joined") { tries = 0; set("live"); return; }
      if (m.kind === "refused") { set("down"); drop(); again(); return; }
      try { onVersion(m.version); } catch { /* the page's */ }
    };
    socket.onclose = () => { set("down"); drop(); again(); };
    socket.onerror = () => { /* followed by close */ };
  }
  open();
  return {
    state: () => state,
    close() { closed = true; if (retry) { clearTimer(retry); retry = null; } drop(); set("down"); },
  };
}

//: When a page asks for its part after hearing of a new version: not more often than every
//: ``gap`` ms, and a moment after (``jitter``), so a thousand pages hearing the same version do
//: not all ask in the same instant. ``now`` and ``random`` are passed in by the tests.
export function syncPlan({ heard, have, lastAsked, now, gap = 1000, jitter = 400, random = Math.random }) {
  if (!(heard > have)) return null;
  return Math.max(now + random() * jitter, lastAsked + gap);
}
