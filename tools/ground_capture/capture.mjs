// What the page actually draws on the ground, looked at from straight above.
//
//   node tools/ground_capture/capture.mjs URL OUT_DIR [CDP_PORT=9333]
//
// Drives a headless Chrome started with --remote-debugging-port: loads the page, waits for the
// world to finish building, then draws it top-down in 512 m tiles at half a metre a pixel with
// every surface in a flat class colour -- road, paving, grass, building, water, service ground --
// and the bare terrain in its own. Trees, furniture and signs are left out: they stand on the
// ground, they are not it. Open water is read from the page's own land/water map, since the bay
// is drawn by the terrain.
//
// Writes OUT_DIR/classes.bin (one byte a pixel, row 0 at the north edge) and OUT_DIR/meta.json
// (the bounds in page metres, the page's frame, the class names). tools/infer_ground_gaps.py
// reads the two.
import fs from "node:fs";
import path from "node:path";

const [url, out, port = "9333"] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node capture.mjs URL OUT_DIR [CDP_PORT]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const TILE_M = 512, PX_PER_M = 2, TILE_PX = TILE_M * PX_PER_M;
//: The height the page gives open water (OPEN_WATER_GROUND_M = SEA_SURFACE_M).
const SEA_M = -0.142;

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || "evaluate failed");
  return m.result?.result?.value;
};

await send("Runtime.enable");
await send("Network.setBypassServiceWorker", { bypass: true });
await send("Page.navigate", { url });
for (let i = 0; i < 600; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await evaluate(`Boolean(window.kerbside && document.getElementById("progress")?.hidden)`).catch(() => false)) break;
}
// The ground cover and the furniture arrive after the first frame.
await new Promise((r) => setTimeout(r, 15000));

await evaluate(fs.readFileSync(new URL("classify.js", import.meta.url), "utf8"));
const meta = await evaluate(`(() => {
  const k = window.kerbside, b = k.DATA.bbox, even = (v) => 2 * Math.floor(v / 2);
  const [w, s] = k.xy(b.west, b.south), [e, n] = k.xy(b.east, b.north);
  const [x1] = k.xy(-122.41, 37.79), [x0] = k.xy(-122.42, 37.79);
  const [, y1] = k.xy(-122.42, 37.80), [, y0] = k.xy(-122.42, 37.79), [ox, oy] = k.xy(0, 0);
  const mPerLon = (x1 - x0) / 0.01, mPerLat = (y1 - y0) / 0.01;
  return { west: even(w), east: even(e), north: even(-n), south: even(-s),
           frame: { mPerLon, mPerLat, midLon: -ox / mPerLon, midLat: -oy / mPerLat },
           classes: window.__cover.CLASSES };
})()`);
const width = (meta.east - meta.west) * PX_PER_M, height = (meta.south - meta.north) * PX_PER_M;
const classes = new Uint8Array(width * height);
for (let z = meta.north; z < meta.south; z += TILE_M) {
  for (let x = meta.west; x < meta.east; x += TILE_M) {
    const tile = Buffer.from(await evaluate(`window.__cover.tile(${x}, ${z}, ${TILE_M}, ${TILE_PX}).data`), "base64");
    const r0 = (z - meta.north) * PX_PER_M, c0 = (x - meta.west) * PX_PER_M;
    for (let r = 0; r < TILE_PX && r0 + r < height; r += 1) {
      const row = tile.subarray(r * TILE_PX, r * TILE_PX + Math.min(TILE_PX, width - c0));
      classes.set(row, (r0 + r) * width + c0);
    }
  }
}
// Open water, two metres a cell, from the terrain the page draws it with.
const WATER = meta.classes.indexOf("water"), BARE = meta.classes.indexOf("bare"), NONE = meta.classes.indexOf("none");
const cols = (meta.east - meta.west) / 2, rows = (meta.south - meta.north) / 2;
await evaluate(`(() => { const k = window.kerbside; const out = new Uint8Array(${cols * rows});
  for (let r = 0; r < ${rows}; r++) for (let c = 0; c < ${cols}; c++)
    out[r * ${cols} + c] = Math.abs(k.terrainHeightAt(${meta.west} + c * 2 + 1, ${meta.north} + r * 2 + 1) - (${SEA_M})) < 1e-6 ? 1 : 0;
  window.__water = out; return true; })()`);
const water = [];
for (let i = 0; i < cols * rows; i += 400000) {
  water.push(Buffer.from(await evaluate(`(() => { const a = window.__water.subarray(${i}, ${i + 400000}); let s = "";
    for (let j = 0; j < a.length; j += 0x8000) s += String.fromCharCode.apply(null, a.subarray(j, j + 0x8000)); return btoa(s); })()`), "base64"));
}
const wet = Buffer.concat(water);
for (let r = 0; r < height; r += 1) {
  for (let c = 0; c < width; c += 1) {
    const i = r * width + c;
    if ((classes[i] === BARE || classes[i] === NONE) && wet[(r >> 2) * cols + (c >> 2)]) classes[i] = WATER;
  }
}
fs.writeFileSync(path.join(out, "classes.bin"), classes);
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ ...meta, width, height, px_per_m: PX_PER_M, url }, null, 1));
console.log(`captured ${width}x${height} px into ${out}`);
process.exit(0);
