/* TV board (/tv). Widget tiles on a 12 x 12 GridStack grid that fills the screen. A tile holds one or more
   widgets; with more than one they take turns. One poll of three cached endpoints at the quota-safe interval
   the server sends (globe-users refresh.autoSec), so ten TVs cost the same GA4 tokens as one.
   Keys: E edit layout, Space pause, Left/Right previous/next, F fullscreen. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const ROWS = 12, KEY = "tv-layout-v1";

  /* ── widgets: name, seconds on screen when sharing a tile, markup ── */
  const W = {
    total: { name: "Live number", sec: 15, html: `<span class="lbl"><span class="dot" aria-hidden="true"></span>Live visitors, last 30 min</span><b class="num" data-total>0</b>` },
    globe: { name: "Globe", sec: 30, html: `<iframe src="/globe?tv=1" title="Live visitors on a globe" tabindex="-1"></iframe><div class="gover"><b class="num" data-total>0</b><span>live visitors, last 30 min</span></div>` },
    sites: { name: "Sites", sec: 15, html: `<h2>Live visitors by site</h2><ol class="rows" data-list="sites"></ol>` },
    countries: { name: "Countries", sec: 12, html: `<h2>Where visitors are</h2><ol class="rows" data-list="countries"></ol>` },
    feed: { name: "Happening now", sec: 15, html: `<h2>Happening now</h2><ul class="feed" data-list="feed"></ul>` },
    spike: { name: "Spike", sec: 15, html: `<h2>Traffic spike</h2><div data-list="spike"></div>` },
  };
  const PRESETS = {
    split: [{ x: 0, y: 0, w: 8, h: 12, widgets: ["globe"] }, { x: 8, y: 0, w: 4, h: 3, widgets: ["total"] }, { x: 8, y: 3, w: 4, h: 9, widgets: ["spike", "sites", "feed", "countries"] }],
    rotate: [{ x: 0, y: 0, w: 12, h: 12, widgets: ["globe", "spike", "sites", "feed", "countries"] }],
    board: [{ x: 0, y: 0, w: 4, h: 3, widgets: ["total"] }, { x: 4, y: 0, w: 8, h: 3, widgets: ["spike"] }, { x: 0, y: 3, w: 4, h: 9, widgets: ["sites"] }, { x: 4, y: 3, w: 4, h: 9, widgets: ["countries"] }, { x: 8, y: 3, w: 4, h: 9, widgets: ["feed"] }],
  };

  let data = {}, fetchedAt = 0, paused = false, pollTimer = 0, uid = 0, lastSpiking = false;
  const tiles = new Map(); // id -> { widgets, idx, timer, el }

  /* ── layout: ?layout= preset wins, else this screen's saved layout, else split ── */
  const asked = new URLSearchParams(location.search).get("layout");
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
  const start = PRESETS[asked] || (Array.isArray(saved) && saved.length ? saved : PRESETS[document.documentElement.dataset.preset] || PRESETS.split);

  const stage = $(".stage");
  const cell = () => Math.floor((stage.clientHeight - 6) / ROWS);
  const grid = GridStack.init({ column: 12, maxRow: ROWS, cellHeight: cell(), margin: 3, float: true, staticGrid: true, animate: true }, "#grid");

  function addTile(t) {
    const id = "t" + ++uid;
    const el = document.createElement("div");
    el.className = "grid-stack-item";
    Object.entries({ "gs-id": id, "gs-x": t.x, "gs-y": t.y, "gs-w": t.w, "gs-h": t.h, "gs-min-w": 2, "gs-min-h": 2 }).forEach(([k, v]) => el.setAttribute(k, v));
    el.innerHTML = `<div class="grid-stack-item-content tile"></div>`;
    $("#grid").append(el);
    grid.makeWidget(el);
    tiles.set(id, { widgets: t.widgets.filter((w) => W[w]), idx: 0, timer: 0, el });
    buildTile(id);
  }
  function buildTile(id) {
    const t = tiles.get(id), box = $(".tile", t.el);
    clearTimeout(t.timer);
    box.classList.toggle("bare", t.widgets.length === 1 && t.widgets[0] === "globe");
    box.innerHTML = t.widgets.map((w) => `<div class="wgt${w === "total" ? " hero" : ""}" data-w="${w}">${W[w].html}</div>`).join("")
      + `<div class="tsteps" aria-hidden="true"></div>`
      + `<div class="tedit">${t.widgets.map((w, i) => `<span class="chip">${esc(W[w].name)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(W[w].name)}">×</button></span>`).join("")}
         <select data-add aria-label="Add widget"><option value="">+ Widget</option>${Object.entries(W).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("")}</select>
         <button type="button" class="x" data-del>Remove tile</button></div>`;
    t.idx = 0;
    document.body.classList.toggle("has-total", [...tiles.values()].some((x) => x.widgets.includes("total")));
    render(); show(id, 0);
  }
  function load(list) {
    tiles.forEach((t) => clearTimeout(t.timer));
    grid.removeAll(true); tiles.clear();
    grid.batchUpdate(); list.forEach(addTile); grid.batchUpdate(false);
  }
  function save() {
    const pos = new Map(grid.save(false).map((n) => [n.id, n]));
    const list = [...tiles].map(([id, t]) => { const n = pos.get(id) || {}; return { x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 4, h: n.h ?? 4, widgets: t.widgets }; });
    localStorage.setItem(KEY, JSON.stringify(list));
  }
  grid.on("change", () => { save(); render(); });
  grid.on("resizestop", () => render());

  /* ── rotation inside a tile ── */
  const shown = (t) => {
    const v = t.widgets.filter((w) => w !== "spike" || (data.spikes || []).length);
    return v.length ? v : t.widgets.slice(0, 1);
  };
  function show(id, i) {
    const t = tiles.get(id);
    if (!t) return;
    const list = shown(t), box = $(".tile", t.el);
    t.idx = (i + list.length) % list.length;
    const cur = list[t.idx];
    $$(".wgt", box).forEach((el) => el.classList.toggle("on", el.dataset.w === cur));
    const steps = $(".tsteps", box);
    steps.innerHTML = list.length > 1 ? list.map((_, j) => `<i class="${j === t.idx ? "on" : ""}" style="--dur:${W[cur].sec}s"></i>`).join("") : "";
    clearTimeout(t.timer);
    if (list.length > 1 && !paused) t.timer = setTimeout(() => show(id, t.idx + 1), W[cur].sec * 1000);
  }
  const showAll = (d) => tiles.forEach((t, id) => show(id, t.idx + d));

  /* ── data ── */
  const getJSON = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  async function poll() {
    clearTimeout(pollTimer);
    const [g, rt, sp] = await Promise.all([getJSON("/api/globe-users"), getJSON("/api/realtime-all"), getJSON("/api/spikes")]);
    if (g) data.globe = g;
    if (rt?.ok) data.sites = rt.data || [];
    if (sp?.ok) data.spikes = sp.spikes || [];
    if (g || rt) fetchedAt = Date.now();
    render();
    // ponytail: server picks the cadence from GA4 quota; client only clamps it.
    const sec = Math.min(300, Math.max(30, Number(data.globe?.refresh?.autoSec) || 60));
    pollTimer = setTimeout(poll, sec * 1000);
  }

  /* ── render: every list of a kind gets the same rows, then rows that do not fit are cut ── */
  const spark = (series) => {
    const s = (series || []).slice(-30);
    if (s.length < 2) return "";
    const max = Math.max(1, ...s), pts = s.map((v, i) => `${(i / (s.length - 1)) * 100},${20 - (v / max) * 20}`).join(" ");
    return `<svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  };
  const delta = (s) => {
    if (!(s.baseline > 0)) return "";
    const pct = Math.round(((s.activeUsers - s.baseline) / s.baseline) * 100);
    if (Math.abs(pct) < 10) return `<span class="dl">usual</span>`;
    return `<span class="dl ${pct > 0 ? "up" : "dn"}">${pct > 0 ? "+" : ""}${pct}%</span>`;
  };
  const tile = (name, i) => {
    const t = window.letterTile ? letterTile(name, i) : { letter: "?", color: "#4f46e5" };
    return `<span class="tile" style="background:${t.color}" aria-hidden="true">${esc(t.letter)}</span>`;
  };
  const MAX = 15;
  const LISTS = {
    sites() {
      const rows = [...(data.sites || [])].sort((a, b) => b.activeUsers - a.activeUsers).slice(0, MAX);
      const max = Math.max(1, ...rows.map((r) => r.activeUsers));
      return rows.length ? rows.map((s, i) => `<li class="row">
        <img src="/api/favicon/${encodeURIComponent(s.propertyId)}" alt="" onerror="this.outerHTML=${esc(JSON.stringify(tile(s.siteName || s.domain, i)))}">
        <span class="nm">${esc(s.siteName || s.domain)}</span>
        <span class="meta">${spark(s.series)}${delta(s)}<span class="ct num">${fmt(s.activeUsers)}</span></span>
        <span class="bar"><i style="transform:scaleX(${s.activeUsers / max})"></i></span></li>`).join("")
        : `<li class="empty">No live visitors right now</li>`;
    },
    countries() {
      const rows = (data.globe?.countries || []).slice(0, MAX);
      const max = Math.max(1, ...rows.map((r) => r.count));
      return rows.length ? rows.map((c) => `<li class="row">
        <img src="/api/flag/${encodeURIComponent(String(c.id || "").toLowerCase())}" alt="" onerror="this.style.visibility='hidden'">
        <span class="nm">${esc(c.name)}</span><span class="ct num">${fmt(c.count)}</span>
        <span class="bar"><i style="transform:scaleX(${c.count / max})"></i></span></li>`).join("")
        : `<li class="empty">No countries yet</li>`;
    },
    feed() {
      const rows = (data.globe?.feed || []).slice(0, MAX);
      return rows.length ? rows.map((f) => `<li class="${f.isKey ? "key" : ""}">
        ${f.countryId ? `<img src="/api/flag/${encodeURIComponent(String(f.countryId).toLowerCase())}" alt="">` : `<span class="noflag"></span>`}
        <span><span class="pg" style="display:block">${esc(f.page || f.event)}</span><span class="sub" style="display:block">${esc([f.city, f.site].filter(Boolean).join(" · "))}</span></span>
        <span class="ago num">${f.minutesAgo ? `${f.minutesAgo} min` : "now"}</span></li>`).join("")
        : `<li class="empty">Quiet for now</li>`;
    },
    spike() {
      const s = (data.spikes || [])[0];
      if (!s) return `<p class="empty">No spikes right now</p>`;
      const x = s.ratio ? `${s.ratio.toFixed(1)}x` : "";
      const refs = (s.topReferrals || []).slice(0, 3).map((r) => `<li>${esc(r.classifiedName || r.rawSource)}<b class="num">${fmt(r.users)}</b></li>`).join("");
      return `<div class="spike-row"><p class="spike-big">${esc(s.siteName || s.domain)} <em class="num">${x}</em></p>
        <p class="spike-sub num">${fmt(s.activeUsers)} live, usually ${fmt(Math.round(s.baselineUsers))}${s.topPage ? ` · top page ${esc(s.topPage)}` : ""}</p></div>
        ${refs ? `<ul class="refs">${refs}</ul>` : ""}`;
    },
  };
  // Cut rows that would be clipped. Hidden widgets measure too (visibility, not display), so turns stay full.
  const fit = (ul) => { const lim = ul.clientHeight; [...ul.children].forEach((li) => { li.hidden = false; }); [...ul.children].forEach((li) => { if (li.offsetTop - ul.offsetTop + li.offsetHeight > lim) li.hidden = true; }); };
  function render() {
    const total = data.globe?.totalActiveUsers ?? (data.sites || []).reduce((a, s) => a + s.activeUsers, 0);
    $$("[data-total]").forEach((el) => (el.textContent = fmt(total)));
    Object.entries(LISTS).forEach(([k, fn]) => { const els = $$(`[data-list="${k}"]`); if (!els.length) return; const html = fn(); els.forEach((el) => { el.innerHTML = html; if (el.matches("ol,ul")) fit(el); }); });
    const r = data.globe?.refresh;
    if (r?.perHour) {
      const used = Math.min(1, r.usedThisHour / r.perHour);
      $("#quota i").style.transform = `scaleX(${used})`;
      $("#quota").classList.toggle("low", used > 0.75 || !!r.throttled);
      $("#quotaTxt").textContent = `Quota ${Math.round(used * 100)}% · every ${r.autoSec}s`;
    }
    // a spike starting or ending changes which widgets take turns
    const spiking = !!(data.spikes || []).length;
    if (spiking !== lastSpiking) { lastSpiking = spiking; tiles.forEach((t, id) => t.widgets.includes("spike") && show(id, 0)); }
  }

  /* ── edit mode ── */
  function setEditing(on) {
    document.body.classList.toggle("editing", on);
    grid.setStatic(!on);
    $("#editBtn").textContent = on ? "Done" : "Edit layout";
    $("#emsg").textContent = "";
    if (on) setPaused(true); else { save(); setPaused(false); }
  }
  $("#editBtn").addEventListener("click", () => setEditing(!document.body.classList.contains("editing")));
  $("#doneBtn").addEventListener("click", () => setEditing(false));
  $("#preset").addEventListener("change", (e) => { load(PRESETS[e.target.value]); save(); setPaused(true); });
  $("#addTile").addEventListener("click", () => {
    const t = { w: 4, h: 4, autoPosition: true };
    if (!grid.willItFit(t)) { $("#emsg").textContent = "No room: make a tile smaller first"; return; }
    $("#emsg").textContent = "";
    // find the first empty 4 x 4 spot, scanning rows
    for (let y = 0; y <= ROWS - 4; y++) for (let x = 0; x <= 8; x++) if (grid.isAreaEmpty(x, y, 4, 4)) { addTile({ x, y, w: 4, h: 4, widgets: ["sites"] }); save(); return; }
  });
  $("#grid").addEventListener("click", (e) => {
    const item = e.target.closest(".grid-stack-item"), id = item?.getAttribute("gs-id"), t = tiles.get(id);
    if (!t) return;
    if (e.target.matches("[data-rm]")) { t.widgets.splice(+e.target.dataset.rm, 1); if (!t.widgets.length) t.widgets.push("total"); buildTile(id); save(); }
    else if (e.target.matches("[data-del]")) { clearTimeout(t.timer); grid.removeWidget(item); tiles.delete(id); document.body.classList.toggle("has-total", [...tiles.values()].some((x) => x.widgets.includes("total"))); save(); }
  });
  $("#grid").addEventListener("change", (e) => {
    if (!e.target.matches("[data-add]") || !e.target.value) return;
    const id = e.target.closest(".grid-stack-item").getAttribute("gs-id"), t = tiles.get(id);
    if (!t.widgets.includes(e.target.value)) t.widgets.push(e.target.value);
    buildTile(id); save();
  });
  // ponytail: a widget moves between tiles by removing it here and adding it there; drag between tiles if that feels slow.
  // Keep drags from starting on the tile's own controls.
  $("#grid").addEventListener("mousedown", (e) => { if (e.target.closest(".tedit")) e.stopPropagation(); }, true);

  function setPaused(p) {
    paused = p;
    document.body.classList.toggle("paused", p);
    tiles.forEach((t, id) => (p ? clearTimeout(t.timer) : show(id, t.idx)));
  }

  /* ── chrome: clock, freshness, idle cursor, burn-in shift, keys ── */
  function tick() {
    $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const age = fetchedAt ? Math.round((Date.now() - fetchedAt) / 1000) : null;
    $("#fresh").textContent = age == null ? "Loading" : age < 5 ? "Updated just now" : age < 120 ? `Updated ${age}s ago` : `Updated ${Math.round(age / 60)} min ago`;
  }
  let idleT = 0;
  const wake = () => { document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 3000); };
  ["mousemove", "pointerdown", "keydown"].forEach((e) => addEventListener(e, wake, { passive: true }));
  // ponytail: burn-in guard, a few px drift every 3 min; OLED owners can add a dim schedule later.
  setInterval(() => { if (!document.body.classList.contains("editing")) $("#tv").style.translate = `${Math.round(Math.random() * 6 - 3)}px ${Math.round(Math.random() * 6 - 3)}px`; }, 180000);
  addEventListener("keydown", (e) => {
    if (e.target.matches("select, input")) return;
    if (e.key === " ") { e.preventDefault(); setPaused(!paused); }
    else if (e.key === "ArrowRight") showAll(1);
    else if (e.key === "ArrowLeft") showAll(-1);
    else if (e.key === "e" || e.key === "E") setEditing(!document.body.classList.contains("editing"));
    else if (e.key === "Escape" && document.body.classList.contains("editing")) setEditing(false);
    else if (e.key === "f" || e.key === "F") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  });
  let rz = 0;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { grid.cellHeight(cell()); render(); }, 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - fetchedAt > 60000) poll(); });

  $("#preset").value = PRESETS[asked] ? asked : "split";
  load(start);
  wake(); tick(); setInterval(tick, 1000); poll();
})();
