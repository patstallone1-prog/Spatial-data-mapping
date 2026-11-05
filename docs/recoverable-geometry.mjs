// Keep static GPU buffers recoverable without retaining a second uncompressed city.
// Compression is lossless; this does not simplify or quantize any geometry.
const wrapped = new WeakSet();

// Compression waits for idle time, a few milliseconds at a stretch. Done in the upload callback
// it ran inside the frame that first drew a new window: every street buffer of the square
// deflated at once, 0.85 s of one frame, the walker frozen mid-jump (measured 2026-11-04). Idle
// time was not enough: one large buffer is one deflate, and a 0.2-0.3 s deflate inside an idle
// callback was a frozen step while walking (2026-11-05). The deflate itself now runs in a worker;
// the page only copies the bytes over and takes the result back. Where no worker can be had
// (Node, a browser that refuses module workers) it is done here, in idle slices, as before.
const pending = [];
let pumping = false;
const SLICE_MS = 6;
const MAX_IN_FLIGHT = 4;
const later = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 40));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let worker = null, workerFailed = typeof Worker !== 'function', nextJob = 1;
const inFlight = new Map();
//: The worker's script, on the page's own site: this module may itself be read from the object
//: store, another origin, where a worker cannot be started from. The page says where (below).
let workerUrl = null;
export function useCompressionWorker(url) { workerUrl = url; }
function compressor() {
  if (worker || workerFailed) return worker;
  if (!workerUrl) return null;
  try {
    worker = new Worker(workerUrl, { type: 'module' });
    worker.onmessage = (event) => {
      const job = inFlight.get(event.data.id);
      inFlight.delete(event.data.id);
      if (job) job.accept(event.data.out);
      // The next at once, not at the next idle moment: while the page is busy those can be a
      // second apart, and the buffers waiting were held uncompressed all that while.
      if (pending.length) { pumping = true; setTimeout(pump, 0); }
    };
    worker.onerror = () => {
      // No worker after all: what was sent is compressed here instead.
      workerFailed = true; worker = null;
      for (const job of inFlight.values()) pending.push(job);
      inFlight.clear();
      schedule();
    };
  } catch { workerFailed = true; worker = null; }
  return worker;
}
function pump(deadline) {
  pumping = false;
  const budget = Math.max(2, Math.min(SLICE_MS, deadline?.timeRemaining ? deadline.timeRemaining() : SLICE_MS));
  const until = now() + budget;
  const w = compressor();
  if (w) {
    while (pending.length && inFlight.size < MAX_IN_FLIGHT && now() < until) {
      const job = pending.shift();
      const bytes = job.snapshot();
      if (!bytes) continue;
      const id = nextJob++;
      inFlight.set(id, job);
      w.postMessage({ id, bytes }, [bytes.buffer]);
    }
    if (pending.length && inFlight.size < MAX_IN_FLIGHT) schedule();
    return;
  }
  do { pending.shift()?.run(); } while (pending.length && now() < until);
  if (pending.length) schedule();
}
function schedule() { if (!pumping) { pumping = true; later(pump); } }
//: Every compression still waiting, done now (tests; a page about to measure its memory).
export function compressPending() { while (pending.length) pending.shift().run(); }
export function makeRecoverable(attribute, codec) {
  if (!attribute || wrapped.has(attribute) || !codec?.deflateSync || !codec?.inflateSync)
    return false;
  let raw = attribute.array;
  if (!ArrayBuffer.isView(raw) || raw instanceof DataView || attribute.isInterleavedBufferAttribute)
    return false;
  const descriptor = Object.getOwnPropertyDescriptor(attribute, 'array');
  if (descriptor && !descriptor.configurable) return false;
  let packed = null, packedVersion = -1;
  let Type = raw.constructor, length = raw.length;
  const previousUpload = attribute.onUploadCallback;
  Object.defineProperty(attribute, 'array', {
    configurable: true, enumerable: true,
    get() {
      if (!raw) {
        const bytes = codec.inflateSync(packed);
        if (bytes.byteLength !== length * Type.BYTES_PER_ELEMENT)
          throw new Error('Invalid recoverable geometry snapshot');
        // Slice ensures alignment even if the codec returns an offset byte view.
        raw = new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
      return raw;
    },
    set(value) {
      if (!ArrayBuffer.isView(value) || value instanceof DataView)
        throw new TypeError('Geometry array must remain a typed array');
      raw = value; Type = value.constructor; length = value.length;
      packed = null; packedVersion = -1;
    },
  });
  // What it holds, read without restoring it: emptying a released window must not inflate every
  // buffer just to learn its type and length (0.26 s a release, measured).
  Object.defineProperty(attribute, 'recoverableType', { configurable: true, get: () => Type });
  Object.defineProperty(attribute, 'recoverableLength', { configurable: true, get: () => length });
  let queued = false;
  const settle = (candidate, bytes) => {
    // Incompressible data stays resident; do not grow memory to save memory.
    if (!candidate || candidate.byteLength >= bytes) { packed = null; return; }
    packed = candidate; packedVersion = attribute.version; raw = null;
  };
  // Done here, at once: no worker, or a test asking for it.
  const run = () => {
    queued = false;
    if (!raw) return;
    try {
      if (packed && packedVersion === attribute.version) { raw = null; return; }
      const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      settle(codec.deflateSync(bytes, { level: 1 }), bytes.byteLength);
    } catch {
      // Optional optimization only: if compression fails retain the real array.
      packed = null;
    }
  };
  // Sent to the worker: a copy of the bytes as they are now, and the version they are of. An
  // answer for a version since replaced (an edit, a new array) is thrown away.
  let sentVersion = -1, sentArray = null, sentBytes = 0;
  const job = {
    run,
    snapshot() {
      queued = false;
      if (!raw) return null;
      if (packed && packedVersion === attribute.version) { raw = null; return null; }
      sentVersion = attribute.version; sentArray = raw; sentBytes = raw.byteLength;
      return new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    },
    accept(candidate) {
      if (!raw || raw !== sentArray || attribute.version !== sentVersion) return;
      try { settle(candidate, sentBytes); } catch { packed = null; }
      sentArray = null;
    },
  };
  attribute.onUpload(function () {
    if (previousUpload) previousUpload.call(this);
    if (!raw) return;
    // Already packed at this version (a re-upload after a restore): let the copy go at once.
    if (packed && packedVersion === attribute.version) { raw = null; return; }
    if (!queued) { queued = true; pending.push(job); schedule(); }
  });
  wrapped.add(attribute);
  return true;
}
