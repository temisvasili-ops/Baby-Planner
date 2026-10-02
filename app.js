/* Baby Arrival Plan: client app. Data lives in Supabase; row-level security limits it to invited emails. */
(function () {
  "use strict";
  const cfg = window.BABY_PLAN_CONFIG;

  // Private-link access: the code after #k= is sent with every request and checked by the database.
  const KEY_STORE = "babyPlanKey";
  function readKey() {
    const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]{16,})/);
    if (m) {
      try { localStorage.setItem(KEY_STORE, m[1]); } catch (e) {}
      return m[1];
    }
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  const planKey = readKey();
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-plan-key": planKey } }
  });

  const STREAMS = { health: "Health & care", work: "Work & money", home: "Home & kit", childcare: "Childcare", admin: "Admin & legal", birth: "Birth & postnatal", us: "Us" };
  const ZONES = { bedroom: "Bedroom: sleep & night", changing: "Changing", bathroom: "Bathroom", feeding: "Feeding", out: "Out & about", clothing: "Clothing", postpartum: "Your recovery", safety: "Health & safety", other: "Other" };
  const ISTATUS = [["shortlist", "Shortlist"], ["ordered", "Ordered"], ["arrived", "Arrived"], ["in_place", "In place"]];
  const SOURCE = { buy: "Buy new", secondhand: "Second-hand", borrow: "Borrow", gift: "Gift" };
  const PHASES = [
    { name: "Second trimester", range: "Weeks 14–27", test: t => t.anchor === "week" && t.at_n < 28 },
    { name: "Third trimester", range: "Weeks 28–35", test: t => t.anchor === "week" && t.at_n >= 28 && t.at_n < 36 },
    { name: "Final stretch", range: "Weeks 36–40", test: t => t.anchor === "week" && t.at_n >= 36 },
    { name: "Fourth trimester", range: "Birth to 12 weeks+", test: t => t.anchor === "birth" }
  ];
  const DAY = 864e5;

  const state = {
    settings: { edd: "2027-03-31", me_name: "Tem", partner_name: "Partner", birth: null, spend_threshold: 150 },
    tasks: [], items: [], caddies: [], caddyItems: [],
    view: "plan", owner: "all", tstatus: "open", zone: "all", kitShow: "todo",
    editing: null
  };

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
  const money = n => "£" + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const parseDate = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const fmt = d => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const lmp = () => new Date(parseDate(state.settings.edd).getTime() - 280 * DAY);
  const gestWeek = () => Math.floor((today() - lmp()) / DAY / 7);
  const weekDate = w => new Date(lmp().getTime() + w * 7 * DAY);
  const dueDate = t => t.anchor === "birth"
    ? new Date(parseDate(state.settings.birth || state.settings.edd).getTime() + t.at_n * DAY)
    : weekDate(t.at_n);
  const ownerName = o => o === "me" ? state.settings.me_name : o === "partner" ? state.settings.partner_name : "Both";

  /* ---------- notices & writes ---------- */
  function notify(msg) { const n = $("notice"); n.textContent = msg; n.hidden = !msg; }
  async function run(promise) {
    const { error } = await promise;
    if (error) { notify("That change didn't save: " + error.message + ". Check your connection and try again."); return false; }
    notify(""); return true;
  }

  /* ---------- loading & realtime ---------- */
  async function loadAll() {
    const [s, t, i, c, ci] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("tasks").select("*"),
      sb.from("items").select("*"),
      sb.from("caddies").select("*").order("sort"),
      sb.from("caddy_items").select("*").order("sort")
    ]);
    const err = [s, t, i, c, ci].find(r => r.error);
    if (err) { notify("Couldn't load the plan: " + err.error.message); return; }
    if (s.data) state.settings = s.data;
    state.tasks = t.data; state.items = i.data; state.caddies = c.data; state.caddyItems = ci.data;
    return !!(s.data || t.data.length);
  }
  // Keep both phones in step: refresh every 20 s while the page is open, and whenever it comes back to the foreground.
  // Skipped while a dialog is open or a caddy input has focus, so a refresh never interrupts typing.
  async function refresh() {
    if ($("app").hidden || document.hidden) return;
    if (document.querySelector("dialog[open]")) return;
    const a = document.activeElement;
    if (a && a.matches && a.matches("input,textarea,select")) return;
    if (await loadAll()) render();
  }
  setInterval(refresh, 20000);
  document.addEventListener("visibilitychange", refresh);

  /* ---------- render: shared ---------- */
  function renderHeader() {
    const w = gestWeek(), s = state.settings;
    $("weekline").textContent = `Week ${w} · due ${fmt(parseDate(s.edd))} · ${s.me_name} & ${s.partner_name}`;
    const x = wk => 20 + (wk - 14) / (44 - 14) * 560;
    let h = `<line x1="20" y1="30" x2="580" y2="30" stroke="var(--line)" stroke-width="2"/>`;
    for (let k = 14; k <= 40; k += 2) h += `<line x1="${x(k)}" y1="25" x2="${x(k)}" y2="35" stroke="var(--line)"/><text x="${x(k)}" y="50" text-anchor="middle">${k}</text>`;
    h += `<text x="${x(42.5)}" y="50" text-anchor="middle">+12wk</text>`;
    const cw = Math.max(14, Math.min(44, w));
    h += `<line x1="20" y1="30" x2="${x(cw)}" y2="30" stroke="var(--accent)" stroke-width="3"/><circle cx="${x(cw)}" cy="30" r="6" fill="var(--accent)"/><text x="${cw < 17 ? x(cw) - 6 : x(cw)}" y="16" text-anchor="${cw < 17 ? "start" : "middle"}" style="fill:var(--accent);font-weight:500">now · ${w}w</text>`;
    $("ruler").innerHTML = h;
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    ["plan", "kit", "caddies", "budget"].forEach(v => { $("view-" + v).hidden = v !== state.view; });
  }
  function seg(el, opts, cur, key) {
    el.innerHTML = opts.map(([v, l]) => `<button type="button" data-${key}="${v}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("");
  }
  function render() {
    renderHeader();
    if (state.view === "plan") renderPlan();
    if (state.view === "kit") renderKit();
    if (state.view === "caddies") renderCaddies();
    if (state.view === "budget") renderBudget();
  }

  /* ---------- plan ---------- */
  const visibleTask = t => {
    if (state.owner !== "all" && t.owner !== state.owner && !(state.owner !== "both" && t.owner === "both")) return false;
    if (state.tstatus === "open" && t.status === "done") return false;
    if (state.tstatus === "done" && t.status !== "done") return false;
    return true;
  };
  const sortTasks = l => [...l].sort((a, b) => dueDate(a) - dueDate(b) || a.title.localeCompare(b.title));
  function taskRow(t) {
    const d = dueDate(t), now = today(); let cls = "";
    if (t.status !== "done") { if (d < now) cls = "late"; else if (d - now <= 14 * DAY) cls = "soon"; }
    const when = t.anchor === "birth" ? `Birth +${t.at_n}d` : `Week ${t.at_n}`;
    const tk = t.status === "done" ? "done" : t.status === "doing" ? "prog" : "";
    return `<li class="row-item ${t.status === "done" ? "done" : ""}">
      <button class="tick ${tk}" data-tick="${t.id}" aria-label="Status ${t.status}; change">${t.status === "done" ? "✓" : ""}</button>
      <div class="main"><div class="title">${esc(t.title)}${t.hard ? '<span class="hard">DEADLINE</span>' : ""}</div>
      <div class="meta"><span class="due ${cls}">${when} · ${fmt(d)}</span>
        <button class="chip ${t.owner}" data-towner="${t.id}" aria-label="Owner ${esc(ownerName(t.owner))}; change">${esc(ownerName(t.owner))}</button>
        <span class="tag">${esc(STREAMS[t.stream] || t.stream)}</span>
        <button class="btn mini" data-tedit="${t.id}">Edit</button></div>
      ${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}</div></li>`;
  }
  function renderPlan() {
    const s = state.settings, now = today();
    seg($("ownerSeg"), [["all", "Everyone"], ["me", s.me_name], ["partner", s.partner_name], ["both", "Joint"]], state.owner, "owner");
    seg($("statusSeg"), [["open", "Open"], ["done", "Done"], ["all", "All"]], state.tstatus, "tstatus");
    const open = state.tasks.filter(t => t.status !== "done");
    const late = open.filter(t => dueDate(t) < now).length;
    const soon = open.filter(t => { const d = dueDate(t); return d >= now && d - now <= 14 * DAY; }).length;
    const by = o => open.filter(t => t.owner === o).length;
    $("planStats").innerHTML = `<div><b>${state.tasks.length - open.length}/${state.tasks.length}</b> <span>done</span></div>
      <div><b style="color:var(--warn)">${soon}</b> <span>due in 2 weeks</span></div>
      <div><b style="color:var(--bad)">${late}</b> <span>overdue</span></div>
      <div><b>${by("me")}·${by("partner")}·${by("both")}</b> <span>open: ${esc(s.me_name)} · ${esc(s.partner_name)} · joint</span></div>`;
    const next = sortTasks(open.filter(t => visibleTask(t) && dueDate(t) - now <= 21 * DAY));
    $("focus").innerHTML = `<div class="eyebrow">Next three weeks</div><h2>Agenda for this week's check-in</h2>${next.length ? `<ul class="list">${next.map(taskRow).join("")}</ul>` : `<p class="empty">Nothing due in the next three weeks for this filter.</p>`}`;
    $("phases").innerHTML = PHASES.map(p => {
      const all = state.tasks.filter(p.test), list = sortTasks(all.filter(visibleTask)), dn = all.filter(t => t.status === "done").length;
      return `<section class="phase"><div class="phase-head"><h2>${p.name}</h2><span class="eyebrow">${p.range} · ${dn}/${all.length} done</span></div>${list.length ? `<ul class="list">${list.map(taskRow).join("")}</ul>` : `<p class="empty">Nothing here for this filter.</p>`}</section>`;
    }).join("");
  }

  /* ---------- kit ---------- */
  const istIdx = s => ISTATUS.findIndex(x => x[0] === s);
  function itemRow(it) {
    const idx = istIdx(it.status);
    const cost = it.actual_cost != null ? money(it.actual_cost) : it.est_cost != null ? "est " + money(it.est_cost) : "";
    const link = safeUrl(it.link);
    return `<li class="row-item ${it.status === "in_place" ? "done" : ""}">
      <button class="tick ${it.status === "in_place" ? "done" : idx > 0 ? "prog" : ""}" data-istep="${it.id}" aria-label="Advance status">${it.status === "in_place" ? "✓" : ""}</button>
      <div class="main"><div class="title">${esc(it.name)}${it.qty > 1 ? ` <span class="qty">×${it.qty}</span>` : ""}${it.essential ? "" : ' <span class="opt">optional</span>'}</div>
      <div class="meta">
        <button class="status-btn" data-istep="${it.id}"><span class="pipe s${idx + 1}"><i></i><i></i><i></i><i></i></span>${ISTATUS[idx][1]}</button>
        <button class="chip ${it.owner}" data-iowner="${it.id}">${esc(ownerName(it.owner))}</button>
        <span class="tag">${SOURCE[it.source]}</span>
        ${cost ? `<span class="due">${cost}</span>` : ""}
        <button class="btn mini" data-iedit="${it.id}">Edit</button></div>
      ${it.note || link ? `<div class="note">${esc(it.note)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Product link</a>` : ""}</div>` : ""}
      </div></li>`;
  }
  function renderKit() {
    const zones = [["all", "All zones"], ...Object.entries(ZONES).filter(([z]) => z !== "other" || state.items.some(i => i.zone === "other"))];
    seg($("zoneSeg"), zones, state.zone, "zone");
    seg($("kitShowSeg"), [["todo", "Not in place"], ["essential", "Essentials"], ["all", "All"]], state.kitShow, "kitshow");
    const ess = state.items.filter(i => i.essential);
    const essDone = ess.filter(i => i.status === "in_place").length;
    const ordered = state.items.filter(i => i.status === "ordered").length;
    const short = state.items.filter(i => i.status === "shortlist" && i.essential).length;
    $("kitStats").innerHTML = `<div><b>${essDone}/${ess.length}</b> <span>essentials in place</span></div>
      <div><b style="color:var(--warn)">${ordered}</b> <span>ordered, awaiting delivery</span></div>
      <div><b>${short}</b> <span>essentials still to choose</span></div>
      <div><span>Ready-by target: week 34 (${fmt(weekDate(34))})</span></div>`;
    let list = state.items.filter(i => state.zone === "all" || i.zone === state.zone);
    if (state.kitShow === "todo") list = list.filter(i => i.status !== "in_place");
    if (state.kitShow === "essential") list = list.filter(i => i.essential);
    const zoneKeys = Object.keys(ZONES).filter(z => list.some(i => i.zone === z));
    $("kitList").innerHTML = zoneKeys.length ? zoneKeys.map(z => {
      const zl = list.filter(i => i.zone === z).sort((a, b) => (b.essential - a.essential) || istIdx(a.status) - istIdx(b.status) || a.name.localeCompare(b.name));
      const all = state.items.filter(i => i.zone === z), dn = all.filter(i => i.status === "in_place").length;
      return `<section class="zone-head"><div class="phase-head"><h2>${ZONES[z]}</h2><span class="eyebrow">${dn}/${all.length} in place</span></div><ul class="list">${zl.map(itemRow).join("")}</ul></section>`;
    }).join("") : `<p class="empty">Nothing to show for this filter. Switch to All, or use Add item.</p>`;
  }

  /* ---------- caddies ---------- */
  function renderCaddies() {
    const g = $("caddyGrid");
    if (!state.caddies.length) { g.innerHTML = `<p class="empty">No caddies yet. Use Add caddy to create a packing list.</p>`; return; }
    g.innerHTML = state.caddies.map(c => {
      const its = state.caddyItems.filter(x => x.caddy_id === c.id);
      const pk = its.filter(x => x.packed).length, pct = its.length ? Math.round(pk / its.length * 100) : 0;
      const due = c.ready_by_week ? `Ready by week ${c.ready_by_week} · ${fmt(weekDate(c.ready_by_week))}` : "";
      return `<article class="caddy ${its.length && pk === its.length ? "complete" : ""}">
        <div class="caddy-head"><div><h3>${esc(c.name)}</h3><div class="eyebrow">${esc(c.location || "")}${c.location && due ? " · " : ""}${due}</div></div>
          <button class="btn mini" data-cedit="${c.id}">Edit</button></div>
        <div class="bar" aria-label="${pk} of ${its.length} packed"><span style="width:${pct}%"></span></div>
        <div class="small muted">${pk}/${its.length} packed</div>
        <ul>${its.map(x => `<li class="${x.packed ? "packed" : ""}"><label><input type="checkbox" data-cpack="${x.id}" ${x.packed ? "checked" : ""}><span>${esc(x.label)}</span>${x.qty ? `<span class="qty">${esc(x.qty)}</span>` : ""}</label><button class="x" data-cidel="${x.id}" aria-label="Remove ${esc(x.label)}">×</button></li>`).join("")}</ul>
        <form class="add-row" data-cadd="${c.id}"><input name="label" placeholder="Add item" maxlength="80" aria-label="Add item to ${esc(c.name)}"><button class="btn mini" type="submit">Add</button></form>
      </article>`;
    }).join("");
  }

  /* ---------- budget ---------- */
  function renderBudget() {
    const rows = Object.keys(ZONES).map(z => {
      const its = state.items.filter(i => i.zone === z);
      const est = its.reduce((a, i) => a + (Number(i.est_cost) || 0), 0);
      const bought = its.filter(i => i.actual_cost != null);
      const act = bought.reduce((a, i) => a + Number(i.actual_cost), 0);
      const estBought = bought.reduce((a, i) => a + (Number(i.est_cost) || 0), 0);
      return { z, n: its.length, est, act, estBought, nb: bought.length };
    }).filter(r => r.n);
    const T = rows.reduce((a, r) => ({ est: a.est + r.est, act: a.act + r.act, estBought: a.estBought + r.estBought, n: a.n + r.n, nb: a.nb + r.nb }), { est: 0, act: 0, estBought: 0, n: 0, nb: 0 });
    const unpriced = state.items.filter(i => i.est_cost == null && i.actual_cost == null).length;
    const free = state.items.filter(i => i.source === "borrow" || i.source === "gift").length;
    $("budgetStats").innerHTML = `<div><b>${money(T.est)}</b> <span>estimated</span></div>
      <div><b>${money(T.act)}</b> <span>spent on ${T.nb} items</span></div>
      <div><b>${unpriced}</b> <span>items not yet priced</span></div>
      <div><b>${free}</b> <span>borrowed or gifted</span></div>`;
    const v = r => { const d = r.act - r.estBought; return r.nb ? `<span class="${d > 0 ? "over" : "under"}">${d > 0 ? "+" : ""}${money(d).replace("£-", "−£")}</span>` : "—"; };
    $("budgetTable").innerHTML = `<thead><tr><th>Zone</th><th>Items</th><th>Estimated</th><th>Spent</th><th>Vs estimate (bought)</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${ZONES[r.z]}</td><td>${r.n}</td><td>${money(r.est)}</td><td>${money(r.act)}</td><td>${v(r)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td>${T.n}</td><td>${money(T.est)}</td><td>${money(T.act)}</td><td>${v(T)}</td></tr></tfoot>`;
  }

  /* ---------- interactions ---------- */
  const find = (arr, id) => arr.find(x => x.id === id);
  const cycleOwner = o => o === "me" ? "partner" : o === "partner" ? "both" : "me";
  async function optimistic(arr, id, patch, table) {
    const row = find(arr, id); if (!row) return;
    const prev = { ...row }; Object.assign(row, patch); render();
    if (!await run(sb.from(table).update(patch).eq("id", id))) { Object.assign(row, prev); render(); }
  }

  document.addEventListener("click", async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.view) { state.view = d.view; render(); window.scrollTo(0, 0); return; }
    if (d.owner) { state.owner = d.owner; render(); return; }
    if (d.tstatus) { state.tstatus = d.tstatus; render(); return; }
    if (d.zone) { state.zone = d.zone; render(); return; }
    if (d.kitshow) { state.kitShow = d.kitshow; render(); return; }
    if (d.close !== undefined) { b.closest("dialog").close(); return; }
    if (d.tick) { const t = find(state.tasks, d.tick); const nx = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo"; return optimistic(state.tasks, t.id, { status: nx }, "tasks"); }
    if (d.towner) { const t = find(state.tasks, d.towner); return optimistic(state.tasks, t.id, { owner: cycleOwner(t.owner) }, "tasks"); }
    if (d.tedit) return openTask(find(state.tasks, d.tedit));
    if (d.istep) { const it = find(state.items, d.istep); const nx = ISTATUS[(istIdx(it.status) + 1) % ISTATUS.length][0]; return optimistic(state.items, it.id, { status: nx }, "items"); }
    if (d.iowner) { const it = find(state.items, d.iowner); return optimistic(state.items, it.id, { owner: cycleOwner(it.owner) }, "items"); }
    if (d.iedit) return openItem(find(state.items, d.iedit));
    if (d.cedit) return openCaddy(find(state.caddies, d.cedit));
    if (d.cidel) { const id = d.cidel; const prev = state.caddyItems; state.caddyItems = prev.filter(x => x.id !== id); render(); if (!await run(sb.from("caddy_items").delete().eq("id", id))) { state.caddyItems = prev; render(); } return; }
  });
  document.addEventListener("change", ev => {
    const el = ev.target;
    if (el.dataset && el.dataset.cpack) optimistic(state.caddyItems, el.dataset.cpack, { packed: el.checked }, "caddy_items");
  });
  document.addEventListener("submit", async ev => {
    const f = ev.target; if (!f.dataset || !f.dataset.cadd) return;
    ev.preventDefault();
    const label = f.label.value.trim(); if (!label) return;
    const sort = state.caddyItems.filter(x => x.caddy_id === f.dataset.cadd).length;
    const { data, error } = await sb.from("caddy_items").insert({ caddy_id: f.dataset.cadd, label, sort }).select().single();
    if (error) return notify("Couldn't add that item: " + error.message);
    if (!find(state.caddyItems, data.id)) state.caddyItems.push(data);
    render();
    const again = document.querySelector(`form[data-cadd="${f.dataset.cadd}"] input`); if (again) again.focus();
  });

  /* two-tap delete inside dialogs (confirm() is unreliable on mobile) */
  function armDelete(btn, label, action) {
    btn.onclick = async () => {
      if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Tap again to delete"; setTimeout(() => { btn.dataset.armed = ""; btn.textContent = label; }, 4000); return; }
      btn.dataset.armed = ""; btn.textContent = label; await action();
    };
  }
  const opts = (sel, pairs) => { sel.innerHTML = pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); };
  const ownerPairs = () => [["me", state.settings.me_name], ["partner", state.settings.partner_name], ["both", "Both"]];

  function openTask(t) {
    state.editing = t || null;
    opts($("t-owner"), ownerPairs()); opts($("t-stream"), Object.entries(STREAMS));
    $("taskDlgTitle").textContent = t ? "Edit task" : "Add task"; $("t-del").hidden = !t;
    $("t-title").value = t?.title || ""; $("t-owner").value = t?.owner || "both"; $("t-stream").value = t?.stream || "home";
    $("t-anchor").value = t?.anchor || "week"; $("t-at").value = t?.at_n ?? Math.max(14, gestWeek() + 1);
    $("t-status").value = t?.status || "todo"; $("t-hard").checked = !!t?.hard; $("t-note").value = t?.note || "";
    armDelete($("t-del"), "Delete", async () => { if (await run(sb.from("tasks").delete().eq("id", t.id))) { state.tasks = state.tasks.filter(x => x.id !== t.id); $("taskDlg").close(); render(); } });
    $("taskDlg").showModal();
  }
  $("taskForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const row = { title: $("t-title").value.trim(), owner: $("t-owner").value, stream: $("t-stream").value, anchor: $("t-anchor").value, at_n: Number($("t-at").value), status: $("t-status").value, hard: $("t-hard").checked, note: $("t-note").value.trim() };
    if (!row.title) return;
    const t = state.editing;
    const q = t ? sb.from("tasks").update(row).eq("id", t.id).select().single() : sb.from("tasks").insert(row).select().single();
    const { data, error } = await q; if (error) return notify("Couldn't save the task: " + error.message);
    state.tasks = [...state.tasks.filter(x => x.id !== data.id), data]; $("taskDlg").close(); render();
  });

  function openItem(it) {
    state.editing = it || null;
    opts($("i-zone"), Object.entries(ZONES)); opts($("i-status"), ISTATUS); opts($("i-owner"), ownerPairs());
    $("itemDlgTitle").textContent = it ? "Edit item" : "Add item"; $("i-del").hidden = !it;
    $("i-name").value = it?.name || ""; $("i-zone").value = it?.zone || (state.zone !== "all" ? state.zone : "bedroom");
    $("i-qty").value = it?.qty ?? 1; $("i-status").value = it?.status || "shortlist"; $("i-owner").value = it?.owner || "partner";
    $("i-source").value = it?.source || "buy"; $("i-ess").checked = it ? it.essential : true;
    $("i-est").value = it?.est_cost ?? ""; $("i-act").value = it?.actual_cost ?? ""; $("i-link").value = it?.link || ""; $("i-note").value = it?.note || "";
    armDelete($("i-del"), "Delete", async () => { if (await run(sb.from("items").delete().eq("id", it.id))) { state.items = state.items.filter(x => x.id !== it.id); $("itemDlg").close(); render(); } });
    $("itemDlg").showModal();
  }
  $("itemForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const num = v => v === "" ? null : Number(v);
    const row = { name: $("i-name").value.trim(), zone: $("i-zone").value, qty: Number($("i-qty").value) || 0, status: $("i-status").value, owner: $("i-owner").value, source: $("i-source").value, essential: $("i-ess").checked, est_cost: num($("i-est").value), actual_cost: num($("i-act").value), link: $("i-link").value.trim(), note: $("i-note").value.trim() };
    if (!row.name) return;
    const it = state.editing;
    const q = it ? sb.from("items").update(row).eq("id", it.id).select().single() : sb.from("items").insert(row).select().single();
    const { data, error } = await q; if (error) return notify("Couldn't save the item: " + error.message);
    state.items = [...state.items.filter(x => x.id !== data.id), data]; $("itemDlg").close(); render();
  });

  function openCaddy(c) {
    state.editing = c || null;
    $("caddyDlgTitle").textContent = c ? "Edit caddy" : "Add caddy"; $("c-del").hidden = !c;
    $("c-name").value = c?.name || ""; $("c-loc").value = c?.location || ""; $("c-week").value = c?.ready_by_week ?? 36;
    armDelete($("c-del"), "Delete caddy", async () => { if (await run(sb.from("caddies").delete().eq("id", c.id))) { state.caddies = state.caddies.filter(x => x.id !== c.id); state.caddyItems = state.caddyItems.filter(x => x.caddy_id !== c.id); $("caddyDlg").close(); render(); } });
    $("caddyDlg").showModal();
  }
  $("caddyForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const row = { name: $("c-name").value.trim(), location: $("c-loc").value.trim(), ready_by_week: $("c-week").value === "" ? null : Number($("c-week").value) };
    if (!row.name) return;
    const c = state.editing;
    if (!c) row.sort = state.caddies.length;
    const q = c ? sb.from("caddies").update(row).eq("id", c.id).select().single() : sb.from("caddies").insert(row).select().single();
    const { data, error } = await q; if (error) return notify("Couldn't save the caddy: " + error.message);
    state.caddies = [...state.caddies.filter(x => x.id !== data.id), data].sort((a, b) => a.sort - b.sort); $("caddyDlg").close(); render();
  });

  $("addTask").onclick = () => openTask(null);
  $("addItem").onclick = () => openItem(null);
  $("addCaddy").onclick = () => openCaddy(null);
  $("settingsBtn").onclick = () => {
    const s = state.settings;
    $("s-me").value = s.me_name; $("s-partner").value = s.partner_name; $("s-edd").value = s.edd; $("s-birth").value = s.birth || ""; $("s-threshold").value = s.spend_threshold ?? "";
    $("setDlg").showModal();
  };
  $("setForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const row = { me_name: $("s-me").value.trim() || "Me", partner_name: $("s-partner").value.trim() || "Partner", edd: $("s-edd").value, birth: $("s-birth").value || null, spend_threshold: $("s-threshold").value === "" ? null : Number($("s-threshold").value) };
    if (await run(sb.from("settings").update(row).eq("id", 1))) { Object.assign(state.settings, row); $("setDlg").close(); render(); }
  });

  /* ---------- start ---------- */
  function locked() { $("auth").hidden = false; $("app").hidden = true; }
  window.addEventListener("hashchange", () => { if (/[#&]k=/.test(location.hash)) location.reload(); });
  // Recovery: paste the full link (or just the code) on the locked page.
  $("keyForm").addEventListener("submit", ev => {
    ev.preventDefault();
    const v = $("keyInput").value.trim();
    const m = v.match(/k=([A-Za-z0-9_-]{16,})/) || v.match(/^([A-Za-z0-9_-]{16,})$/);
    if (!m) { $("keyMsg").textContent = "That doesn't look like the private link. Paste the whole link, including the part after #k="; return; }
    history.replaceState(null, "", location.pathname + location.search + "#k=" + m[1]);
    location.reload();
  });
  (async () => {
    if (!planKey) return locked();
    // Keep the code in the address so "Add to Home Screen" and bookmarks save the full private link.
    // (Home-screen apps on iPhone have their own storage, so they can't rely on the remembered code.)
    const want = "#k=" + planKey;
    if (location.hash !== want) history.replaceState(null, "", location.pathname + location.search + want);
    const ok = await loadAll();
    if (ok === undefined) { $("auth").hidden = true; $("app").hidden = false; render(); return; } // network error: show notice
    if (!ok) { try { localStorage.removeItem(KEY_STORE); } catch (e) {} return locked(); }
    $("auth").hidden = true; $("app").hidden = false; render();
  })();
})();
