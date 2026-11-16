// The city server on one machine: for development, the tests' browser, or a host of your own.
//
//     KERBSIDE_CITY_SECRET=... KERBSIDE_CITY_STORE=file:.city/world.json node server/city/serve.mjs [port]
//
// The same door as the deployed one (http.mjs), on http://localhost:<port>/api/city.
import { createServer } from "node:http";

import { HEADERS, handle } from "./http.mjs";

const port = Number(process.argv[2] || process.env.PORT || 8790);
createServer(async (req, res) => {
  if (!req.url.startsWith("/api/city")) { res.writeHead(404, HEADERS).end(JSON.stringify({ ok: false, error: "not here" })); return; }
  const chunks=[];let bytes=0;
  for await (const chunk of req) { chunks.push(chunk);bytes+=chunk.length;if (bytes > 3_600_000) { res.writeHead(413, HEADERS).end(JSON.stringify({ ok: false, error: "too large" })); return; } }
  const out = await handle({ method: req.method, body: chunks.length ? Buffer.concat(chunks).toString("utf8") : null });
  res.writeHead(out.status, HEADERS).end(out.body ? JSON.stringify(out.body) : "");
}).listen(port, () => console.log(`kerbside city server on http://localhost:${port}/api/city`));
