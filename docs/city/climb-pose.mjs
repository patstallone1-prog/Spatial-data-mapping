// Bending a figure to where its hands and feet are: two-bone reaching (an arm to a hold, a leg to a
// foothold) and a grip of the fingers, on any rig with an upper and lower limb bone and an end
// (Mixamo's names, the avatar creator's, the drawn walker's). Used for climbing (climb-motion.mjs
// says where each limb is going), and for eating and drinking (eat-play.mjs brings a hand to
// the mouth). Applied after the walking clip each frame, as the other poses are (view.mjs
// afterPose); nothing here keeps state between frames but scratch vectors.

//: The bones a pose works with, found once per figure by the names rigs use.
export function limbBones(avatar) {
  const find = (...names) => { for (const n of names) { const o = avatar.getObjectByName?.(n); if (o?.parent) return o; } return null; };
  return {
    hips: find("mixamorigHips", "Hips", "pelvis", "Pelvis"),
    spine: find("mixamorigSpine1", "mixamorigSpine", "Spine1", "Spine", "spine_02", "spine_01"),
    chest: find("mixamorigSpine2", "Spine2", "spine_03"),
    neck: find("mixamorigNeck", "Neck", "neck_01"),
    head: find("mixamorigHead", "Head", "head"),
    lUpper: find("mixamorigLeftArm", "LeftArm", "upperarm_l", "UpperArm_L"), lFore: find("mixamorigLeftForeArm", "LeftForeArm", "lowerarm_l", "LowerArm_L"),
    lHand: find("mixamorigLeftHand", "LeftHand", "hand_l", "Hand_L"),
    rUpper: find("mixamorigRightArm", "RightArm", "upperarm_r", "UpperArm_R"), rFore: find("mixamorigRightForeArm", "RightForeArm", "lowerarm_r", "LowerArm_R"),
    rHand: find("mixamorigRightHand", "RightHand", "hand_r", "Hand_R"),
    lThigh: find("mixamorigLeftUpLeg", "LeftUpLeg", "thigh_l", "Thigh_L"), lShin: find("mixamorigLeftLeg", "LeftLeg", "calf_l", "Calf_L"),
    lFoot: find("mixamorigLeftFoot", "LeftFoot", "foot_l", "Foot_L"),
    rThigh: find("mixamorigRightUpLeg", "RightUpLeg", "thigh_r", "Thigh_R"), rShin: find("mixamorigRightLeg", "RightLeg", "calf_r", "Calf_R"),
    rFoot: find("mixamorigRightFoot", "RightFoot", "foot_r", "Foot_R"),
  };
}

export function createLimbIK(THREE) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3(), e = new THREE.Vector3();
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), bend = new THREE.Vector3(), tmp = new THREE.Vector3();
  const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qB = new THREE.Quaternion(), qI = new THREE.Quaternion();

  //: Turn ``bone`` (in the world) by the rotation taking world direction ``from`` to ``to``.
  function swing(bone, from, to, weight = 1) {
    if (!bone?.parent || from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
    qW.setFromUnitVectors(d1.copy(from).normalize(), d2.copy(to).normalize());
    if (weight < 1) qW.slerp(qI.identity(), 1 - weight);
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(qP);
    bone.getWorldQuaternion(qB);
    // world' = qW * world  ->  local' = parent^-1 * qW * parent * local
    bone.quaternion.copy(qP.clone().invert().multiply(qW).multiply(qB));
    bone.updateWorldMatrix(false, true);
  }

  //: Reach ``end`` (the joint at the end of ``lower``: a wrist, an ankle) to world point ``target``
  //: by turning ``upper`` and ``lower``, the middle joint (elbow, knee) bent toward world point
  //: ``pole``. ``weight`` blends from the clip's pose (0) to the reach (1). Returns how far short
  //: the end is (m): 0 where it reaches.
  function reach(upper, lower, end, target, pole, weight = 1) {
    if (!upper || !lower || !end || weight <= 0) return 0;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(a); lower.getWorldPosition(b); end.getWorldPosition(c);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    t.copy(target).sub(a);
    const want = t.length(), dist = Math.min(Math.max(want, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
    t.normalize();
    // Where the middle joint goes: on the circle the two lengths allow, toward the pole.
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    bend.copy(pole).sub(a); bend.addScaledVector(t, -bend.dot(t));
    if (bend.lengthSq() < 1e-10) bend.set(0, -1, 0).addScaledVector(t, -t.y);
    bend.normalize();
    e.copy(a).addScaledVector(t, x).addScaledVector(bend, h);
    swing(upper, tmp.copy(b).sub(a), d2.copy(e).sub(a).clone(), weight);
    lower.getWorldPosition(b); end.getWorldPosition(c);
    const aim = tmp.copy(a).addScaledVector(t, dist).sub(b);
    swing(lower, c.clone().sub(b), aim, weight);
    end.getWorldPosition(c);
    return Math.max(0, want - dist);
  }

  //: Curl the fingers of ``hand`` by ``amount`` (0 open, 1 a fist round a bar), the thumb by
  //: ``thumb`` (default the same): each finger joint turned about the palm's width.
  function grip(hand, amount, thumb = amount) {
    if (!hand || amount <= 0) return;
    const fingers = [], thumbs = [];
    hand.traverse((o) => { if (o === hand || !o.isBone) return; (/thumb/i.test(o.name) ? thumbs : fingers).push(o); });
    if (!fingers.length) return;
    const index = fingers.find((o) => /index1|index_01/i.test(o.name)), pinky = fingers.find((o) => /pinky1|pinky_01|little1/i.test(o.name));
    if (!index || !pinky) return;
    index.getWorldPosition(a); pinky.getWorldPosition(b);
    const across = b.clone().sub(a).normalize();
    // Which way round curls inward: toward the palm (the side the hand's fingers bend to in rest).
    for (const f of fingers) {
      const j = Number((f.name.match(/(\d)(?!.*\d)/) || [0, 1])[1]) || 1;
      f.updateWorldMatrix(true, false);
      qW.setFromAxisAngle(across, -amount * (j === 1 ? 1.25 : j === 2 ? 1.45 : 1.1));
      f.parent.getWorldQuaternion(qP); f.getWorldQuaternion(qB);
      f.quaternion.copy(qP.clone().invert().multiply(qW).multiply(qB));
    }
    for (const f of thumbs) {
      f.updateWorldMatrix(true, false);
      qW.setFromAxisAngle(across, -thumb * 0.5);
      f.parent.getWorldQuaternion(qP); f.getWorldQuaternion(qB);
      f.quaternion.copy(qP.clone().invert().multiply(qW).multiply(qB));
    }
  }

  //: Turn ``bone`` so its world direction toward ``childWorld`` swings by ``angle`` about world
  //: ``axis`` (a nod of the head, a lean of the back).
  function turnAbout(bone, axis, angle) {
    if (!bone?.parent || !angle) return;
    qW.setFromAxisAngle(tmp.copy(axis).normalize(), angle);
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(qP); bone.getWorldQuaternion(qB);
    bone.quaternion.copy(qP.clone().invert().multiply(qW).multiply(qB));
    bone.updateWorldMatrix(false, true);
  }

  return { reach, grip, swing, turnAbout };
}

//: A face's frame in the world: ``origin`` (a point on its face at the ground, u = 0), ``along``
//: (unit, horizontal: the climber's right as they face it), ``out`` (unit, horizontal: from the
//: face toward the climber). ``toWorld(u, v, out, into)`` puts a face point into a Vector3.
export function faceFrame(THREE, origin, along, out) {
  const O = origin.clone(), A = along.clone().setY(0).normalize(), N = out.clone().setY(0).normalize();
  return {
    origin: O, along: A, out: N,
    toWorld(u, v, o, into = new THREE.Vector3()) { return into.copy(O).addScaledVector(A, u).addScaledVector(N, o).setY(O.y + v); },
    //: The yaw a figure facing the face has (its +z ahead toward the face).
    facingYaw: (side = 1) => Math.atan2(-N.x * side, -N.z * side),
  };
}

//: Bend ``avatar`` to climb-motion's ``frame`` on face frame ``F``: the hips where the frame puts
//: them (the figure moved so its hips bone lands there), facing the face, each limb reached to its
//: place, the fingers gripping by how the hold is held. ``ik``: createLimbIK. ``B``: limbBones.
//: ``hipRest``: the hips bone's height above the figure's feet standing (m).
export function poseClimber(THREE, avatar, B, ik, F, frame, hipRest, hipBone = 0) {
  // The frame's hips are the hip joints; the hips bone sits a little above them.
  const hip = F.toWorld(frame.hip.u, frame.hip.v + hipBone, frame.hip.out);
  const yaw = F.facingYaw(frame.side);
  avatar.rotation.y = yaw;
  avatar.position.set(hip.x, hip.y - hipRest, hip.z);
  avatar.updateMatrixWorld(true);
  // The hips bone where the frame wants it (the clip may have it off centre): the rest of the
  // figure follows from the root.
  if (B.hips) {
    const at = B.hips.getWorldPosition(new THREE.Vector3());
    avatar.position.x += hip.x - at.x; avatar.position.z += hip.z - at.z; avatar.position.y += hip.y - at.y;
    avatar.updateMatrixWorld(true);
  }
  const up = new THREE.Vector3(0, 1, 0), side = F.along.clone().multiplyScalar(frame.side), outN = F.out.clone().multiplyScalar(frame.side);
  // Lean in toward the face: the back over a little, the more the higher the hands are.
  const hv = Math.max(frame.limbs.lh?.v ?? 0, frame.limbs.rh?.v ?? 0) - frame.hip.v;
  ik.turnAbout(B.spine, side, -0.12 - 0.08 * Math.min(1, Math.max(0, hv - 0.6)));
  // The head turned up toward the hands.
  ik.turnAbout(B.head, side, -0.25 * Math.min(1, Math.max(0, hv - 0.4)));
  const T = new THREE.Vector3(), P = new THREE.Vector3();
  const limbs = [
    ["lh", B.lUpper, B.lFore, B.lHand, -1, true], ["rh", B.rUpper, B.rFore, B.rHand, 1, true],
    ["lf", B.lThigh, B.lShin, B.lFoot, -1, false], ["rf", B.rThigh, B.rShin, B.rFoot, 1, false],
  ];
  const short = {};
  for (const [k, upper, lower, end, s, hand] of limbs) {
    const l = frame.limbs[k];
    if (!l || !upper) continue;
    F.toWorld(l.u, l.v, l.out, T);
    // The wrist sits a hand's length below the grip and off the face; the ankle above the toe.
    if (hand) T.addScaledVector(up, -0.07).addScaledVector(outN, 0.04);
    else T.addScaledVector(up, 0.08).addScaledVector(outN, 0.1);
    upper.getWorldPosition(P);
    // Elbows down and out, off the face; knees out to the side and toward the face (a frog).
    // (Pressing down on a top below the shoulders, the elbows go back and up instead.)
    if (hand) { const below = T.y < P.y - 0.05; P.addScaledVector(up, below ? 0.15 : -0.4).addScaledVector(outN, below ? 0.45 : 0.3).addScaledVector(side, (below ? 0.2 : 0.35) * s); }
    else P.addScaledVector(outN, -0.45).addScaledVector(side, 0.3 * s).addScaledVector(up, 0.15);
    short[k] = ik.reach(upper, lower, end, T, P);
    if (hand) ik.grip(end, l.grip ?? 0.8);
  }
  return short;
}

//: The body as the figure is built (climb-route BODY's figures), measured standing: so the holds a
//: climb plans are ones this figure's arms and legs reach. ``B``: limbBones; the figure upright in
//: its clip's first frame, its feet ``feetBelow`` under ``avatar.position.y`` (the page's walker
//: has its origin a little above its feet). Also ``hip_bone_m``: how far its hips bone is above
//: its hip joints, and ``hip_rest_m``: the hips bone's height above its feet standing.
export function bodyFromRig(THREE, avatar, B, base = {}, feetBelow = 0) {
  const P = (o) => o.getWorldPosition(new THREE.Vector3());
  avatar.updateMatrixWorld(true);
  if (!B.rUpper || !B.rFore || !B.rHand || !B.rThigh || !B.rShin || !B.rFoot || !B.hips) return null;
  const feet = avatar.position.y - feetBelow, thigh = P(B.rThigh), shoulder = P(B.rUpper), lShoulder = B.lUpper ? P(B.lUpper) : shoulder.clone();
  const arm = P(B.rUpper).distanceTo(P(B.rFore)) + P(B.rFore).distanceTo(P(B.rHand)) + 0.08;
  const leg = P(B.rThigh).distanceTo(P(B.rShin)) + P(B.rShin).distanceTo(P(B.rFoot)) + (P(B.rFoot).y - feet);
  const box = new THREE.Box3().setFromObject(avatar);
  const height = box.max.y - feet;
  return {
    ...base, height_m: height, torso_m: shoulder.y - thigh.y, arm_m: arm, leg_m: leg,
    shoulder_half_m: shoulder.distanceTo(lShoulder) / 2, hip_half_m: Math.max(0.06, (B.lThigh ? P(B.lThigh).distanceTo(thigh) : 0) / 2),
    standing_reach_m: shoulder.y - feet + arm, tuck_m: 0.38 * height / 1.75,
    hip_bone_m: P(B.hips).y - thigh.y, hip_rest_m: P(B.hips).y - feet,
  };
}
