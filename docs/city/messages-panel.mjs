// The messages strip: a tab at the side of the screen with the unread count, which opens into a
// panel on top of everything (closed again with × or Esc). Three tabs read the world's threads
// (messages.mjs): Players, NPC and System. Nothing in the city's bars moves for it: closed it is
// a narrow tab in the empty middle of the screen's edge; open it lies over the side, and goes.
//
// The view gives it the world (getView), how to send a command, who you are, and the people in
// your party; it keeps nothing of its own but what is open.

const CSS = `
#city-msg[hidden],#city-msg-tab[hidden]{display:none!important}
#city-msg-tab{position:fixed;left:var(--city-msg-x,0px);top:50%;transform:translateY(-50%);z-index:38;display:flex;flex-direction:column;align-items:center;gap:6px;
  border:0;border-radius:0 10px 10px 0;background:rgba(17,24,39,.86);color:#fff;padding:12px 6px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.25);font:600 12px/1 system-ui,sans-serif;touch-action:manipulation}
#city-msg-tab:hover{background:rgba(31,41,55,.95)}
#city-msg-tab .v{writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.04em}
#city-msg-tab b,#city-msg .count{min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;padding:0 4px;box-sizing:border-box}
#city-msg-tab b:empty,#city-msg .count:empty{display:none}
#city-msg{position:fixed;left:var(--city-msg-x,0px);top:12px;bottom:12px;z-index:39;width:min(370px,calc(100vw - 16px));display:flex;flex-direction:column;box-sizing:border-box;
  background:rgba(17,24,39,.96);color:#f3f4f6;border-radius:0 14px 14px 0;box-shadow:0 8px 30px rgba(0,0,0,.4);font:13px/1.4 system-ui,sans-serif;overflow:hidden}
#city-msg header{display:flex;align-items:center;gap:8px;padding:10px 10px 6px 14px}
#city-msg header h3{flex:1;margin:0;font:700 15px/1.2 system-ui,sans-serif}
#city-msg button{border:0;border-radius:8px;background:rgba(255,255,255,.12);color:inherit;font:inherit;padding:5px 10px;cursor:pointer;touch-action:manipulation}
#city-msg button:hover{background:rgba(255,255,255,.22)}
#city-msg button.primary{background:#1f6feb}#city-msg button.primary:hover{background:#3b82f6}
#city-msg button.x{width:30px;height:30px;padding:0;font-size:18px;line-height:30px}
#city-msg nav{display:flex;gap:4px;padding:0 10px 8px}
#city-msg nav button{flex:1;display:flex;justify-content:center;align-items:center;gap:6px}
#city-msg nav button[aria-pressed=true]{background:#1f6feb}
#city-msg .body{flex:1;overflow:auto;padding:0 10px 10px;overscroll-behavior:contain}
#city-msg .row{display:flex;gap:8px;align-items:flex-start;padding:8px 6px;border-radius:10px;cursor:pointer}
#city-msg .row:hover{background:rgba(255,255,255,.07)}
#city-msg .row .who{flex:1;min-width:0}
#city-msg .row .name{font-weight:700;display:flex;gap:6px;align-items:center}
#city-msg .row .pre{opacity:.7;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#city-msg .row time,#city-msg .msg time{opacity:.55;font-size:11px;white-space:nowrap}
#city-msg .tag{font:600 10px/1 system-ui,sans-serif;padding:3px 6px;border-radius:6px;background:rgba(255,255,255,.14);text-transform:uppercase;letter-spacing:.04em}
#city-msg .tag.Boss,#city-msg .tag.Lawyer{background:#7c3aed}#city-msg .tag.Interviewer{background:#0e7490}#city-msg .tag[class*=Cab]{background:#ca8a04}
#city-msg .tag.Official,#city-msg .tag.Daily{background:#334155}#city-msg .tag.Neighbours{background:#15803d}#city-msg .tag.Everyone{background:#9a3412}
#city-msg .dot{width:8px;height:8px;border-radius:4px;background:#f59e0b;flex:none;margin-top:6px}
#city-msg h4{margin:10px 6px 4px;font:700 11px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;opacity:.65}
#city-msg .note{opacity:.7;font-size:12px;margin:4px 6px}
#city-msg .line{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 6px}
#city-msg .line span{flex:1}
#city-msg .msgs{display:flex;flex-direction:column;gap:8px;padding:4px 2px}
#city-msg .msg{max-width:86%;align-self:flex-start;background:rgba(255,255,255,.09);border-radius:12px 12px 12px 4px;padding:7px 10px;white-space:pre-wrap;overflow-wrap:anywhere}
#city-msg .msg.mine{align-self:flex-end;background:#1f6feb;border-radius:12px 12px 4px 12px}
#city-msg .msg.sys{align-self:center;background:none;opacity:.7;font-size:12px;text-align:center;max-width:95%}
#city-msg .msg.official{max-width:100%;align-self:stretch;background:rgba(51,65,85,.6);border-radius:10px}
#city-msg .msg .from{font-weight:700;font-size:12px;display:flex;gap:6px;align-items:center;margin-bottom:2px}
#city-msg .msg .choices{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
#city-msg .msg .choices button{background:rgba(255,255,255,.18)}
#city-msg .msg .answered{opacity:.65;font-size:12px;margin-top:4px}
#city-msg form{display:flex;gap:6px;padding:8px 10px 10px;border-top:1px solid rgba(255,255,255,.1)}
#city-msg input[type=text]{flex:1;min-width:0;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(0,0,0,.25);color:inherit;font:inherit;padding:7px 9px}
#city-msg label{display:flex;gap:6px;align-items:center;padding:3px 6px}
#city-msg select{font:inherit;border-radius:8px;background:rgba(0,0,0,.25);color:inherit;border:1px solid rgba(255,255,255,.2);padding:4px}
@media (max-width:560px){#city-msg{top:8px;bottom:8px}}
`;

const TAB_LABEL = { players: "Players", npc: "NPC", system: "System" };

export function messagesPanel(api) {
  const { h, send, notify, me, getView, peers, courtPlace, placeArg, R } = api;
  const doc = globalThis.document;
  if (!doc.getElementById("city-msg-css")) doc.head.append(Object.assign(doc.createElement("style"), { id: "city-msg-css", textContent: CSS }));
  const tabBtn = h("button", { id: "city-msg-tab", title: "Messages", "aria-label": "Open messages" }, h("span", { textContent: "✉" }), h("span", { className: "v", textContent: "Messages" }), h("b"));
  tabBtn.hidden = true;
  tabBtn.onclick = () => open();
  const panel = h("section", { id: "city-msg", "aria-label": "Messages" });
  panel.hidden = true;
  doc.body.append(tabBtn, panel);
  const ui = { open: false, on: false, tab: "players", thread: null, person: null, group: false, draft: "", sig: "", lastId: null };

  const box = () => { const w = getView(); return w?.inbox && w.players?.has(me()) ? w.inbox(me()) : null; };
  const nameOf = (pid) => getView()?.players.get(pid)?.name || "Someone";
  const ago = (t) => {
    const w = getView(), s = Math.max(0, ((w?.now ?? Date.now()) - t) / 1000);
    return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`;
  };
  const run = async (cmd, args, ok = null) => {
    const r = await send(cmd, args);
    if (!r.ok) notify(r.error); else if (ok) notify(typeof ok === "function" ? ok(r) : ok);
    draw(true);
    return r;
  };
  //: Keys typed here are the message's, not the game's.
  const keep = (el) => { for (const k of ["keydown", "keyup", "keypress"]) el.addEventListener(k, (e) => { if (e.key === "Escape") { el.blur(); return; } e.stopPropagation(); }); return el; };

  function open(tab = null, thread = null) {
    ui.open = true; if (tab) ui.tab = tab; ui.thread = thread; ui.person = null; ui.group = false;
    panel.hidden = false; tabBtn.hidden = true;
    draw(true);
  }
  function close() { ui.open = false; panel.hidden = true; tabBtn.hidden = !ui.on; }
  //: Clicking another player: who they are, and what you can do with them.
  function person(pid, name = null) { open("players"); ui.person = { pid, name: name || nameOf(pid) }; draw(true); }

  function draw(force = false) {
    const ib = box();
    const unread = ib ? ib.unread.players + ib.unread.npc + ib.unread.system : 0;
    tabBtn.querySelector("b").textContent = unread ? String(Math.min(99, unread)) : "";
    tabBtn.setAttribute("aria-label", unread ? `Open messages: ${unread} unread` : "Open messages");
    toastNew(ib);
    if (!ui.open) return;
    const t = ui.thread && ib ? Object.values(ib.tabs).flat().find((x) => x.id === ui.thread) : null;
    const sig = JSON.stringify([ui.tab, ui.thread, ui.person, ui.group, ib && Object.values(ib.tabs).flat().map((x) => [x.id, x.msgs.at(-1)?.id, x.unread, x.msgs.map((m) => m.answered && Object.keys(m.answered).length).join()]), ib?.friends.length, ib?.asked.length, ib?.sent.length, (peers() || []).length]);
    if (!force && sig === ui.sig) return;
    ui.sig = sig;
    const body = panel.querySelector(".body");
    const keepBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < 40 : true;
    const focus = doc.activeElement?.closest?.("#city-msg") ? doc.activeElement.name : null;
    const head = h("header", {}, ui.thread || ui.person || ui.group ? h("button", { textContent: "←", title: "Back", onclick: () => { ui.thread = null; ui.person = null; ui.group = false; draw(true); } }) : null,
      h("h3", { textContent: t ? t.name : ui.person ? ui.person.name : ui.group ? "New group" : "Messages" }),
      h("button", { className: "x", textContent: "×", title: "Close (Esc)", "aria-label": "Close messages", onclick: close }));
    const nav = h("nav", {}, ...Object.entries(TAB_LABEL).map(([k, label]) => h("button", { "aria-pressed": String(ui.tab === k && !ui.thread && !ui.person), onclick: () => { ui.tab = k; ui.thread = null; ui.person = null; ui.group = false; draw(true); } },
      label, h("span", { className: "count", textContent: ib && ib.unread[k] ? String(ib.unread[k]) : "" }))));
    const content = h("div", { className: "body" });
    let form = null;
    if (!ib) content.append(h("p", { className: "note", textContent: "Setting up your place in the city…" }));
    else if (ui.person) content.append(...personView(ib, ui.person));
    else if (ui.group) content.append(...groupForm(ib));
    else if (t) { content.append(...threadView(t)); form = composer(t); }
    else if (ui.thread) { ui.thread = null; content.append(...listView(ib)); }
    else content.append(...listView(ib));
    panel.replaceChildren(head, nav, content, ...(form ? [form] : []));
    if (t) { if (keepBottom) content.scrollTop = content.scrollHeight; if (t.unread) send("read_thread", { thread: t.id }).then(() => draw(true)); }
    if (focus) panel.querySelector(`[name="${focus}"]`)?.focus();
  }

  function listView(ib) {
    const out = [];
    if (ui.tab === "players") {
      if (ib.asked.length) {
        out.push(h("h4", { textContent: "Friend requests" }));
        for (const a of ib.asked) out.push(h("div", { className: "line" }, h("span", { textContent: a.name }), h("button", { className: "primary", textContent: "Accept", onclick: () => run("add_friend", { player: a.id }, `You and ${a.name} are friends.`) })));
      }
      const friends = new Set(ib.friends.map((f) => f.id));
      const near = (peers() || []).filter((x) => x.pid && x.pid !== me());
      if (near.length) {
        out.push(h("h4", { textContent: "People in your party" }));
        for (const x of near) out.push(h("div", { className: "line" }, h("span", { textContent: x.name }),
          friends.has(x.pid) ? h("em", { className: "note", textContent: "Friend" }) : ib.asked.some((a) => a.id === x.pid) ? null : ib.sent.includes(x.pid) ? h("em", { className: "note", textContent: "Asked" }) : h("button", { textContent: "Add friend", onclick: () => run("add_friend", { player: x.pid }, `Asked ${x.name} to be friends.`) }),
          h("button", { textContent: "Message", onclick: () => person(x.pid, x.name) })));
      }
      out.push(h("div", { className: "line" }, h("span", { className: "note", textContent: ib.friends.length ? `${ib.friends.length} friend${ib.friends.length === 1 ? "" : "s"}` : "Click another player to add them as a friend." }),
        ib.friends.length ? h("button", { textContent: "New group", onclick: () => { ui.group = true; draw(true); } }) : null));
    }
    const rows = ib.tabs[ui.tab];
    out.push(h("h4", { textContent: ui.tab === "players" ? "Conversations" : ui.tab === "npc" ? "People of the city" : "Official" }));
    if (!rows.length) out.push(h("p", { className: "note", textContent: ui.tab === "npc" ? "Lawyers, interviewers, your boss and cab drivers write to you here." : ui.tab === "system" ? "The day in Kerbside, City Hall's votes, and your notices come here." : "No conversations yet." }));
    for (const r of rows) {
      out.push(h("div", { className: "row", role: "button", tabIndex: 0, onclick: () => { ui.thread = r.id; draw(true); }, onkeydown: (e) => { if (e.key === "Enter") { ui.thread = r.id; draw(true); } } },
        r.waiting ? h("i", { className: "dot", title: "Waiting for your answer" }) : null,
        h("div", { className: "who" }, h("div", { className: "name" }, h("span", { textContent: r.name || "Conversation" }), r.tag ? h("span", { className: `tag ${r.tag}`, textContent: r.tag }) : null),
          h("div", { className: "pre", textContent: r.preview || "" })),
        h("div", {}, h("time", { textContent: ago(r.last) }), h("div", { className: "count", textContent: r.unread ? String(r.unread) : "" }))));
    }
    return out;
  }

  function threadView(t) {
    const out = [], mine = me();
    if (t.kind === "group") {
      const ib = box(), inIt = new Set(t.members.map((x) => x.id));
      const can = ib.friends.filter((f) => !inIt.has(f.id));
      out.push(h("p", { className: "note", textContent: t.members.map((x) => x.name).join(", ") }));
      if (can.length) {
        const pickF = h("select", { name: "addf" }, ...can.map((f) => h("option", { value: f.id, textContent: f.name })));
        out.push(h("div", { className: "line" }, h("span", { className: "note", textContent: "Add a friend:" }), pickF, h("button", { textContent: "Add", onclick: () => run("add_to_group", { thread: t.id, player: pickF.value }) }),
          h("button", { textContent: "Leave", onclick: () => run("leave_group", { thread: t.id }).then((r) => { if (r.ok) { ui.thread = null; draw(true); } }) })));
      } else out.push(h("div", { className: "line" }, h("span"), h("button", { textContent: "Leave group", onclick: () => run("leave_group", { thread: t.id }).then((r) => { if (r.ok) { ui.thread = null; draw(true); } }) })));
    } else if (t.kind === "neighbours" || t.kind === "council") out.push(h("p", { className: "note", textContent: t.kind === "council" ? "Everyone in the city." : `Everyone whose home is in ${t.name}: ${(t.members || []).map((x) => x.name).join(", ")}` }));
    const list = h("div", { className: "msgs" });
    for (const m of t.msgs) {
      const isMine = m.from === mine, sys = m.from === "system" && !m.name, official = t.tab === "system";
      const el = h("div", { className: `msg${isMine ? " mine" : ""}${sys ? " sys" : ""}${official ? " official" : ""}` });
      if (!isMine && !sys && (m.name || t.kind !== "dm")) el.append(h("div", { className: "from" }, h("span", { textContent: m.name || nameOf(m.from) }), m.tag ? h("span", { className: `tag ${m.tag}`, textContent: m.tag }) : null));
      el.append(h("div", { textContent: m.text }), h("time", { textContent: ago(m.t) }));
      if (m.choices) {
        const mineAns = m.answered?.[mine];
        const forMe = m.choices.filter((c) => !c.only || c.only === mine);
        // Your answer shows as your own message, except in official threads (no replies there).
        if (mineAns !== undefined) { if (official || !t.members) el.append(h("div", { className: "answered", textContent: `You chose: ${m.choices.find((c) => c.id === mineAns)?.label || mineAns}` })); }
        else if (m.expired) el.append(h("div", { className: "answered", textContent: "This has passed." }));
        else if (forMe.length) el.append(h("div", { className: "choices" }, ...forMe.map((c) => h("button", { textContent: c.label, onclick: () => run("answer", { thread: t.id, message: m.id, choice: c.id }) }))));
      }
      if (m.ui?.jury) {
        const s = (getView()?.players.get(mine)?.jury || []).find((x) => x.id === m.ui.jury);
        const now = getView()?.now ?? Date.now(), L = R.business.law;
        if (s && s.status !== "served" && s.status !== "missed" && now >= s.at + L.attend_hours[0] * 3_600_000 && now <= s.at + L.attend_hours[1] * 3_600_000) {
          const court = courtPlace?.();
          el.append(h("div", { className: "choices" }, h("button", { className: "primary", textContent: "Check in for jury service", onclick: () => run("serve_jury", { summons: s.id, court: court ? placeArg(court) : null }, (r) => `Served on the jury: ${R.fmt(r.fee)} paid.`) })));
        }
      }
      list.append(el);
    }
    out.push(list);
    return out;
  }

  function composer(t) {
    if (t.tab === "system") return null;
    const input = keep(h("input", { type: "text", name: `say:${t.id}`, maxLength: 500, placeholder: t.kind === "dm" ? `Message ${t.name}` : t.tab === "npc" ? `Reply to ${t.name}` : `Message ${t.name}`, value: ui.draft, autocomplete: "off" }));
    input.oninput = () => { ui.draft = input.value; };
    const form = h("form", {}, input, h("button", { className: "primary", type: "submit", textContent: "Send" }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ui.draft = ""; input.value = "";
      await run("send_message", { thread: t.id, text });
      panel.querySelector("input[name^='say:']")?.focus();
    };
    return form;
  }

  function personView(ib, who) {
    const out = [], friend = ib.friends.some((f) => f.id === who.pid), asked = ib.sent.includes(who.pid), theyAsked = ib.asked.some((a) => a.id === who.pid);
    out.push(h("div", { className: "line" }, h("span", { textContent: friend ? `${who.name} is your friend.` : asked ? `You asked ${who.name} to be friends.` : theyAsked ? `${who.name} asked to be your friend.` : `${who.name} is in the city with you.` })));
    if (!friend && !asked) out.push(h("div", { className: "line" }, h("button", { className: "primary", textContent: theyAsked ? "Accept friend" : "Add friend", onclick: () => run("add_friend", { player: who.pid }, theyAsked ? `You and ${who.name} are friends.` : `Asked ${who.name} to be friends.`) })));
    const dm = ib.tabs.players.find((x) => x.kind === "dm" && x.members?.some((m) => m.id === who.pid));
    if (dm) out.push(h("div", { className: "line" }, h("button", { textContent: "Open conversation", onclick: () => { ui.person = null; ui.thread = dm.id; draw(true); } })));
    const input = keep(h("input", { type: "text", name: `to:${who.pid}`, maxLength: 500, placeholder: `Message ${who.name}`, autocomplete: "off" }));
    const form = h("form", { style: "border:0;padding:4px 6px" }, input, h("button", { className: "primary", type: "submit", textContent: "Send" }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const r = await run("send_message", { to: who.pid, text });
      if (r.ok) { ui.person = null; ui.thread = r.thread; draw(true); }
    };
    out.push(form);
    const groups = ib.tabs.players.filter((x) => x.kind === "group" && !x.members.some((m) => m.id === who.pid));
    if (friend && groups.length) {
      const pickG = h("select", { name: "addg" }, ...groups.map((g) => h("option", { value: g.id, textContent: g.name })));
      out.push(h("div", { className: "line" }, h("span", { className: "note", textContent: "Add to a group:" }), pickG, h("button", { textContent: "Add", onclick: () => run("add_to_group", { thread: pickG.value, player: who.pid }, `Added ${who.name}.`) })));
    }
    if (friend) out.push(h("div", { className: "line" }, h("span"), h("button", { textContent: "New group with them", onclick: () => { ui.person = null; ui.group = { with: who.pid }; draw(true); } })));
    return out;
  }

  function groupForm(ib) {
    const name = keep(h("input", { type: "text", name: "group-name", maxLength: 40, placeholder: "Group name", autocomplete: "off" }));
    const boxes = ib.friends.map((f) => { const c = h("input", { type: "checkbox", value: f.id, checked: ui.group?.with === f.id }); return h("label", {}, c, f.name); });
    const form = h("form", { style: "flex-direction:column;border:0;padding:4px 0" }, name, h("h4", { textContent: "Friends in it" }), ...boxes,
      h("button", { className: "primary", type: "submit", textContent: "Create group" }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const members = [...form.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
      const r = await run("create_group", { name: name.value, members }, "Group made.");
      if (r.ok) { ui.group = false; ui.thread = r.thread; draw(true); }
    };
    return [form];
  }

  //: A word for a message that comes while the panel is shut (or on another thread).
  function toastNew(ib) {
    if (!ib) return;
    const all = Object.values(ib.tabs).flat().flatMap((t) => t.msgs.map((m) => ({ t, m })));
    const top = all.reduce((a, x) => Math.max(a, x.m.id), 0);
    if (ui.lastId === null) { ui.lastId = top; return; }
    const fresh = all.filter((x) => x.m.id > ui.lastId && x.m.from !== me() && x.t.unread && !(ui.open && ui.thread === x.t.id));
    ui.lastId = Math.max(ui.lastId, top);
    const x = fresh[fresh.length - 1];
    if (x) notify(`✉ ${x.m.name || x.t.name || nameOf(x.m.from)}: ${x.m.text.split("\n")[0].slice(0, 90)}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ""}`);
  }

  globalThis.addEventListener?.("keydown", (e) => { if (e.key === "Escape" && ui.open && !e.defaultPrevented) close(); });
  const timer = setInterval(() => { if (ui.on) draw(); }, 1000);

  return {
    //: The strip is there while the game is on; it sits clear of the map's open controls.
    layout({ on, left = 0 }) {
      ui.on = on;
      doc.documentElement.style.setProperty("--city-msg-x", `${Math.round(left)}px`);
      if (!on) { panel.hidden = true; tabBtn.hidden = true; return; }
      tabBtn.hidden = ui.open; panel.hidden = !ui.open;
    },
    open, close, person, draw,
    isOpen: () => ui.open,
    stop() { clearInterval(timer); tabBtn.remove(); panel.remove(); },
  };
}
