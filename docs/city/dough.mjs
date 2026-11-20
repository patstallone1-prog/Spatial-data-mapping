// Footprints in cm. Thickness follows from the portion's volume, including for an ellipsoid.
export const DOUGH_FORMS = { ball: "Ball", circle: "Flat circle", triangle: "Triangle", rectangle: "Rectangle" };
export function validShape(s) {
  return (
    s &&
    Object.hasOwn(DOUGH_FORMS, s.form) &&
    Number.isFinite(s.span) &&
    s.span >= 3 &&
    s.span <= 50 &&
    Number.isFinite(s.aspect) &&
    s.aspect >= 0.4 &&
    s.aspect <= 2.5
  );
}
export function doughDimensions(grams, shape) {
  const width = shape.span,
    length = width / shape.aspect;
  const factor = { ball: Math.PI / 6, circle: Math.PI / 4, triangle: 0.5, rectangle: 1 }[shape.form];
  return { width, length, height: grams / (1.08 * width * length * factor) };
}
export function workableDough(items) {
  if (
    !items.length ||
    items.some((i) =>
      i.chain.some((p) => ["bake", "fry", "grill", "toast", "micro", "boil", "steam", "saute", "wok"].includes(p)),
    )
  )
    return false;
  if (items.length === 1 && items[0].ing.endsWith("_dough")) return true;
  return (
    items[0].batch &&
    items.every((i) => i.batch === items[0].batch) &&
    items.some((i) => i.ing === "flour") &&
    items.some((i) => ["water", "milk", "egg", "cream"].includes(i.ing))
  );
}
export function doughMesh(THREE, grams, shape, baked) {
  const { width, length, height } = doughDimensions(grams, shape);
  let geometry;
  if (shape.form === "ball") geometry = new THREE.SphereGeometry(0.5, 28, 18);
  if (shape.form === "circle") geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
  if (shape.form === "rectangle") geometry = new THREE.BoxGeometry(1, 1, 1);
  if (shape.form === "triangle") {
    const outline = new THREE.Shape();
    outline.moveTo(-0.5, -0.5);
    outline.lineTo(0.5, -0.5);
    outline.lineTo(0, 0.5);
    outline.closePath();
    geometry = new THREE.ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.5, 0);
  }
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: baked ? 0xc48241 : 0xecd49e, roughness: 0.88 }),
  );
  mesh.scale.set(width / 100, height / 100, length / 100);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
