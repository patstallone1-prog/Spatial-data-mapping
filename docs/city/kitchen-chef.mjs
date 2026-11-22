// The cook, as the people near you in the city are drawn (npc-figures.mjs: the MakeHuman crowd, its
// face finer than its body), with the kitchen's own clips baked in: carrying in both hands, reaching
// down to the counter to pick up or put down, chopping, stirring at the stove, pouring. What the cook
// holds is put where the hands are in the frame being drawn, so it moves with them.

import { npcFigures, FACING_OFFSET } from "./npc-figures.mjs";

const COOKS = [
  { female: false, look: { skin: "#b98563", hair: "#1e1611", cut: "short", top: "#f3f1ea", bottom: "#2a2d33", shoes: "#1c1c1c", legs: "trousers", age: 31, build: 1 } },
  { female: true, look: { skin: "#d2a07e", hair: "#3a2416", cut: "ponytail", top: "#f3f1ea", bottom: "#24272c", shoes: "#1c1c1c", legs: "trousers", age: 28, build: 0.9 } },
  { female: false, look: { skin: "#7a5038", hair: "#120d0a", cut: "short", top: "#f3f1ea", bottom: "#2a2d33", shoes: "#1c1c1c", legs: "trousers", age: 42, build: 1.05 } },
];

//: A cook for ``chef`` (the scene's group: where they stand and which way they face). Resolves when
//: the body is loaded and baked, to {pose(dt, state), hands()}; rejects if it cannot be (the scene
//: keeps its stand-in then). ``seed`` picks which cook.
export async function kitchenChef(T, kit, chef, scene, seed = "") {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const who = COOKS[h % COOKS.length];
  const figures = npcFigures(T, { loadModel: kit.loadModel, asset: kit.asset, parent: scene, store: kit.npcStore || null, capacity: 1, work: true, only: who.female ? "female" : "male" });
  const id = `kitchen-cook:${seed}`;
  figures.start();
  const t0 = performance.now();
  while (!figures.ready) {
    if (figures.failed || performance.now() - t0 > 45_000) throw new Error("the cook's body did not load");
    await new Promise((ok) => setTimeout(ok, 120));
  }
  const entry = { id, x: 0, y: 0, z: 0, yaw: 0, height: 1.72, build: who.look.build, speed: 0, moving: false, female: who.female, look: who.look, work: null, workKey: 0 };
  return {
    //: Each frame: the cook where ``chef`` is, doing ``state.work`` ("carry", "reach", "chop",
    //: "stir", "pour" or nothing), ``state.key`` changing to start a reach again.
    pose(dt, { speed = 0, work = null, key = 0 } = {}) {
      entry.x = chef.position.x; entry.y = chef.position.y; entry.z = chef.position.z;
      entry.yaw = chef.rotation.y - FACING_OFFSET;
      entry.speed = speed; entry.moving = speed > 0.1;
      entry.work = work; entry.workKey = key;
      figures.draw([entry], performance.now(), dt);
    },
    //: Where the hands are, in the cook's own frame (``chef``'s: facing +z, the floor at 0).
    hands: () => figures.handsOf(id),
    clip: () => figures.clipOf(id),
    stats: () => figures.stats(),
  };
}
