// Settings are game-time approximations. Dose is seconds at the middle setting,
// integrated through warm-up so turning a dial cannot change earlier cooking.
const profiles = {
  stove: [110, 180, 240],
  grill: [130, 190, 250],
  oven: [140, 180, 225],
  pizza_oven: [230, 330, 440],
  tandoor: [200, 300, 420],
  wok: [140, 210, 270],
  fryer: [145, 175, 195],
  steamer: [75, 90, 100],
  kettle: [70, 85, 100],
  espresso: [85, 93, 98],
  cooler: [12, 5, 1],
};
export const levels = ["off", "low", "medium", "high"];
export function appliance(id, state, now) {
  const temperatures = profiles[id],
    ambient = temperatures ? 21 : 0;
  const level = state?.level || "off",
    index = levels.indexOf(level);
  const target = index > 0 ? (temperatures || [0.58, 1, 1.55])[index - 1] : ambient;
  const start = state?.value ?? ambient,
    dt = Math.max(0, (now - (state?.at ?? now)) / 1000);
  const tau = temperatures ? (/oven|tandoor/.test(id) ? 12 : 5) : 0;
  const decay = tau ? Math.exp(-dt / tau) : 0;
  const value = target + (start - target) * decay;
  const reference = temperatures ? temperatures[1] - ambient : 1;
  const dose = (state?.dose || 0) + ((target - ambient) * dt + (start - target) * tau * (1 - decay)) / reference;
  return { level, target, value, dose, at: now, thermal: !!temperatures };
}
export function dial(id, state, now, level) {
  return { ...appliance(id, state, now), level };
}
export function applianceLabel(id, state, now) {
  const a = appliance(id, state, now);
  return a.thermal
    ? Math.round(a.value) + " °C → " + Math.round(a.target) + " °C"
    : (id === "blender" ? "Blender speed" : "Power") + " · " + a.level;
}
