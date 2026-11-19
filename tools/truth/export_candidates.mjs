// What the imagery pass judges (tools/build_imagery_truth.py), dumped from a running page:
//
//   node tools/truth/export_candidates.mjs build/imagery-truth/marina-candidates.json [port]
//
// A local City build must be open and loaded in a Chrome started with --remote-debugging-port
// (9233 unless given). Written out: the triangles of each surface that is inferred or painted
// (in the page's metres), the building footprints (nothing on a roof is a court), the mapped
// courts, and a few hundred buildings both ways (metres, and longitude and latitude) so the
// photograph can be laid over the page's frame.
import { writeFileSync } from "node:fs";
const tabs = await (await fetch(`http://127.0.0.1:${process.argv[3] || 9233}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await call("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true, timeout: 120000 }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800)); return r.result?.result?.value; };
const SURFACES = ["bus_zone:fill", "bus_zone:pad", "furniture:road_legend", "inferred:paving", "inferred:asphalt", "inferred:grass", "inferred:service", "waterworks:gutter", "waterworks:storm_drain", "court", "court_line", "plaza", "service_yard", "yard"];
const text = await ev(`(() => { const k = window.kerbside, ag = k.activeGuest, root = ag.api.root, want = new Set(${JSON.stringify(SURFACES)}); const out = { surfaces: {}, region: window.kerbsideCity().district.region };
  const V = new (k.avatar.position.constructor)(), M4 = k.avatar.matrixWorld.constructor; const m = new M4();
  root.updateMatrixWorld(true);
  root.traverse((o) => { const s = o.userData?.surface; if (!s || !want.has(s) || !o.geometry?.attributes?.position) return; const pos = o.geometry.attributes.position, idx = o.geometry.index; const list = (out.surfaces[s] ||= []);
    const tri = []; const one = (mw) => { const n = idx ? idx.count : pos.count; for (let i = 0; i < n; i += 1) { const j = idx ? idx.getX(i) : i; V.fromBufferAttribute(pos, j).applyMatrix4(mw); tri.push(Math.round(V.x * 100) / 100, Math.round(V.z * 100) / 100); } };
    if (o.isInstancedMesh) { for (let q = 0; q < o.count; q += 1) { o.getMatrixAt(q, m); m.premultiply(o.matrixWorld); one(m); } } else one(o.matrixWorld);
    list.push({ name: o.name || "", y: +(o.geometry.boundingBox?.min.y ?? 0).toFixed(2), tri }); });
  const sp = ag.window.kerbsideStreetPaint?.(); out.paint = sp ? { laid: sp.laid, refused: sp.refused.length } : null;
  const d = window.kerbsideCity().district; out.frame = []; let c = 0; for (const p of d.allBuildings.values()) { if (p.lon && c++ % 6 === 0) out.frame.push([+p.x.toFixed(2), +p.z.toFixed(2), p.lon, p.lat]); }
  out.courts = ag.api.cityCourts?.() || [];
  out.buildings = [...d.allBuildings.values()].filter((b) => b.ring && b.ring.length >= 3).map((b) => b.ring.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]));
  window.__cand = JSON.stringify(out); return window.__cand.length; })()`);
let all = ""; for (let at = 0; at < text; at += 4_000_000) all += await ev(`window.__cand.slice(${at}, ${at} + 4000000)`);
await ev(`(delete window.__cand, 1)`);
writeFileSync(process.argv[2], all);
const o = JSON.parse(all);
console.log(o.region, Object.entries(o.surfaces).map(([k, v]) => `${k}:${v.length}m/${v.reduce((a, b) => a + b.tri.length / 6, 0)}t`).join("  "), "paint", o.paint?.laid.length, "frame", o.frame.length, "courts", o.courts.length, (all.length / 1e6).toFixed(1) + " MB");
ws.close();
