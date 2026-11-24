// What a thrust (C) or a stroke of work (R) does to the thing in front, in words, from the
// mechanics engine (mechanics.mjs): how far the tip goes in, whether it sticks, glances or bends.
// The books (world.mjs cmd_strike) decide the damage; this says what the blow looks like, so a
// jab into a fence post reads differently from one on a steel bollard. Pure
// (tests/city_strike_preview.test.mjs).

//: The engine's implement for each of the city's strike kinds (rules.json items' strike), and for
//: a held thing with a point.
export const IMPLEMENT = { fists: "fist", hammer: "claw_hammer", sledgehammer: "sledgehammer", crowbar: "crowbar", axe: "felling_axe", screwdriver: "screwdriver",
  shovel: "spade", knife: "pocket_knife" };
//: A catalogue material word the engine has no pointer for: the substance it most likely is.
const FALLBACK = { wood: "douglas_fir_dry", timber: "douglas_fir_dry", lumber: "douglas_fir_dry", tree: "red_oak_green", metal: "mild_steel", iron: "grey_cast_iron",
  stone: "granite", brick: "clay_brick", plastic: "polypropylene", rubber: "rubber_tread", fabric: "cotton_canvas" };

//: The substance of a thing in front (its catalogue material), or null.
export function substanceOf(M, material, { tree = false } = {}) {
  if (tree) return "red_oak_green";
  const m = String(material || "").toLowerCase();
  let s = null;
  try { s = M.ofMaterial(m); } catch { s = null; }
  if (s) return s;
  for (const [k, v] of Object.entries(FALLBACK)) if (m.includes(k)) return v;
  return null;
}

//: The struck body: a tree's trunk, else a plate of the thing's material (a post, a panel).
function bodyFor(M, sub, tree) {
  return tree ? M.body({ substance: sub, shape: "round", diameter_m: 0.3 }) : M.body({ substance: sub, shape: "plate", thickness_m: 0.04 });
}

//: The words for one blow: {text, stuck, depth_mm} or null when the engine has nothing to say
//: (a tool it does not model, a material it does not know). ``mode``: "thrust" | "work";
//: ``energy_j``: the blow's energy.
export function strikePreview(M, { tool, material, tree = false, mode = "thrust", energy_j = 40 }) {
  const impl = IMPLEMENT[tool];
  const sub = substanceOf(M, material, { tree });
  if (!impl || !sub) return null;
  let t;
  try { t = M.tool(impl); } catch { return null; }
  // Only what touches is measured: a thrust leads with the point, else the edge (a spade's jab), else the face.
  const feature = mode === "thrust" ? (t.tip ? "tip" : t.edge ? "edge" : "face") : t.edge ? "edge" : t.tip ? "tip" : "face";
  let r;
  try { r = M.strike(t, bodyFor(M, sub, tree), { feature, energy_j, mode }); } catch { return null; }
  const mm = Math.round((r.depth_m || 0) * 1000 * 10) / 10;
  const kind = r.mark?.kind || "none";
  let text;
  if (r.glanced) text = r.on_rim ? "it lands on the rim and skids off" : "it glances off";
  else if (r.outcome === "through") text = "it goes right through";
  else if (r.outcome === "shatter") text = "it shatters";
  else if (kind === "none" || mm < 0.5) text = r.limit === "grip" ? "it will not bite: your grip gives first" : "it bounces off, hardly a mark";
  else text = `${feature === "tip" ? "the point goes in" : feature === "edge" ? "the edge bites" : "it dents it"} ${mm < 10 ? `${mm} mm` : `${(mm / 10).toFixed(1)} cm`}${r.stuck ? " and sticks" : ""}`;
  return { text, stuck: Boolean(r.stuck), depth_mm: mm, feature };
}
