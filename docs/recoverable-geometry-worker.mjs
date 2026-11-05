// Deflates geometry snapshots off the page's thread for recoverable-geometry.mjs: one large street
// buffer deflated on the main thread held a frame for 0.2-0.3 s while the walker was walking.
import { deflateSync } from './vendor/fflate-0.8.2.mjs';
self.onmessage = (event) => {
  const { id, bytes } = event.data;
  let out = null;
  try { out = deflateSync(bytes, { level: 1 }); } catch { out = null; }
  self.postMessage({ id, out }, out ? [out.buffer] : []);
};
