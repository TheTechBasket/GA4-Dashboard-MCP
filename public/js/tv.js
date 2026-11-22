/* TV board (/tv). One poll of three cached endpoints at the quota-safe interval the server sends
   (globe-users refresh.autoSec), so ten TVs cost the same GA4 tokens as one. Scenes rotate on a timer.
   Keys: Space pause, Left/Right previous/next, F fullscreen. */
(() => {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement, layout = root.dataset.layout;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const SCENE_SEC = { globe: 30, sites: 15, feed: 15, countries: 12, spike: 15 };

  let data = {}, fetchedAt = 0, paused = false, idx = 0, timer = 0, pollTimer = 0;

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

  /* ── render ── */
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

  function renderSites() {
    const rows = [...(data.sites || [])].sort((a, b) => b.activeUsers - a.activeUsers).slice(0, layout === "rotate" ? 8 : layout === "board" ? 5 : 7);
    const max = Math.max(1, ...rows.map((r) => r.activeUsers));
    $("#sites").innerHTML = rows.length ? rows.map((s, i) => `<li class="row">
      <img src="/api/favicon/${encodeURIComponent(s.propertyId)}" alt="" onerror="this.outerHTML=${esc(JSON.stringify(tile(s.siteName || s.domain, i)))}">
      <span class="nm">${esc(s.siteName || s.domain)}</span>
      <span class="meta">${spark(s.series)}${delta(s)}<span class="ct num">${fmt(s.activeUsers)}</span></span>
      <span class="bar"><i style="transform:scaleX(${s.activeUsers / max})"></i></span></li>`).join("")
      : `<li class="empty">No live visitors right now</li>`;
  }
  function renderCountries() {
    const rows = (data.globe?.countries || []).slice(0, layout === "rotate" ? 8 : layout === "board" ? 5 : 7);
    const max = Math.max(1, ...rows.map((r) => r.count));
    $("#countries").innerHTML = rows.length ? rows.map((c) => `<li class="row">
      <img src="/api/flag/${encodeURIComponent(String(c.id || "").toLowerCase())}" alt="" onerror="this.style.visibility='hidden'">
      <span class="nm">${esc(c.name)}</span><span class="ct num">${fmt(c.count)}</span>
      <span class="bar"><i style="transform:scaleX(${c.count / max})"></i></span></li>`).join("")
      : `<li class="empty">No countries yet</li>`;
  }
  function renderFeed() {
    const rows = (data.globe?.feed || []).slice(0, layout === "rotate" ? 9 : layout === "board" ? 5 : 7);
    $("#feed").innerHTML = rows.length ? rows.map((f) => `<li class="${f.isKey ? "key" : ""}">
      ${f.countryId ? `<img src="/api/flag/${encodeURIComponent(String(f.countryId).toLowerCase())}" alt="">` : `<span class="noflag"></span>`}
      <span><span class="pg" style="display:block">${esc(f.page || f.event)}</span><span class="sub" style="display:block">${esc([f.city, f.site].filter(Boolean).join(" · "))}</span></span>
      <span class="ago num">${f.minutesAgo ? `${f.minutesAgo} min` : "now"}</span></li>`).join("")
      : `<li class="empty">Quiet for now</li>`;
  }
  function renderSpike() {
    const s = (data.spikes || [])[0], el = $(".scene[data-scene=spike]");
    el.hidden = !s;
    if (!s) return;
    const x = s.ratio ? `${s.ratio.toFixed(1)}x` : "";
    const refs = (s.topReferrals || []).slice(0, 3).map((r) => `<li>${esc(r.classifiedName || r.rawSource)}<b class="num">${fmt(r.users)}</b></li>`).join("");
    $("#spike").innerHTML = `<div class="spike-row"><p class="spike-big">${esc(s.siteName || s.domain)} <em class="num">${x}</em></p>
      <p class="spike-sub num">${fmt(s.activeUsers)} live, usually ${fmt(Math.round(s.baselineUsers))}${s.topPage ? ` · top page ${esc(s.topPage)}` : ""}</p></div>
      ${refs ? `<ul class="refs">${refs}</ul>` : ""}`;
  }
  function render() {
    const total = data.globe?.totalActiveUsers ?? (data.sites || []).reduce((a, s) => a + s.activeUsers, 0);
    document.querySelectorAll("[data-total]").forEach((el) => (el.textContent = fmt(total)));
    renderSites(); renderCountries(); renderFeed(); renderSpike();
    const r = data.globe?.refresh;
    if (r?.perHour) {
      const used = Math.min(1, r.usedThisHour / r.perHour);
      $("#quota i").style.transform = `scaleX(${used})`;
      $("#quota").classList.toggle("low", used > 0.75 || !!r.throttled);
      $("#quotaTxt").textContent = `Quota ${Math.round(used * 100)}% · every ${r.autoSec}s`;
    }
    buildSteps();
  }

  /* ── scenes ── */
  const scenes = () => [...document.querySelectorAll(".scene")].filter((s) => !s.hidden && (layout === "rotate" || s.dataset.scene !== "globe"));
  function buildSteps() {
    if (layout === "board") return;
    const list = scenes(), box = $("#steps");
    if (box.childElementCount !== list.length) { box.innerHTML = list.map(() => "<i></i>").join(""); show(idx, true); }
  }
  function show(i, keepTimer) {
    const list = scenes();
    if (!list.length) return;
    idx = (i + list.length) % list.length;
    list.forEach((s, j) => s.classList.toggle("on", j === idx));
    const sec = SCENE_SEC[list[idx].dataset.scene] || 15;
    const steps = [...$("#steps").children];
    steps.forEach((el, j) => { el.classList.remove("on"); if (j === idx) { void el.offsetWidth; el.style.setProperty("--dur", sec + "s"); el.classList.add("on"); } });
    if (keepTimer && timer) return;
    clearTimeout(timer);
    if (!paused) timer = setTimeout(() => show(idx + 1), sec * 1000);
  }
  function setPaused(p) {
    paused = p;
    $("#steps").classList.toggle("paused", p);
    if (p) clearTimeout(timer); else show(idx);
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
  setInterval(() => { $("#tv").style.translate = `${Math.round(Math.random() * 6 - 3)}px ${Math.round(Math.random() * 6 - 3)}px`; }, 180000);
  addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); setPaused(!paused); }
    else if (e.key === "ArrowRight") show(idx + 1);
    else if (e.key === "ArrowLeft") show(idx - 1);
    else if (e.key === "f" || e.key === "F") document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - fetchedAt > 60000) poll(); });

  if (layout !== "board") $("#globeFrame").src = "/globe?tv=1";
  wake(); tick(); setInterval(tick, 1000); buildSteps(); show(0); poll();
})();
