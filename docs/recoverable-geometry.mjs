// Keep static GPU buffers recoverable without retaining a second uncompressed city.
// Compression is lossless; this does not simplify or quantize any geometry.
const wrapped = new WeakSet();
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
  attribute.onUpload(function () {
    if (previousUpload) previousUpload.call(this);
    if (!raw) return;
    try {
      if (!packed || packedVersion !== attribute.version) {
        const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        const candidate = codec.deflateSync(bytes, { level: 1 });
        // Incompressible data stays resident; do not grow memory to save memory.
        if (candidate.byteLength >= bytes.byteLength) { packed = null; return; }
        packed = candidate; packedVersion = attribute.version;
      }
      raw = null;
    } catch {
      // Optional optimization only: if compression fails retain the real array.
      packed = null;
    }
  });
  wrapped.add(attribute);
  return true;
}
