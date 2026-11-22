// Saying the world's new version to every page listening (docs/city/live.mjs), once a change is
// committed: Supabase Realtime's broadcast, sent over its REST door with the project's publishable
// key. Only the version number goes out -- what each player is shown is still asked for, signed,
// and answered by the server (``sync``).
//
// A broadcast that fails or is slow is let go: the pages ask now and then anyway, so a lost
// announcement is a change seen half a minute late, never a wrong one.

//: The channel a world's versions are said on.
export const liveTopic = (world) => `kerbside-city:${world}`;
//: Longest a commit waits on the announcement (ms): it is a hint, not part of the command.
export const ANNOUNCE_TIMEOUT_MS = 700;

//: ``(world, version) => Promise<boolean>`` for the project at ``url`` (its publishable ``key``).
export function realtimeAnnouncer({ url, key, fetch: f = globalThis.fetch, timeout = ANNOUNCE_TIMEOUT_MS }) {
  const endpoint = `${String(url).replace(/\/+$/, "")}/realtime/v1/api/broadcast`;
  return async (world, version) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await f(endpoint, { method: "POST", signal: controller.signal,
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ topic: liveTopic(world), event: "version", payload: { version } }] }) });
      return r.ok;
    } catch { return false; } finally { clearTimeout(timer); }
  };
}

//: What a page needs to listen: {url, key, topic}. (The key is the publishable one the pages
//: already carry; nothing secret.)
export const liveInfo = ({ url, key }, world) => ({ url: String(url).replace(/\/+$/, ""), key, topic: liveTopic(world) });
