// Cut positions in the original ingredient's footprint. Successive cuts refine
// the same footprint so a wedge can be sliced again after it leaves the board.
export function cutPieces(mode, fraction, bounds = [0, 1, 0, 1]) {
  const [x0, x1, z0, z1] = bounds,
    nx = mode === "split" ? 2 : mode === "slice" ? 6 : 4,
    nz = mode === "dice" ? 4 : 1;
  const edge = (i) => (mode === "split" ? [0, fraction, 1][i] : i / nx);
  const pieces = [];
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      pieces.push({
        share: (edge(x + 1) - edge(x)) / nz,
        bounds: [
          x0 + (x1 - x0) * edge(x),
          x0 + (x1 - x0) * edge(x + 1),
          z0 + ((z1 - z0) * z) / nz,
          z0 + ((z1 - z0) * (z + 1)) / nz,
        ],
      });
  return pieces;
}

// Clip each triangle against the knife planes in model space. Keep UVs for
// the skin and close exposed slices with an interior-coloured cap.
export function cutModel(T, model, bounds) {
  const result = new T.Group(),
    box = new T.Box3().setFromObject(model),
    span = box.getSize(new T.Vector3());
  const planes = [
    ["x", box.min.x + span.x * bounds[0], 1],
    ["x", box.min.x + span.x * bounds[1], -1],
    ["z", box.min.z + span.z * bounds[2], 1],
    ["z", box.min.z + span.z * bounds[3], -1],
  ];
  const cuts = planes.map(() => []);
  let flesh;
  model.traverse((m) => {
    if (!m.isMesh) return;
    const geo = m.geometry,
      pos = geo.attributes.position,
      tex = geo.attributes.uv,
      idx = geo.index;
    const vertices = [],
      uv = [];
    for (let i = 0; i < (idx?.count ?? pos.count); i += 3) {
      let poly = [];
      for (let k = 0; k < 3; k++) {
        const n = idx ? idx.getX(i + k) : i + k;
        poly.push({
          p: new T.Vector3().fromBufferAttribute(pos, n).applyMatrix4(m.matrixWorld),
          u: tex ? new T.Vector2().fromBufferAttribute(tex, n) : new T.Vector2(),
        });
      }
      for (const [axis, edge, sign] of planes) {
        const next = [];
        for (let j = 0; j < poly.length; j++) {
          const a = poly[j],
            b = poly[(j + 1) % poly.length],
            da = (a.p[axis] - edge) * sign,
            db = (b.p[axis] - edge) * sign;
          if (da >= 0) next.push(a);
          if (da < 0 !== db < 0) {
            const t = da / (da - db);
            next.push({ p: a.p.clone().lerp(b.p, t), u: a.u.clone().lerp(b.u, t) });
          }
        }
        poly = next;
      }
      for (const v of poly)
        planes.forEach(([axis, edge], k) => {
          if (Math.abs(v.p[axis] - edge) < 1e-6) cuts[k].push(v.p);
        });
      for (let j = 1; j + 1 < poly.length; j++)
        for (const v of [poly[0], poly[j], poly[j + 1]]) {
          vertices.push(...v.p.toArray());
          uv.push(...v.u.toArray());
        }
    }
    if (!vertices.length) return;
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    out.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    out.computeVertexNormals();
    result.add(new T.Mesh(out, m.material));
    flesh ||= (Array.isArray(m.material) ? m.material[0] : m.material)?.color;
  });
  for (const [k, points] of cuts.entries()) {
    if (points.length < 3) continue;
    const side = planes[k][0] === "x" ? "z" : "x";
    const center = points.reduce((c, p) => c.add(p), new T.Vector3()).multiplyScalar(1 / points.length);
    points.sort(
      (a, b) =>
        Math.atan2(a.y - center.y, a[side] - center[side]) - Math.atan2(b.y - center.y, b[side] - center[side]),
    );
    const verts = [];
    for (let i = 0; i < points.length; i++)
      verts.push(...center.toArray(), ...points[i].toArray(), ...points[(i + 1) % points.length].toArray());
    const cap = new T.BufferGeometry();
    cap.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
    cap.computeVertexNormals();
    result.add(
      new T.Mesh(
        cap,
        new T.MeshStandardMaterial({
          side: T.DoubleSide,
          color: (flesh?.clone() || new T.Color(0xe4bc80)).lerp(new T.Color(0xffdcab), 0.55),
        }),
      ),
    );
  }
  const b = new T.Box3().setFromObject(result),
    c = b.getCenter(new T.Vector3());
  for (const m of result.children) m.position.set(-c.x, -b.min.y, -c.z);
  return result.children.length ? result : model;
}
