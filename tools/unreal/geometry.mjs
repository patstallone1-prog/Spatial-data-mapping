// Respect a renderer's active buffer range and exclude zero-area export placeholders.
// This is not geometric simplification: real small kerbs/ramps remain intact.
export function triangleRange(geometry, vertexCount) {
  const start = Math.max(0, geometry.drawRange?.start || 0);
  const count = geometry.drawRange?.count ?? Infinity;
  if (start % 3 !== 0) throw new Error("Triangle draw range starts mid-face");
  const end = Math.min(vertexCount, start + count);
  if (end % 3 !== 0) throw new Error("Triangle draw range ends mid-face");
  return [start, end];
}

export function usableTriangle(position, offset) {
  // No per-face arrays: a regional export can visit millions of triangles.
  const x = position.getX(offset), y = position.getY(offset), z = position.getZ(offset);
  const ax = position.getX(offset + 1), ay = position.getY(offset + 1), az = position.getZ(offset + 1);
  const bx = position.getX(offset + 2), by = position.getY(offset + 2), bz = position.getZ(offset + 2);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
      || !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)
      || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz))
    throw new Error("Nonfinite world geometry; export rejected");
  const ux = ax - x, uy = ay - y, uz = az - z, vx = bx - x, vy = by - y, vz = bz - z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return cx * cx + cy * cy + cz * cz > 1e-16;
}

export function exactIndex(geometry) {
  // Three's tolerance-based merge hashes truncate to 32 bits. Quantization can
  // collapse small valid faces; exact Float32 attribute equality never moves one.
  const names = Object.keys(geometry.attributes).sort();
  const attributes = names.map(name => geometry.getAttribute(name));
  if (geometry.index || attributes.some(attribute => attribute.isInterleavedBufferAttribute))
    throw new Error("Exact index expects flat noninterleaved attributes");
  const count = geometry.getAttribute("position").count;
  const values = attributes.map(() => []), indices = [], vertices = new Map();
  for (let i = 0; i < count; i += 1) {
    const samples = attributes.map(attribute => Array.from(attribute.array.subarray(i * attribute.itemSize, (i + 1) * attribute.itemSize)));
    const key = samples.map(sample => sample.join(",")).join("|");
    let vertex = vertices.get(key);
    if (vertex === undefined) {
      vertex = vertices.size;
      vertices.set(key, vertex);
      for (let a = 0; a < samples.length; a += 1) values[a].push(...samples[a]);
    }
    indices.push(vertex);
  }
  const result = new geometry.constructor();
  for (let a = 0; a < attributes.length; a += 1) {
    const source = attributes[a];
    result.setAttribute(names[a], new source.constructor(new source.array.constructor(values[a]), source.itemSize, source.normalized));
  }
  result.setIndex(indices);
  return result;
}

export function deduplicateFaces(geometry) {
  // Already exactly indexed and in ONE surface/material bucket. Cyclic rotations
  // are duplicates; reverse winding, different UVs/colours/materials remain distinct.
  const index = geometry.index, count = index.count ?? index.length;
  const at = i => index.getX ? index.getX(i) : index[i];
  const seen = new Set(), keep = [];
  for (let i = 0; i < count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const key = a <= b && a <= c ? `${a},${b},${c}` : b <= c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(a, b, c);
  }
  geometry.setIndex(keep);
  return (count - keep.length) / 3;
}
