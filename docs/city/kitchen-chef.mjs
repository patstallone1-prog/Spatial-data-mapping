import { cloneSkinned, dressMannequin } from "./npc-figures.mjs";

// The same Manny skeleton and locomotion clips as the near ring. Reach targets
// are in the cook's frame, so the wrists stay with the dish while turning.
export async function kitchenChef(T, kit, chef) {
  let url = (file) => kit.asset("city/models/npc/" + file);
  if (kit.npcStore) {
    const current = await fetch(new URL("current.json", kit.npcStore))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (current?.build) url = (file) => new URL(current.build + "/" + file, kit.npcStore).href;
  }
  const [body, clips] = await Promise.all([kit.loadModel(url("manny.glb")), kit.loadModel(url("clips.glb"))]);
  const rig = cloneSkinned(T, body.scene),
    bones = {};
  rig.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) {
      o.geometry = o.geometry.clone();
      dressMannequin(T, o);
      o.material.userData.bands[1].set("#ece6d5");
      o.normalizeSkinWeights();
      o.frustumCulled = false;
      o.castShadow = true;
    }
  });
  const size = new T.Box3().setFromObject(rig),
    height = size.max.y - size.min.y;
  rig.scale.multiplyScalar(1.76 / height);
  rig.position.y -= (size.min.y * 1.76) / height;
  chef.add(rig);
  const mixer = new T.AnimationMixer(rig);
  const actions = Object.fromEntries(
    clips.animations.map((c) => [
      c.name,
      mixer
        .clipAction(
          new T.AnimationClip(
            c.name,
            c.duration,
            c.tracks.filter((t) => t.name.endsWith(".quaternion")),
          ),
        )
        .play(),
    ]),
  );
  let grip = 0;
  const from = new T.Vector3(),
    to = new T.Vector3(),
    base = new T.Vector3(),
    target = new T.Vector3(),
    q = new T.Quaternion(),
    parent = new T.Quaternion();
  function aim(joint, end, weight) {
    joint.getWorldPosition(base);
    end.getWorldPosition(from).sub(base).normalize();
    to.copy(target).sub(base).normalize();
    joint.parent.getWorldQuaternion(parent);
    q.setFromUnitVectors(from, to).premultiply(parent.clone().invert()).multiply(parent);
    joint.quaternion.slerp(q.multiply(joint.quaternion.clone()), weight);
    joint.updateWorldMatrix(false, true);
  }
  return (dt, speed, holding, chopping, reach) => {
    for (const [name, action] of Object.entries(actions))
      action.weight = T.MathUtils.damp(action.weight, name === (speed > 0.1 ? "walk" : "idle") ? 1 : 0, 10, dt);
    mixer.update(dt);
    grip = T.MathUtils.damp(grip, holding || chopping || reach > 0 ? 1 : 0, 12, dt);
    if (grip < 0.01) return;
    for (const [index, side] of ["l", "r"].entries()) {
      const hand = bones["hand_" + side],
        upper = bones["upperarm_" + side],
        lower = bones["lowerarm_" + side];
      if (!hand || !upper || !lower) continue;
      upper.getWorldPosition(base);
      chef.worldToLocal(base);
      target.set(
        Math.sign(base.x) * 0.09,
        1.06 - 0.1 * reach + (chopping && index ? 0.09 * Math.sin(performance.now() / 55) : 0),
        0.29 + 0.13 * reach,
      );
      chef.localToWorld(target);
      for (let i = 0; i < 3; i++) {
        aim(lower, hand, grip * 0.8);
        aim(upper, hand, grip * 0.8);
      }
    }
  };
}
