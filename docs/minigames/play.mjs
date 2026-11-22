import * as THREE from "three";
import { GLTFLoader } from "../vendor/three-0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "../vendor/three-0.160.0/examples/jsm/libs/meshopt_decoder.module.js";
import { loadRules } from "../city/core.mjs";
import { CityWorld } from "../city/world.mjs";
import { kitchenPanel } from "../city/kitchen-panel.mjs";
import { workshopPanel } from "../city/workshop-panel.mjs";
import { fleetParts, fleetFile, fleetMaterial } from "../city/vehicles.mjs";

const game = new URLSearchParams(location.search).get("game");
const output = document.querySelector("#notice");
let timeout;
function notify(message) {
  clearTimeout(timeout);
  output.textContent = message;
  timeout = setTimeout(() => {
    output.textContent = "";
  }, 5000);
}
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("aria-") || key.startsWith("data-")) el.setAttribute(key, value);
    else el[key] = value;
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}
async function play() {
  const mechanic = game === "mechanic";
  const R = loadRules(await (await fetch("../city/rules.json")).json());
  const noon = Date.UTC(2026, 10, 11, 20);
  const world = new CityWorld(R, { now: noon, seed: "practice" });
  const offset = Date.now() - world.clock.real(noon);
  const at = { x: 0, z: 0, lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
  const place = {
    ...at,
    id: game,
    area: 140,
    name: mechanic ? "Marina Auto" : "Chestnut Diner",
    keys: mechanic ? ["shop:auto_parts"] : ["use:restaurant", "shop:american"],
  };
  const send = (cmd, args) => {
    world.step(world.clock.game(Date.now() - offset));
    return world.submit("employee", cmd, { ...args, at });
  };
  function check(r) {
    if (!r.ok) throw Error(r.error);
  }
  check(send("join", { name: "Employee" }));
  check(send("take_job", { role: mechanic ? "mechanic" : "cook", place }));
  check(send("clock_in", { spots: { counter: at } }));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const asset = (path) => new URL("../" + path, import.meta.url).href;
  const api = {
    R,
    h,
    doc: document,
    THREE,
    send,
    notify,
    self: () => world.player("employee"),
    getView: () => world,
    placeArg: (p) => p,
  };
  if (!mechanic) {
    const kitchen = kitchenPanel({
      ...api,
      district: { places: [place] },
      me: () => at,
      clock: { real: (t) => world.clock.real(t) + offset },
      asset,
      loadModel: (url) => loader.loadAsync(url),
    });
    await kitchen.open(place);
    return;
  }
  check(world.submit("driver", "join", { at, name: "Alex" }));
  const kits = new Map();
  const makeCar = (model, colour) => {
    const group = new THREE.Group();
    if (!kits.has(model))
      kits.set(
        model,
        loader.loadAsync(asset(fleetFile(model, "full"))).then((gltf) => fleetParts(THREE, gltf)),
      );
    kits.get(model).then((parts) => {
      if (group.userData.bayDisposed) return;
      for (const part of parts) {
        const m = new THREE.InstancedMesh(part.geometry, fleetMaterial(THREE, part, { standard: true }), 1);
        m.setMatrixAt(0, new THREE.Matrix4());
        if (part.tint) m.setColorAt(0, new THREE.Color(colour));
        group.add(m);
      }
    });
    return group;
  };
  for (const [fault, plate, model] of [
    ["fender", "WING01", "sports"],
    ["ground", "EARTH02", "suv"],
    ["relay", "RELAY03", "economy"],
  ]) {
    world.registry.register(
      plate,
      "vehicle",
      "player:driver",
      { ...at, model, plate, condition: 65, serviceFault: fault },
      world.now,
    );
    check(world.submit("driver", "workshop_intake", { at, place, vehicle: plate }));
  }
  workshopPanel({ ...api, makeCar, visitors: () => [] }).open(place);
}
if (["mechanic", "kitchen"].includes(game))
  play().catch((e) => {
    output.textContent = e.message;
    console.error(e);
  });
