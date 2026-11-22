import { CHECKS, CIRCUITS, MOUNTS, REPAIRS, SHOP_LIMIT, SITES, canWorkBay, totalBill } from "./workshop.mjs";
import { workshopScene } from "./workshop-3d.mjs";
import { paintOf } from "./vehicles.mjs";

const STYLE = `
#city-bay{position:fixed;inset:0;z-index:31;background:#16272e;color:#f2efe5;font:14px/1.4 system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr}
#city-bay header{display:flex;align-items:center;gap:14px;padding:12px 18px;background:#233a41;border-bottom:2px solid #c7a764}
#city-bay header strong{flex:1}#city-bay h2{font-size:23px;margin:0 0 5px}#city-bay h3{font-size:15px;margin:16px 0 6px}
#city-bay button,#city-bay select{font:inherit;color:inherit;background:#304a50;border:1px solid #628085;padding:7px 10px;border-radius:5px;cursor:pointer}
#city-bay button:hover,#city-bay button:focus-visible{border-color:#ffe09b}#city-bay button:disabled{opacity:.55}
#city-bay .primary{background:#efcc83;color:#182a31;border-color:#efcc83;font-weight:650}
#city-bay .desk{overflow:auto;padding:22px max(16px,calc((100vw - 820px)/2))}
#city-bay .row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #476067;padding:10px 0}
#city-bay .work{display:grid;grid-template-columns:minmax(0,1fr) minmax(290px,350px);min-height:0}
#city-bay .scene{position:relative;min-height:0;overflow:hidden}#city-bay .view-controls{position:absolute;left:12px;bottom:12px;background:#172930dd;border-radius:6px;padding:5px}
#city-bay .bay-context{position:absolute;left:12px;top:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:7px;background:#172930eb}#city-bay .point-label{position:absolute;pointer-events:none;transform:translate(10px,8px);background:#132629;color:white;padding:4px 8px;border-radius:3px}#city-bay aside{overflow:auto;padding:15px;background:#1d3138}#city-bay .controls{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:7px 0}#city-bay select{max-width:100%}
#city-bay p{margin:6px 0}#city-bay small{color:#c3d1d0}#city-bay output{display:block;color:#ffe09b;min-height:1.4em}
@media(max-width:700px){#city-bay .work{grid-template-columns:1fr;grid-template-rows:minmax(160px,42%) 1fr}#city-bay header{padding:7px}}
`;
export function workshopPanel({ R, h, doc, THREE, send, notify, self, getView, makeCar, visitors, placeArg }) {
  let root,
    place,
    scene,
    timer,
    sidebar,
    order,
    currentSite,
    message = "",
    busy = false,
    generation = 0;
  const staff = () => canWorkBay(self(), place, getView().bizAt(place.id));
  const btn = (label, fn, primary = false) =>
    h("button", { textContent: label, onclick: fn, className: primary ? "primary" : "" });
  const group = (...kids) => h("div", { className: "controls" }, ...kids);
  const note = (text) => h("p", {}, h("small", { textContent: text }));
  const select = (label, options) =>
    h(
      "select",
      { "aria-label": label },
      ...options.map(([value, name]) => h("option", { value, textContent: name })),
    );
  const name = (o) => R.vehicles.models[o.model]?.name || o.model;
  function close() {
    generation++;
    clearInterval(timer);
    scene?.dispose();
    scene = null;
    root?.remove();
    root = null;
    order = null;
    busy = false;
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("keyup", key, true);
  }
  function key(e) {
    e.stopImmediatePropagation();
    if (e.type === "keydown" && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
  function header() {
    return h(
      "header",
      {},
      h("strong", { textContent: place.name || "Auto service" }),
      order ? btn("Service desk", desk) : null,
      btn("Close", close),
    );
  }
  function open(pl) {
    if (root) close();
    place = placeArg(pl);
    message = "";
    if (!doc.getElementById("city-bay-style"))
      doc.head.append(h("style", { id: "city-bay-style", textContent: STYLE }));
    root = h("section", { id: "city-bay", "aria-label": "Mechanic workshop" });
    doc.body.append(root);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    desk();
    timer = setInterval(() => {
      if (!root || busy) return;
      if (!self() || Math.hypot(self().x - place.x, self().z - place.z) > R.jobs.workplace_reach_m) {
        close();
        return;
      }
      if (order) {
        const latest = getView().workOrders.get(order.vehicle);
        if (latest && latest.id === order.id && latest.revision > order.revision) {
          order = latest;
          scene.update(order);
          controls();
        } else if (!latest && !staff() && order.payer !== self().account) desk();
      }
    }, 2000);
  }
  async function command(cmd, args) {
    if (busy) return;
    busy = true;
    const gen = generation;
    try {
      const delay = (order?.readyAt || 0) - Date.now();
      if (cmd === "workshop_action" && args.action !== "withdraw" && delay > 0) {
        const feedback = sidebar?.querySelector("output");
        if (feedback) feedback.textContent = "Finishing the current operation…";
        await new Promise(resolve => setTimeout(resolve, Math.min(delay + 40, 2500)));
        if (gen !== generation || !root) return;
      }
      const r = await send(cmd, { place, ...args });
      if (gen !== generation || !root) return;
      if (!r.ok) {
        message = r.error;
        notify(message);
        if (order) {
          order = getView().workOrders.get(order.vehicle) || order;
          scene.update(order);
          controls();
        } else desk();
        return;
      }
      message = r.message || "";
      if (r.order) {
        if (!order || order.id !== r.order.id) show(r.order);
        else {
          order = r.order;
          scene.update(order);
          controls();
        }
      }
    } finally {
      if (gen === generation) busy = false;
    }
  }
  function desk() {
    order = null;
    scene?.dispose();
    scene = null;
    const p = self(),
      view = getView();
    const rows = [...view.workOrders.values()]
      .filter((o) => o.shop === String(place.id) && (staff() || o.payer === p.account))
      .sort((a, b) => Number(b.active) - Number(a.active));
    const list = h(
      "div",
      { className: "desk" },
      h("h2", { textContent: "Service desk" }),
      h("h3", { textContent: "Work orders" }),
    );
    for (const o of rows)
      list.append(
        h(
          "div",
          { className: "row" },
          h("span", { textContent: `${o.customer} · ${name(o)} · ${o.plate}` }),
          btn(o.active ? "Open bay" : "Invoice", () => {
            message = "";
            show(o);
          }),
        ),
      );
    if (!rows.length) list.append(note("No cars checked in here."));
    const owned = view.registry
      .held(p.account)
      .filter(
        (a) =>
          a.kind === "vehicle" &&
          a.owner === p.account &&
          (a.attrs.serviceFault || (a.attrs.condition ?? 100) < 100) &&
          p.driving?.vehicle !== a.id &&
          !view.workOrders.get(a.id)?.active &&
          Math.hypot((p.parked[a.id] || a.attrs).x - place.x, (p.parked[a.id] || a.attrs).z - place.z) <=
            R.jobs.workplace_reach_m,
      );
    list.append(h("h3", { textContent: "Your parked vehicles" }));
    const concern = h("input", {
      placeholder: "What did you notice?",
      maxLength: 180,
      "aria-label": "Symptoms for the mechanic",
    });
    if (owned.length) list.append(concern);
    for (const a of owned)
      list.append(
        h(
          "div",
          { className: "row" },
          h("span", { textContent: `${name(a.attrs)} · ${a.attrs.plate}` }),
          btn("Authorize up to " + R.fmt(R.money(SHOP_LIMIT)), () =>
            command("workshop_intake", { vehicle: a.id, concern: concern.value }),
          ),
        ),
      );
    if (!owned.length) list.append(note("Park your damaged vehicle at this shop to request service."));
    if (staff()) {
      list.append(h("h3", { textContent: "Customers at the counter" }));
      const here = visitors(place).filter(
        (v) =>
          !view.workOrders.get(v.vehicle)?.active &&
          !(view.harm.get(v.vehicle)?.servicedAt > view.now - 7 * 86400000),
      );
      for (const v of here)
        list.append(
          h(
            "div",
            { className: "row" },
            h("span", { textContent: `${v.name} · ${name(v)} · ${v.plate}` }),
            btn("Write work order", () => command("workshop_intake", { vehicle: v.vehicle, visitor: v })),
          ),
        );
      if (!here.length) list.append(note("No visiting drivers have a car parked here right now."));
    } else list.append(note("Clock in as a mechanic to work on a customer's car."));
    if (message) list.append(h("output", { "aria-live": "polite", textContent: message }));
    list.append(btn("Refresh service desk", desk));
    root.replaceChildren(header(), list);
  }
  function show(o) {
    scene?.dispose();
    order = o;
    currentSite = null;
    const host = h("div", { className: "scene" });
    const context = h("div", { className: "bay-context" });
    const hover = h("span", { className: "point-label" });
    sidebar = h("aside", {});
    root.replaceChildren(header(), h("div", { className: "work" }, host, sidebar));
    const colour = o.npc ? paintOf(o.model, o.shade ?? 0.5) : R.vehicles.models[o.model]?.colour || "#8d9ca1";
    scene = workshopScene(
      THREE,
      host,
      o,
      colour,
      makeCar,
      (id) => {
        currentSite = id;
        controls();
      },
      (id, x, y) => {
        hover.hidden = !id;
        if (id) {
          hover.textContent = SITES[id];
          hover.style.left = x + "px";
          hover.style.top = y + "px";
        }
      },
    );
    host.append(context, hover);
    hover.hidden = true;
    host.append(
      h(
        "div",
        { className: "view-controls" },
        btn("Walk around", () => scene.overview()),
        btn("Engine bay", () => scene.select("socket", true)),
        btn("Left wheel arch", () => scene.select("arch", true)),
        btn("Look underneath", () => scene.underbody()),
        h("small", { textContent: "  Drag to orbit · scroll to zoom" }),
      ),
    );
    controls();
  }
  function act(action, extra = {}) {
    return command("workshop_action", {
      vehicle: order.vehicle,
      orderId: order.id,
      revision: order.revision,
      site: currentSite,
      action,
      ...extra,
    });
  }
  function controls() {
    const o = order,
      spec = REPAIRS[o.fault];
    sidebar.replaceChildren(
      h("h2", { textContent: name(o) }),
      note(o.plate + " · " + o.customer),
      h("p", {
        textContent: o.active
          ? o.interview || !o.partsRequired
            ? "“" + (o.concern || spec.complaint) + "”"
            : "Customer waiting for intake."
          : o.verified
            ? "Functional check passed · vehicle released"
            : "Customer collected vehicle before completion",
      }),
    );
    const actions = root.querySelector(".bay-context");
    actions.replaceChildren();
    if (o.active && staff()) {
      const points = select("Inspection point", [["", "Choose a point"], ...Object.entries(SITES)]);
      points.value = currentSite || "";
      points.onchange = () => {
        if (points.value) scene.select(points.value, true);
      };
      sidebar.append(
        h("h3", { textContent: o.diagnosed ? "Attachment point" : "1 · Inspect and diagnose" }),
        points,
      );
      const bins = getView().workshopStock.get(o.shop) || {};
      for (const [id, n] of Object.entries(bins))
        if (!n)
          sidebar.append(
            btn("Order empty bin · " + (REPAIRS[id]?.part || SITES[id.slice(6)] + " hardware"), () =>
              act("restock", { part: id }),
            ),
          );
      if (!o.interview) actions.append(btn("Ask what happened", () => act("ask")));
      if (!o.seated) {
        const found = Object.entries(CHECKS).find(([, v]) => v.site === currentSite);
        const [check, test] = found || ["inspect", CHECKS.inspect];
        actions.append(
          h("b", { textContent: currentSite ? SITES[currentSite] : "Choose a marker on the vehicle" }),
          btn(found ? test.label : "Inspect this area", () =>
            act("check", { site: currentSite || test.site, check }),
          ),
        );
      }
      if (!o.diagnosed) {
        const tools = select(
          "Diagnostic tool",
          Object.entries(CHECKS).map(([id, t]) => [id, t.label + " · " + R.fmt(R.money(t.cost))]),
        );
        const parts = select(
          "Suspected fault",
          Object.entries(REPAIRS).map(([id, t]) => [id, t.part]),
        );
        const likelihood = note("");
        const advise = () => {
          likelihood.textContent =
            currentSite && currentSite !== CHECKS[tools.value].site
              ? "Low likelihood of a useful reading at this point. You can still run the test."
              : "Take a reading or continue with a provisional diagnosis.";
        };
        tools.onchange = advise;
        advise();
        sidebar.append(
          likelihood,
          group(
            tools,
            btn("Take reading", () =>
              act("check", { site: currentSite || CHECKS[tools.value].site, check: tools.value }),
            ),
          ),
          group(
            parts,
            btn("Continue to parts", () => act("diagnose", { part: parts.value })),
          ),
        );
      } else if (!o.seated) {
        const parts = select(
          "Replacement part",
          Object.entries(REPAIRS).map(([id, t]) => [id, t.part + " · " + R.fmt(R.money(t.price))]),
        );
        parts.value = o.issued || o.suspected || o.fault;
        if (o.partsRequired && !o.issued) {
          const evidence = note("");
          const describePart = () => {
            const test = REPAIRS[parts.value].test, reading = o.checks[test];
            evidence.textContent = reading === CHECKS[test].failed ? "The recorded reading supports this part."
              : reading ? "This area tested normal. Drawing this part may waste stock."
              : "No confirming reading yet. You can still draw this part.";
          };
          parts.onchange = describePart; describePart();
          sidebar.append(evidence,
            h("h3", { textContent: "2 · Get parts" }),
            parts,
            note(
              Object.keys(REPAIRS)
                .map((id) => REPAIRS[id].part + ": " + (bins[id] ?? 0))
                .join(" · "),
            ),
            btn("Draw selected part", () => act("issue", { part: parts.value })),
          );
        } else {
          const facing = select(
            "Part orientation",
            ["Select orientation", "wheel opening down", "bare contact inward", "keyway forward", "reversed"].map(
              (x) => [x, x],
            ),
          );
          parts.value = o.issued || parts.value;
          facing.value = REPAIRS[parts.value].orientation;
          if (!currentSite) {
            currentSite = spec.seat;
            points.value = currentSite;
          }
          actions.append(
            btn("Focus part seat", () => scene.select(spec.seat, true)),
            btn("Fit " + spec.part, () =>
              act("fit", { site: spec.seat, part: parts.value, orientation: facing.value }),
            ),
          );
          sidebar.append(
            h("h3", { textContent: "3 · Fit and verify" }),
            group(
              parts,
              facing,
              btn(
                "Seat at selected point",
                () => act("fit", { part: parts.value, orientation: facing.value }),
                true,
              ),
            ),
          );
        }
      } else if (!o.verified) {
        const tool = select("Fitting tool", [
          ["", "Select a fitting tool"],
          ...[...new Set(Object.values(MOUNTS))].map((name) => [name, name]),
        ]);
        const lead = select("Circuit lead", [
          ["", "Choose a lead"],
          ...Object.values(CIRCUITS).map((name) => [name, name]),
        ]);
        const next = spec.mounts.find((id) => !o.mounts.includes(id));
        if (next) actions.append(btn("Locate " + SITES[next], () => scene.select(next, true)));
        if (spec.mounts.includes(currentSite) && !o.mounts.includes(currentSite)) {
          tool.value = MOUNTS[currentSite];
          lead.value = CIRCUITS[currentSite] || "";
          actions.append(
            btn("Secure " + SITES[currentSite], () => act("attach", { tool: tool.value, circuit: lead.value })),
          );
        }
        if (!next) actions.append(btn("Test repair", () => act("verify")));
        sidebar.append(
          note(
            spec.mounts
              .map((site) => SITES[site] + " · " + (CIRCUITS[site] ? CIRCUITS[site] + " · " : "") + MOUNTS[site])
              .join(" / "),
          ),
          note("Attachments " + o.mounts.length + " / " + spec.mounts.length),
          group(
            tool,
            CIRCUITS[currentSite] ? lead : null,
            btn("Secure selected attachment", () => act("attach", { tool: tool.value, circuit: lead.value })),
            btn("Run functional check", () => act("verify"), true),
          ),
        );
      } else sidebar.append(btn("Release vehicle and issue invoice", () => act("release"), true));
    }
    if (o.bonus) sidebar.append(note("Employee bonus · " + R.fmt(o.bonus)));
    for (const entry of (o.reports || []).slice(-3)) sidebar.append(note(entry));
    for (const reading of Object.values(o.checks)) sidebar.append(note(reading));
    sidebar.append(
      h("output", { "aria-live": "polite", textContent: message }),
      h("h3", { textContent: o.active ? "Running bill" : "Invoice " + (o.bill || "") }),
    );
    for (const line of o.lines)
      sidebar.append(
        h(
          "div",
          { className: "row" },
          h("span", { textContent: line.label }),
          h("span", { textContent: R.fmt(line.amount) }),
        ),
      );
    sidebar.append(h("b", { textContent: "Total " + R.fmt(totalBill(o)) }));
    if (o.active && (o.payer === self().account || (o.npc && staff())))
      sidebar.append(group(btn("Withdraw car and bill work to date", () => act("withdraw"))));
  }
  return { open, close };
}
