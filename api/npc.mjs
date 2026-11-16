// The voices of the city's people (a Vercel function at /api/npc): server/npc/service.mjs says
// what it does and what it needs. It reads the same world the city's server keeps (/api/city).
import { HEADERS, authority } from "../server/city/http.mjs";
import { npcService } from "../server/npc/service.mjs";

export default async function npc(req, res) {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  const service = npcService(authority());
  if (!service) { res.status(503).send(JSON.stringify({ ok: false, code: "not_configured", error: "the city's server is not set up yet" })); return; }
  if (req.method !== "POST") { res.status(200).send(JSON.stringify({ ok: true, model: service.model?.model || null })); return; }
  let body = req.body ?? null;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { res.status(400).send(JSON.stringify({ ok: false, error: "not JSON" })); return; } }
  try { res.status(200).send(JSON.stringify(await service.handle(body))); }
  catch (error) { console.error("kerbside npc:", error); res.status(500).send(JSON.stringify({ ok: false, code: "server", error: "that could not be answered" })); }
}
