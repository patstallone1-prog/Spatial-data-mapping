// The city's server as deployed (a Vercel function at /api/city): server/city/http.mjs says what
// it does and what it needs. The world it keeps is in the database (supabase/kerbside_city_server.sql).
import { HEADERS, handle } from "../server/city/http.mjs";

export default async function city(req, res) {
  const out = await handle({ method: req.method, body: req.body ?? null });
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  res.status(out.status);
  if (out.body) res.send(JSON.stringify(out.body)); else res.end();
}
