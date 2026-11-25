// A hearing of yours at the courthouse (courthouse.mjs), played in the room (2026-11-24).
//
// The link in your summons brings you here: the city's own streets are put away, the courthouse
// is built under where you stood (closed in: nothing of the city is seen from it) and you are set
// down in the corridor outside Department 12. When you go in (or after half a minute) the case is
// called: all rise, the judge comes in from chambers, the prosecutor opens, witnesses are called
// to the stand and step down, the defence answers, you say your piece, the jury goes out to the
// jury room -- you can follow and look in -- and comes back, the foreperson reads the verdict, the
// judge passes sentence with the gavel, and court is adjourned. Then you are back where you were,
// the sentence carried out (law.mjs cmd_court_conclude, trial.mjs rule). Leaving before then is
// not allowed: the street doors are held.
import { WAYS, atExit, buildCourthouse, canWalk, castOf, hearingOf, roomAt, seatsOf } from "./courthouse.mjs";

const CSS = `#city-court{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);width:min(860px,92vw);background:rgba(14,20,32,.9);color:#f4efe2;border:1px solid #d4b25c;border-radius:10px;padding:12px 16px;font:15px/1.45 Georgia,serif;z-index:60;box-shadow:0 8px 30px rgba(0,0,0,.4)}
#city-court .who{font:bold 12px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#d4b25c;margin-bottom:4px;display:flex;gap:8px;align-items:center}
#city-court .who .tag{background:#d4b25c;color:#141a26;border-radius:4px;padding:1px 6px}
#city-court .hint{font:11px Arial,sans-serif;color:#b9b2a0;margin-top:6px}
#city-court[hidden]{display:none}`;

export function createCourtSession(api) {
  const { THREE, R, ctx, group, send, notify, me, glass, onEnd } = api;
  const S = { active: false, phase: null };
  let built = null, O = null, cast = [], byId = new Map(), beats = [], beat = -1, beatT = 0, file = null, caseId = null, back = null, hidden = [], result = null, startT = 0, exitNoted = 0, gavelT = -1;
  const doc = globalThis.document;
  const box = (() => { if (!doc) return null; if (!doc.getElementById("city-court-css")) doc.head.append(Object.assign(doc.createElement("style"), { id: "city-court-css", textContent: CSS })); const el = doc.createElement("div"); el.id = "city-court"; el.hidden = true; doc.body.append(el); return el; })();
  const caption = (name, tag, text, hint = true) => {
    if (!box) return;
    box.hidden = !text; if (!text) return;
    box.innerHTML = "";
    const who = doc.createElement("div"); who.className = "who"; who.append(Object.assign(doc.createElement("span"), { textContent: name || "" })); if (tag) who.append(Object.assign(doc.createElement("span"), { className: "tag", textContent: tag }));
    box.append(who, Object.assign(doc.createElement("div"), { textContent: text }));
    if (hint) box.append(Object.assign(doc.createElement("div"), { className: "hint", textContent: "Space: on to the next. You may walk about the courthouse; the hearing goes on. Click a chair to sit." }));
  };
  const L = (x, z) => ({ x: O.x + x, z: O.z + z });          // the plan's frame to the world's
  const local = (x, z) => ({ x: x - O.x, z: z - O.z });
  const TAGS = { judge: "Judge", prosecution: "Prosecution", defence: "Defence", witness: "Witness", accused: "You", bailiff: "Bailiff", clerk: "Clerk", juror: "Foreperson" };

  //: Into court for case ``cid``: asked of the world, then the building put up and you in it.
  async function enter(cid) {
    if (S.active) return false;
    const r = await send("court_session", { case: cid });
    if (!r.ok) { notify(r.error); return false; }
    file = r.file; caseId = cid; result = null;
    const here = me();
    back = { x: here.x, y: here.y - ctx.standY, z: here.z, yaw: ctx.getYaw?.() ?? 0, fp: Boolean(ctx.isFirstPerson?.()) };
    // Under where you stood, closed in: the page's own world put away while you are here.
    O = { x: here.x - 6, y: (ctx.groundAt?.(here.x, here.z) ?? here.y) - 70, z: here.z - 25 };
    const judgeName = typeof file.judge === "string" ? file.judge.replace(/^(the )?(hon\.?|judge)\s+/i, "") : "";
    built = buildCourthouse(THREE, { judge: judgeName, glass });
    built.group.position.set(O.x, O.y, O.z);
    group.add(built.group);
    hidden = [];
    const keep = new Set(); for (let o = ctx.avatar; o; o = o.parent) keep.add(o);
    for (const o of ctx.root.children) if (o !== group && !keep.has(o) && !o.isLight && o.visible) { o.visible = false; hidden.push(o); }
    cast = castOf(R, file, { severity: r.severity, seed: `${r.trial}` });
    byId = new Map(cast.map((c) => [c.id, c]));
    for (const c of cast) { c.at = { x: c.seat.x, z: c.seat.z }; c.yaw = c.seat.yaw; c.sitting = Boolean(c.sits); c.path = null; c.activity = c.sitting ? "sitting" : "standing"; }
    const judge = byId.get("court:judge"); if (judge) { const ch = seatsOf().chambers[0]; judge.at = { x: ch.x, z: ch.z }; judge.yaw = ch.yaw; judge.sitting = true; }
    beats = hearingOf(file); beat = -1; beatT = 0; startT = performance.now(); S.active = true; S.phase = "waiting";
    ctx.firstPerson?.(true);
    ctx.setFloor?.(O.y);
    const st = L(0, 30.5);
    ctx.placeAvatar(st.x, O.y, st.z, -Math.PI / 2);   // (facing the courtroom's doors)
    ctx.setPitch?.(-0.04);
    doc?.addEventListener("keydown", onKey, true);
    const n = cast.filter((c) => c.role === "public").length;
    notify(`The Superior Court, Civic Center Courthouse, 400 McAllister St. Your case is in Department 12, through the double doors: go in and take your seat at the defence table. ${n ? `${n} have come to watch.` : "The gallery is empty."}`);
    return true;
  }
  function onKey(e) { if (S.active && e.code === "Space" && beat >= 0 && beats[beat] && !["out", "deliberate", "back", "verdict"].includes(beats[beat].kind)) { e.preventDefault(); e.stopPropagation(); beatT = 1e9; } }

  //: Someone walks a way (plan points), then sits or stands where they end.
  function walk(c, pts, then = null, sit = true) { c.path = pts.map(([x, z]) => ({ x, z })); c.pathK = 0; c.then = then; c.sitAfter = sit; c.sitting = false; }
  function seatPath(c, seat, via = []) { return [[c.at.x, c.at.z], ...via, [seat.x, seat.z]]; }
  const galleryOut = (c) => [[Math.min(9.45, c.at.x + 0.6), c.at.z], [9.45, 25.0]];
  function startBeat(b) {
    beatT = 0;
    const who = b.who, c = byId.get(who === "prosecution" ? "court:people" : who === "defence" ? "court:defence" : who.startsWith("witness:") ? `court:${who.replace(":", ":")}` : who === "juror:0" ? "court:juror:0" : `court:${who}`);
    for (const x of cast) if (x.activity === "talking") x.activity = x.sitting ? "sitting" : "standing";
    if (b.kind === "rise") {
      for (const x of cast) if (x.role !== "judge") { x.sitting = false; x.activity = "standing"; }
      const j = byId.get("court:judge"); if (j) walk(j, [[j.at.x, j.at.z], ...WAYS.judgeIn, [19.45, 25.0]], () => { j.yaw = Math.PI / 2; }, false);
      caption(byId.get("court:bailiff")?.name, "Bailiff", b.text);
    } else if (b.kind === "order") {
      for (const x of cast) if (x.sits) x.sitting = true;
      const j = byId.get("court:judge"); if (j) { j.at = { x: 19.45, z: 25.0 }; j.path = null; j.sitting = true; j.yaw = Math.PI / 2; }
      gavelT = 0; caption(byId.get("court:judge")?.name, "Judge", `People of the State of California versus ${file.accused}. ${file.charge?.law || ""}. ${b.text}`);
    } else if (b.kind === "call") {
      caption(byId.get("court:people")?.name, "Prosecution", b.text);
      if (c) { const st = seatsOf().witness[0]; walk(c, [...galleryOut(c), ...WAYS.toStand, [st.x, st.z]], () => { c.yaw = st.yaw; }, true); }
    } else if (b.kind === "step_down") {
      if (c) walk(c, [[c.at.x, c.at.z], ...WAYS.fromStand, [9.45, c.home.z], [c.home.x, c.home.z]], () => { c.yaw = c.home.yaw; }, true);
      caption(null, null, null);
    } else if (b.kind === "line" || b.kind === "charge" || b.kind === "ask") {
      if (c && c.role !== "witness" && c.role !== "judge") { c.sitting = false; }
      if (c) c.activity = "talking";
      const ex = b.exhibits?.length ? file.exhibits.find((e) => e.id === b.exhibits[0]) : null;
      if (ex) built.showExhibit(ex.title, ex.side);
      caption(b.who === "accused" ? "You" : b.name || c?.name, TAGS[b.who.split(":")[0]] || "", b.text);
    } else if (b.kind === "out") {
      built.showExhibit();
      caption(byId.get("court:bailiff")?.name, "Bailiff", "All rise for the jury.");
      const seats = seatsOf().deliberation;
      cast.filter((x) => x.role === "juror").forEach((x, k) => { const st = seats[k]; walk(x, [[x.at.x, 18.95], ...WAYS.juryOut, [st.x, st.z]], () => { x.yaw = st.yaw; }, true); });
    } else if (b.kind === "deliberate") {
      caption(null, null, "The jury is out, deliberating in the jury room. (Go and look: the door is beside the jury box.)", false);
    } else if (b.kind === "back") {
      caption(byId.get("court:bailiff")?.name, "Bailiff", "All rise for the jury.");
      cast.filter((x) => x.role === "juror").forEach((x) => walk(x, [[x.at.x, x.at.z], [18.2, 12.4], [19.15, 13.2], [19.15, 15.4], [18.9, 18.95], [x.home.x, 18.95], [x.home.x, x.home.z]], () => { x.yaw = x.home.yaw; }, true));
    } else if (b.kind === "verdict") {
      if (c) { c.sitting = false; c.activity = "talking"; }
      caption(c?.name, "Foreperson", "Your Honor, we have.", false);
      send("court_conclude", { case: caseId }).then((r) => { result = r.ok ? r : { verdict: "not_guilty", name: "the case could not be decided", error: r.error }; });
    } else if (b.kind === "sentence") {
      gavelT = 0;
      const v = result || {};
      const said = v.verdict === "not_guilty" ? "not guilty" : v.verdict === "lesser" ? `guilty of the lesser offence, ${file.charge?.lesser || ""}` : "guilty";
      caption(byId.get("court:judge")?.name, "Judge", `The jury having found the defendant ${said}${v.by === "bench" ? " (the court ruling on the evidence)" : ""}, the sentence of the court is: ${v.name || "as the law provides"}.${v.owed ? ` ${R.fmt ? R.fmt(v.owed) : v.owed} is owed to the court.` : ""}`);
    } else if (b.kind === "adjourn") {
      gavelT = 0; caption(byId.get("court:bailiff")?.name, "Bailiff", b.text);
    }
  }
  //: A frame of the hearing: the beat's time, the people on their ways, the gavel.
  function frame(dt) {
    if (!S.active) return;
    const here = local(me().x, me().z), inCourt = roomAt(here.x, here.z)?.id === "court";
    if (beat < 0) {
      if (inCourt || performance.now() - startT > 30_000) { beat = 0; S.phase = "hearing"; caption(byId.get("court:clerk")?.name, "Clerk", `Calling the case of the People of the State of California versus ${file.accused}.`); startBeat(beats[0]); }
    } else {
      const b = beats[beat];
      beatT += dt;
      const waitVerdict = b.kind === "verdict" && !result;
      if (!waitVerdict && beatT >= b.s) {
        beat += 1;
        if (beat >= beats.length) { finish(); return; }
        startBeat(beats[beat]);
        // The verdict's own words, once the jury is back and the world has ruled.
        if (beats[beat].kind === "sentence" && result) {
          const fore = byId.get("court:juror:0");
          caption(fore?.name, "Foreperson", `We, the jury in the above-entitled cause, find the defendant, ${file.accused}, ${result.verdict === "not_guilty" ? "not guilty" : result.verdict === "lesser" ? "guilty of the lesser offence" : "guilty"} of ${file.charge?.law || "the charge"}.`);
          beatT = -4;   // (four seconds for it before the judge speaks)
          setTimeout(() => startBeat(beats[beat]), 4000);
        }
      }
    }
    for (const c of cast) {
      if (!c.path) continue;
      const p = c.path[c.pathK], dx = p.x - c.at.x, dz = p.z - c.at.z, d = Math.hypot(dx, dz), st = Math.min(d, 1.25 * dt);
      if (d > 1e-3) { c.at.x += (dx / d) * st; c.at.z += (dz / d) * st; c.yaw = Math.atan2(-dx, -dz); }
      if (d - st < 0.02) { c.pathK += 1; if (c.pathK >= c.path.length) { c.path = null; c.sitting = c.sitAfter; c.then?.(); } }
    }
    // The gavel: up, and down on the block twice.
    if (gavelT >= 0 && built) { gavelT += dt; const k = gavelT < 0.9 ? Math.abs(Math.sin(gavelT * Math.PI * 2.2)) : 0; built.gavel.rotation.x = -0.9 * k; if (gavelT >= 0.9) { gavelT = -1; built.gavel.rotation.x = 0; knock(); } }
  }
  let ac = null;
  function knock() { try { ac ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)(); for (const t of [0, 0.28]) { const o = ac.createOscillator(), g = ac.createGain(); o.type = "triangle"; o.frequency.value = 180; g.gain.setValueAtTime(0.35, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.12); o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.14); } } catch { /* no sound */ } }
  //: Raised floors: the bench's dais, the witness stand, the jury box's tiers.
  function floorAt(x, z) {
    if (x > 18.3 && x < 20.2 && z > 21.5 && z < 28.5) return 0.9;
    if (x > 16.6 && x < 18.2 && z > 19.9 && z < 21.5) return 0.3;
    if (x > 12.5 && x < 18.2 && z > 14.6 && z < 16.4) return 0.55;
    if (x > 12.5 && x < 18.2 && z > 16.8 && z < 18.4) return 0.18;
    return 0;
  }
  //: Those in court, for the crowd's figures: in their places, sitting or standing, the speaker
  //: talking.
  function people() {
    if (!S.active) return [];
    const out = [];
    for (const c of cast) {
      const w = L(c.at.x, c.at.z), moving = Boolean(c.path);
      const seated = c.sitting && !moving;
      out.push({ id: c.id, x: w.x, z: w.z, yaw: c.yaw, moving, speed: 1.25, activity: moving ? "walking" : c.activity === "talking" ? "talking" : seated ? "sitting" : "standing",
        gesture: seated ? { kind: "sit", f: 1 } : null, person: c.person, at_y: O.y + floorAt(c.at.x, c.at.z), indoors: "court" });
    }
    return out;
  }
  //: Walking inside: the arrows as in a shop, kept to the floor's plan; not out of the street doors.
  function walkIn(dt, held) {
    if (!S.active) return false;
    if (!held.size) { ctx.animateWalk?.(0); return true; }
    const yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    let mx = 0, mz = 0;
    if (held.has("ArrowUp") || held.has("KeyW")) { mx += fx; mz += fz; }
    if (held.has("ArrowDown") || held.has("KeyS")) { mx -= fx; mz -= fz; }
    if (held.has("ArrowRight") || held.has("KeyD")) { mx += rx; mz += rz; }
    if (held.has("ArrowLeft") || held.has("KeyA")) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (!len) { ctx.animateWalk?.(0); return true; }
    const p = me(), was = local(p.x, p.z), sp = 1.5 * (api.walkFactor?.() ?? 1);
    let x = was.x + (mx / len) * sp * dt, z = was.z + (mz / len) * sp * dt;
    if (atExit(x, z)) { if (performance.now() - exitNoted > 5000) { exitNoted = performance.now(); notify("A deputy at the doors: \"You can't leave while your case is in session. Have a seat.\""); } ctx.animateWalk?.(0); return true; }
    if (!canWalk(x, was.z)) x = was.x;
    if (!canWalk(x, z)) z = was.z;
    const w = L(x, z);
    ctx.placeAvatar(w.x, O.y + floorAt(x, z), w.z);
    const stepped = Math.hypot(x - was.x, z - was.z);
    ctx.animateWalk?.(stepped, (x - was.x) / (stepped || 1), (z - was.z) / (stepped || 1));
    return true;
  }
  //: The chairs to sit in, in the world's frame (for click-to-sit).
  function seats() {
    if (!S.active) return [];
    return built.group.userData.courtSeats.map((s) => { const w = L(s.x, s.z); return { x: w.x, y: O.y + s.y, z: w.z, yaw: s.yaw, floor: O.y + (s.y - 0.45) }; });
  }
  //: Adjourned: back where you were, the sentence carried out.
  function finish() {
    const r = result || {};
    caption(null, null, null);
    leave();
    const said = r.verdict === "not_guilty" ? "Not guilty" : r.verdict === "lesser" ? "Guilty of the lesser offence" : "Guilty";
    const jail = r.released ? ` ${r.released.days} days in county jail, served (your record says how it went).` : "";
    notify(`Court adjourned. ${said}: ${r.name || "decided"}.${r.owed ? ` Owed to the court: ${R.fmt ? R.fmt(r.owed) : r.owed}.` : ""}${jail} You're back where you were.`);
    onEnd?.(r);
  }
  function leave() {
    if (!S.active) return;
    S.active = false; S.phase = null;
    doc?.removeEventListener("keydown", onKey, true);
    for (const o of hidden) o.visible = true;
    hidden = [];
    if (built) { built.group.removeFromParent(); built.group.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) { m.map?.dispose?.(); if (m !== glass) m.dispose?.(); } }); built = null; }
    ctx.setFloor?.(null);
    if (back) { ctx.placeAvatar(back.x, back.y, back.z, back.yaw); if (!back.fp) ctx.firstPerson?.(false); }
    cast = []; byId = new Map();
  }
  return {
    enter, frame, people, walkIn, seats, leave,
    get active() { return S.active; },
    get floorY() { return O?.y ?? null; },
    state: () => ({ active: S.active, phase: S.phase, beat, kind: beats[beat]?.kind || null, beats: beats.length, cast: cast.length, public: cast.filter((c) => c.role === "public").length, result }),
    skip: () => { beatT = 1e9; },
  };
}
