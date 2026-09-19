// Load the shipped page, whole, in Node -- with three.js and the DOM replaced by a Proxy that
// accepts anything -- so that a ReferenceError anywhere in the page's own code shows up here
// instead of in a browser nobody was watching. The renderer's geometry, allocation and layout
// code is plain JavaScript and runs for real against the committed payload; only the drawing
// is swallowed. Driven by tests/test_page_loads.py.
//
//   node run.mjs <repo root> <page module>
import { readFileSync } from "node:fs";
const ROOT = process.argv[2];
function stub(name = "stub") {
  const f = function () {};
  return new Proxy(f, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === Symbol.iterator) return function* () {};
      if (p === Symbol.hasInstance) return () => false;
      if (p === "then") return undefined;
      if (p === "length") return 0;
      if (p === "toJSON") return () => null;
      return stub(String(p));
    },
    apply() { return stub(); },
    construct() { return stub(); },
    set() { return true; },
    has() { return true; },
  });
}
globalThis.__THREE = stub("THREE");
const el = () => stub("element");
globalThis.document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), documentElement: el(), addEventListener() {}, hidden: false, visibilityState: "visible" };
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1; globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
globalThis.location = { search: "", hash: "", href: "http://localhost/" };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node", hardwareConcurrency: 4 }, configurable: true });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.Image = class { set src(v) { setTimeout(() => this.onload && this.onload(), 0); } };
globalThis.OffscreenCanvas = class { getContext() { return stub("ctx"); } };
globalThis.ResizeObserver = class { observe() {} };
globalThis.fetch = async (url) => {
  const name = String(url).split("?")[0];
  try {
    const bytes = readFileSync(`${ROOT}/docs/${name}`);
    return { ok: true, status: 200, json: async () => JSON.parse(bytes.toString("utf8")),
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => bytes.toString("utf8") };
  } catch (e) { return { ok: false, status: 404, json: async () => { throw e; }, arrayBuffer: async () => null }; }
};
process.on("unhandledRejection", (e) => { console.log(JSON.stringify({ ok: false, where: "unhandled rejection", error: String(e && e.stack || e).split("\n").slice(0, 4).join(" | ") })); process.exit(1); });
process.on("uncaughtException", (e) => { console.log(JSON.stringify({ ok: false, where: "uncaught", error: String(e && e.stack || e).split("\n").slice(0, 4).join(" | ") })); process.exit(1); });
const t0 = performance.now();
try {
  await import(process.argv[3]);
  await new Promise((r) => setTimeout(r, 200));   // let the deferred loads settle
  const k = globalThis.kerbside || {};
  console.log(JSON.stringify({ ok: true, ms: Math.round(performance.now() - t0), exports: Object.keys(k).length,
    terrain: !!k.TERRAIN, h0: k.terrainHeightAt ? k.terrainHeightAt(0, 0) : null }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e && e.stack || e).split("\n").slice(0, 4).join(" | ") }));
  process.exit(1);
}
