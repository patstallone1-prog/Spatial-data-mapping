// The city server on one machine: for development, the tests' browser, or a host of your own.
//
//     KERBSIDE_CITY_SECRET=... KERBSIDE_CITY_STORE=file:.city/world.json node server/city/serve.mjs [port]
//
// The same door as the deployed one (http.mjs), on http://localhost:<port>/api/city.
import { createServer } from "node:http";

import { HEADERS, authority, handle } from "./http.mjs";
import { npcService } from "../npc/service.mjs";

const port = Number(process.argv[2] || process.env.PORT || 8790);
createServer(async (req, res) => {
  const voices = req.url.startsWith("/api/npc");
  if (!voices && !req.url.startsWith("/api/city")) { res.writeHead(404, HEADERS).end(JSON.stringify({ ok: false, error: "not here" })); return; }
  let text = "";
  for await (const chunk of req) { text += chunk; if (text.length > 64_000) { res.writeHead(413, HEADERS).end(JSON.stringify({ ok: false, error: "too large" })); return; } }
  if (voices && req.method === "POST") {
    const service = npcService(authority());
    let body = null;
    try { body = JSON.parse(text); } catch { /* answered below */ }
    const answer = service ? await service.handle(body) : { ok: false, code: "not_configured", error: "not set up" };
    res.writeHead(service ? 200 : 503, HEADERS).end(JSON.stringify(answer));
    return;
  }
  const out = await handle({ method: req.method, body: text || null });
  res.writeHead(out.status, HEADERS).end(out.body ? JSON.stringify(out.body) : "");
}).listen(port, () => console.log(`kerbside city server on http://localhost:${port}/api/city`));
