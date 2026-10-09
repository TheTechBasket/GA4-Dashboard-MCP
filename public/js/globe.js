/* Live globe (/globe): two map engines behind one interface, plus a shared summary panel, event feed,
   city card and avatar marker layer that only use engine.project(), engine.center() and engine.flyTo().

   Border data: Natural Earth 10m admin 0 countries, India point of view only
   (ne_10m_admin_0_countries_ind from naciscdn.org). Never swap in default Natural Earth or tile borders.
     pnpm dlx mapshaper@0.6.102 ne_10m_admin_0_countries_ind.shp -filter-fields ISO_A2 -rename-layers ind -simplify 3% keep-shapes -o format=topojson quantization=1e4 public/data/world-ind.json
     pnpm dlx mapshaper@0.6.102 ne_10m_admin_0_countries_ind.shp -innerlines -simplify 15% keep-shapes -o format=geojson precision=0.0001 public/data/borders-ind.json

   ponytail: no own vector tiles, no Mapbox token. Revisit only if OpenFreeMap goes down or gets slow. */
(() => {
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const stage = $("#gstage"), host = $("#gmap"), marks = $("#gmarks"), card = $("#gcard");
const feedBox = $("#gfeed"), feedList = $("#gfeedList"), feedHead = $("#gfeedH");
if (!stage) return;

const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = () => matchMedia("(max-width: 860px)").matches;
const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
const isDark = () => root.dataset.theme === "dark";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString();

const ICON = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  leaf: '<path d="M3 20 9 9l4 6 3-4 5 9z"/><circle cx="17" cy="5" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chev: '<path d="m6 15 6-6 6 6"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
document.querySelectorAll("[data-icon]").forEach((b) => { b.innerHTML = svg(b.dataset.icon); });

const state = {
  engine: load("globe.engine") === "canvas" ? "canvas" : "ml",
  style: load("globe.style") === "outdoors" ? "outdoors" : "minimal",
  flat: load("globe.proj") === "2d",
  refresh: ["auto", "30", "60", "120", "300"].includes(load("globe.refresh")) ? load("globe.refresh") : "auto",
  feed: true, filter: null, sel: null, list: null,
  panel: narrow() ? "min" : load("globe.panel") === "min" ? "min" : "open",
  avatar: load("globe.avatar") === "sites" ? "sites" : "people",
  data: null, cities: [], feedKeys: new Set(), newKeys: new Set(),
};
root.dataset.map = state.style;

/* ── Avatars: DiceBear Notionists, seeded by city + device; initials until (or unless) it loads ── */
let avatarUri = null;
import("https://cdn.jsdelivr.net/npm/@dicebear/core@9.2.2/+esm").then(async (core) => {
  const style = await import("https://cdn.jsdelivr.net/npm/@dicebear/notionists@9.2.2/+esm");
  const cache = {};
  avatarUri = (seed) => cache[seed] || (cache[seed] = core.createAvatar(style, { seed, backgroundColor: ["eef2ff", "e0f2fe", "fef3c7", "ede9fe"] }).toDataUri());
  renderMarks(); renderFeed(); if (state.sel != null) renderCard(); else if (state.list) renderList();
}).catch(() => { /* initials stay */ });
const initials = (city) => esc(String(city || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "?");
const avHtml = (city, device) => avatarUri ? `<img alt="" src="${avatarUri(city + (device || ""))}">` : `<span data-privacy>${initials(city)}</span>`;

/* ── Site faces: favicon from /api/favicon/:id, letter tile (letterTile.js) when there is none ── */
const noFav = new Set();
const siteName = (s) => s.name || s.site || "";
function tileHtml(s) {
  const t = letterTile(siteName(s), Number(s.id) || 0);
  return `<span class="fav tile" style="background:${t.color}" data-privacy aria-hidden="true">${esc(t.letter)}</span>`;
}
const favHtml = (s) => !s.id || noFav.has(String(s.id)) ? tileHtml(s)
  : `<img class="fav" alt="" src="/api/favicon/${encodeURIComponent(s.id)}" data-id="${esc(s.id)}" data-n="${esc(siteName(s))}" data-privacy>`;
/* Broken favicon becomes a letter tile, broken flag is dropped. Capture phase: error does not bubble. */
document.addEventListener("error", (e) => {
  const im = e.target;
  if (im.classList?.contains("flag")) im.remove();
  else if (im.classList?.contains("fav")) { noFav.add(im.dataset.id); im.outerHTML = tileHtml({ id: im.dataset.id, name: im.dataset.n }); }
}, true);
/* Marker face: a DiceBear person, or in Sites mode the city's top site icon */
const faceHtml = (c) => state.avatar === "sites" && c.sites?.[0] ? favHtml(c.sites[0]) : avHtml(c.city, c.device);

/* ── Shared marker layer ──
   Markers are keyed DOM nodes (one per group of city keys); per frame only their `translate` changes.
   Groups are recomputed on data/zoom change or at most every 500 ms while spinning, with hysteresis
   (merge at GROUP_PX, split at SPLIT_PX) so they do not flip at the edge. */
const cityKey = (c) => `${c.city}||${c.countryId}`;
const markSize = (n) => (n >= 20 ? 58 : n >= 8 ? 48 : 40);
const cardOpen = () => state.sel != null || !!state.list;
const GROUP_PX = 56, SPLIT_PX = 64, RECLUSTER_MS = 500, FACE_STEP = 11;
const markEls = new Map();
let groups = [], keyIdx = new Map(), clusterAt = 0, clusterZoom = "", forceCluster = true;
function renderMarks() { forceCluster = true; placeMarks(); }
/* hover title carries the count (no badge); set on hover so privacy blur is respected */
marks.addEventListener("pointerover", (e) => { const m = e.target.closest(".mk"); if (m) m.title = document.body.classList.contains("privacy-blur") ? "" : m._label || ""; });
function syncMark(el, keys) {
  const ids = keys.map((k) => keyIdx.get(k)).filter((i) => i != null);
  const first = state.cities[ids[0]];
  if (!first) return;
  const count = ids.reduce((n, i) => n + state.cities[i].count, 0);
  const sel = ids.includes(state.sel) || (state.list && state.list[0] === keys[0]);
  const label = ids.length === 1 ? `${first.city}, ${fmt(count)} active users` : `${ids.length} cities, ${fmt(count)} users`;
  el.className = `mk${ids.length > 1 ? " grp" : ""}${sel ? " sel" : ""}`;
  el.dataset.m = ids.join(" ");
  el.setAttribute("aria-label", label);
  el._label = label;
  el.style.setProperty("--s", `${markSize(count)}px`);
  el.style.setProperty("--n", Math.min(3, ids.length) - 1);
  el.style.zIndex = count;
  const inner = ids.length === 1 ? faceHtml(first)
    : ids.slice(0, 3).map((i, j) => `<span class="f" style="--o:${j * FACE_STEP}px;z-index:${3 - j}">${faceHtml(state.cities[i])}</span>`).join("");
  if (el._inner !== inner) { el._inner = inner; el.innerHTML = inner; }
}
function placeMarks() {
  if (!engine || !engine.ready) return;
  const center = state.flat ? null : engine.center();
  const pts = [], vis = new Map();
  state.cities.forEach((c, i) => {
    const p = engine.project(c.lng, c.lat);
    if (p && (state.flat || !center || d3.geoDistance([c.lng, c.lat], center) < Math.PI / 2 - engine.horizonPad)) {
      const pt = { x: p[0], y: p[1], count: c.count, i: cityKey(c) };
      pts.push(pt); vis.set(pt.i, pt);
    }
  });
  const now = performance.now(), zoom = `${state.flat}:${Number(engine.zoom?.() ?? 0).toFixed(2)}`;
  const recluster = forceCluster || zoom !== clusterZoom || now - clusterAt > RECLUSTER_MS;
  if (recluster) {
    if (forceCluster) keyIdx = new Map(state.cities.map((c, i) => [cityKey(c), i]));
    groups = clusterMarks(pts, GROUP_PX, { splitPx: SPLIT_PX, prev: groups.filter((g) => g.length > 1) })
      .map((g) => g.items.map((p) => p.i));
    forceCluster = false; clusterAt = now; clusterZoom = zoom;
  }
  const seen = new Set();
  for (const keys of groups) {
    const lead = keys.map((k) => vis.get(k)).find(Boolean);
    if (!lead) continue;
    const key = keys[0]; /* keyed by leader city: members joining or leaving reuse the node */
    let el = markEls.get(key);
    if (!el) { el = document.createElement("button"); el.type = "button"; markEls.set(key, el); marks.append(el); }
    if (recluster || el._keys !== keys) { el._keys = keys; syncMark(el, keys); }
    el.style.translate = `${lead.x}px ${lead.y}px`;
    seen.add(key);
  }
  for (const [k, el] of markEls) if (!seen.has(k)) { el.remove(); markEls.delete(k); }
  if (cardOpen() && !narrow() && !card.hidden) positionCard();
}

/* ── Canvas engine (d3 orthographic / equirectangular, no tiles) ── */
let world = null;
async function loadWorld() {
  if (world) return world;
  const t = await (await fetch("/data/world-ind.json")).json();
  world = { land: topojson.feature(t, t.objects.ind), borders: topojson.mesh(t, t.objects.ind, (a, b) => a !== b) };
  return world;
}
function canvasEngine() {
  let canvas, ctx, W = 0, H = 0, proj, k = 1, drag = false, flying = false, dead = false;
  const rot = [-78, -14];
  const graticule = d3.geoGraticule10();
  const baseScale = () => Math.min(W, H) * 0.46;
  const onWheel = (e) => { if (state.flat) return; e.preventDefault(); k = Math.min(6, Math.max(1, k * Math.exp(-e.deltaY * 0.0015))); proj.scale(baseScale() * k); api.draw(); };
  const api = {
    name: "canvas", horizonPad: 0.05, ready: false,
    zoom: () => k,
    async init() {
      await loadWorld();
      if (dead) throw new Error("cancelled");
      canvas = document.createElement("canvas");
      host.append(canvas);
      ctx = canvas.getContext("2d");
      d3.select(canvas).call(d3.drag()
        .on("start", () => { drag = true; canvas.style.cursor = "grabbing"; })
        .on("drag", (e) => { if (state.flat) return; rot[0] += e.dx * 0.3; rot[1] = Math.max(-60, Math.min(60, rot[1] - e.dy * 0.3)); proj.rotate(rot); api.draw(); })
        .on("end", () => { drag = false; canvas.style.cursor = "grab"; }));
      canvas.addEventListener("wheel", onWheel, { passive: false });
      api.ready = true;
      api.resize();
    },
    resize() {
      if (!canvas) return;
      const box = host.getBoundingClientRect(); W = box.width; H = box.height;
      const dpr = devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wide = W > 860;
      proj = state.flat
        ? d3.geoEquirectangular().fitExtent([[wide ? 364 : 8, 8], [W - 8, H - 8]], { type: "Sphere" })
        : d3.geoOrthographic().clipAngle(90).rotate(rot).scale(baseScale() * k).translate([wide ? W * 0.6 : W / 2, H / 2]);
      api.draw();
    },
    draw() {
      if (!proj || !world) return;
      const path = d3.geoPath(proj, ctx), globe = !state.flat, [cx, cy] = proj.translate(), r = proj.scale();
      ctx.clearRect(0, 0, W, H);
      if (globe) { ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.shadowColor = css("--halo"); ctx.shadowBlur = 60; ctx.fillStyle = css("--sea"); ctx.fill(); ctx.restore(); }
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = css("--sea"); ctx.fill();
      ctx.beginPath(); path(graticule); ctx.strokeStyle = css("--grat"); ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); path(world.land); ctx.fillStyle = css("--land"); ctx.fill();
      ctx.beginPath(); path(world.borders); ctx.strokeStyle = css("--landline"); ctx.lineWidth = 0.6; ctx.stroke();
      if (globe) { /* sphere shading: light from top left, darker limb */
        const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
        g.addColorStop(0, "rgba(255,255,255,.18)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.20)");
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();
      }
      placeMarks();
    },
    project: (lng, lat) => proj ? proj([lng, lat]) : null,
    center: () => [-rot[0], -rot[1]],
    zoomBy(f) {
      if (state.flat || !proj) return; // ponytail: flat canvas map has no zoom, same as its wheel
      k = Math.min(6, Math.max(1, k * f)); proj.scale(baseScale() * k); api.draw();
    },
    zoomIn(c, done) {
      if (state.flat || k >= 6) return false;
      api.flyTo(c, done, Math.min(6, k * 4));
      return true;
    },
    flyTo(c, done, kTo) {
      if (state.flat) return done();
      const r0 = rot.slice(), k0 = k, k1 = kTo || Math.max(k0, 2.4);
      const r1 = [r0[0] + ((((-c.lng - r0[0]) % 360) + 540) % 360 - 180), Math.max(-60, Math.min(60, -c.lat))];
      const ir = d3.interpolate(r0, r1), t0 = performance.now(), dur = reduce() ? 0 : 800;
      flying = true;
      const f = (t) => {
        if (dead) return;
        const u = dur ? Math.min(1, (t - t0) / dur) : 1, e = d3.easeCubicInOut(u);
        const rr = ir(e); rot[0] = rr[0]; rot[1] = rr[1]; k = k0 + (k1 - k0) * e;
        proj.rotate(rot).scale(baseScale() * k); api.draw();
        if (u < 1) requestAnimationFrame(f); else { flying = false; done(); }
      };
      requestAnimationFrame(f);
    },
    setStyle() { api.draw(); },
    setProjection() { k = 1; api.resize(); },
    spin(dt) { if (drag || flying || cardOpen() || !proj) return; rot[0] += dt * 0.004; /* d3 centers on -rot[0]: center longitude goes down, west to east */ proj.rotate(rot); api.draw(); },
    destroy() { dead = true; api.ready = false; canvas?.removeEventListener("wheel", onWheel); canvas?.remove(); },
  };
  return api;
}

/* ── MapLibre engine (OpenFreeMap tiles, tile borders removed, India POV borders on top) ── */
function loadScript(src) {
  if (window.maplibregl) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("script failed to load")); document.head.append(s); });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.append(l);
}
function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
function mlEngine() {
  let map = null, el = null, borders = null, dead = false;
  const styleUrl = () => `https://tiles.openfreemap.org/styles/${state.style === "outdoors" ? "liberty" : isDark() ? "dark" : "positron"}`;
  /* Clutter: only water, land, relief, place labels and our borders survive */
  const DROP = new Set(["boundary", "transportation", "transportation_name", "poi", "building", "park", "aeroway", "aerodrome_label", "landuse", "mountain_peak"]);
  function sky() {
    try { map.setSky({ "sky-color": css("--space"), "horizon-color": "#4a9fd8", "fog-color": "#4a9fd8", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 1, 7, 0] }); } catch { /* no sky support */ }
  }
  function onStyle() {
    try { map.setProjection({ type: state.flat ? "mercator" : "globe" }); } catch { /* older style spec */ }
    /* India rule: drop every tile boundary and state line, then draw Natural Earth India POV borders on top */
    for (const l of map.getStyle().layers) {
      const sl = l["source-layer"];
      if (DROP.has(sl) || (sl === "landcover" && !/ice|glacier/.test(l.id)) || (l.type !== "symbol" && /state/.test(l.id))) map.removeLayer(l.id);
    }
    const dark = isDark(), vivid = state.style === "outdoors";
    for (const l of map.getStyle().layers) {
      if (vivid && l.type === "background") map.setPaintProperty(l.id, "background-color", dark ? "#24502f" : "#9cd08a");
      if (vivid && l.type === "fill" && l["source-layer"] === "water") map.setPaintProperty(l.id, "fill-color", dark ? "#0b3a5e" : "#4a9fd8");
      if (vivid && l.type === "raster") map.setPaintProperty(l.id, "raster-opacity", dark ? 0.35 : 0.5);
      if (l.type !== "symbol" || !l.layout?.["text-field"]) continue;
      map.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]]);
      const max = l.maxzoom ?? 24;
      if (/country/.test(l.id)) { map.setLayoutProperty(l.id, "text-size", 11); map.setLayoutProperty(l.id, "symbol-spacing", 1000); map.setLayoutProperty(l.id, "text-optional", true); }
      else if (/state|water|sea|ocean|marine|region/.test(l.id)) map.setLayerZoomRange(l.id, Math.max(5, l.minzoom || 0), max);
      else map.setLayerZoomRange(l.id, Math.max(4, l.minzoom || 0), max);
    }
    if (!map.getSource("ind")) map.addSource("ind", { type: "geojson", data: borders });
    if (!map.getLayer("ind-borders")) map.addLayer({ id: "ind-borders", type: "line", source: "ind", paint: {
      "line-color": css("--indline"),
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 4, 1.2],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 4, 0.8],
    } });
    sky();
  }
  const api = {
    name: "ml", horizonPad: 0.2, ready: false,
    zoom: () => map?.getZoom() ?? 0,
    async init() {
      if (!webglOk()) throw new Error("WebGL unavailable");
      loadCss("/vendor/maplibre/maplibre-gl.css");
      const [, b] = await Promise.all([loadScript("/vendor/maplibre/maplibre-gl.js"), fetch("/data/borders-ind.json").then((r) => r.json())]);
      if (dead) throw new Error("cancelled");
      borders = b;
      el = document.createElement("div"); host.append(el);
      map = new maplibregl.Map({ container: el, style: styleUrl(), center: [78, 16], zoom: narrow() ? 1.4 : 2.3, attributionControl: false, renderWorldCopies: false });
      map.on("style.load", onStyle);
      map.on("move", placeMarks);
      map.on("error", () => { /* tile hiccups: the 8 s load timeout handles a dead style */ });
      await new Promise((ok) => map.once("load", ok));
      if (dead) throw new Error("cancelled");
      $("#gattr").hidden = false;
      api.ready = true;
      placeMarks();
    },
    resize() { map?.resize(); placeMarks(); },
    project(lng, lat) { const q = map.project([lng, lat]); return [q.x, q.y]; },
    center() { const c = map.getCenter(); return [c.lng, c.lat]; },
    flyTo(c, done) {
      map.flyTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 4), duration: reduce() ? 0 : 1200, essential: true });
      map.once("moveend", done);
    },
    zoomBy(f) { map.easeTo({ zoom: map.getZoom() + Math.log2(f), duration: reduce() ? 0 : 200 }); },
    zoomIn(c) {
      if (map.getZoom() >= 8) return false;
      map.flyTo({ center: [c.lng, c.lat], zoom: Math.min(8, map.getZoom() + 2), duration: reduce() ? 0 : 900, essential: true });
      return true;
    },
    setStyle() { map?.setStyle(styleUrl(), { diff: false }); },
    setProjection() { try { map.setProjection({ type: state.flat ? "mercator" : "globe" }); } catch { /* noop */ } sky(); placeMarks(); },
    spin(dt) {
      if (!map || state.flat || cardOpen() || !map.isStyleLoaded() || map.isMoving() || map.getZoom() >= 3) return;
      /* Earth turns west to east: land moves left to right, so the center longitude goes down */
      const c = map.getCenter(); map.setCenter([c.lng - dt * 0.004, c.lat]);
    },
    destroy() { dead = true; api.ready = false; try { map?.remove(); } catch { /* already gone */ } el?.remove(); $("#gattr").hidden = true; },
  };
  return api;
}

/* ── Engine switching with automatic fallback ── */
let engine = null;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} did not load within ${ms / 1000} s`)), ms))]);
async function startEngine(name) {
  engine?.destroy(); engine = null; host.replaceChildren();
  const e = name === "ml" ? mlEngine() : canvasEngine();
  try {
    await withTimeout(e.init(), 8000, name === "ml" ? "MapLibre" : "Map data");
    engine = e;
    syncTools();
  } catch (err) {
    e.destroy(); host.replaceChildren();
    if (name === "ml") {
      console.warn(`[globe] MapLibre unavailable (${err.message}), using the lightweight map`);
      $("#gLight").checked = true;
      return startEngine("canvas");
    }
    host.innerHTML = '<p class="gerr">The map could not load. Check the connection and reload.</p>';
    return;
  }
  placeMarks();
}

/* ── Summary panel ── */
const PLATFORM = { web: "Web", android: "Android", ios: "iOS" };
function chipRow(title, list) {
  if (!list.length) return "";
  return `<div class="grow"><h3>${title}</h3><div class="chips">${list.join("")}</div></div>`;
}
function renderSummary() {
  const d = state.data || {};
  const sites = (d.properties || []).filter((p) => p.count > 0);
  $("#gTotal").textContent = fmt(d.totalActiveUsers);
  $("#gSub").innerHTML = `active users on <span class="num">${sites.length}</span> ${sites.length === 1 ? "site" : "sites"}, last 30 min.${d.keyEvents ? ` <span class="key num">${fmt(d.keyEvents)} key events</span>` : ""}`;
  $("#gRows").innerHTML =
    chipRow("Sites", sites.slice(0, 4).map((s) => `<span class="chip">${favHtml(s)}<span data-privacy>${esc(s.site)}</span> <span class="v num">${fmt(s.count)}</span></span>`)) +
    chipRow("Countries", (d.countries || []).slice(0, 6).map((c) => `<span class="chip">${/^[A-Z]{2}$/.test(c.id) ? `<span class="k">${esc(c.id)}</span>` : ""}${esc(c.name)} <span class="v num">${fmt(c.count)}</span></span>`)) +
    chipRow("Devices", (d.devices || []).map((x) => `<span class="chip">${esc(x.name)} <span class="v num">${fmt(x.count)}</span></span>`)) +
    chipRow("Platform", (d.platforms || []).map((x) => `<span class="chip">${esc(PLATFORM[x.name] || x.name)} <span class="v num">${fmt(x.count)}</span></span>`));
  renderRefresh();
}

/* ── Event feed ── */
const feedKey = (f) => `${f.city}|${f.countryId}|${f.site}|${f.page}|${f.event}`;
const VIEW_EVENTS = new Set(["page_view", "screen_view"]);
function feedLi(f, isNew) {
  const city = state.cities.find((c) => c.city === f.city && c.countryId === f.countryId);
  const where = f.city === "(not set)" ? "an unknown city" : `<b data-privacy>${esc(f.city)}</b>`;
  const page = `<em data-privacy>${esc(f.page)}</em>`;
  const times = f.count > 1 ? ` <span class="num">${f.count}</span> times` : "";
  const ev = f.isKey ? `<span class="key">${esc(f.event)}</span>` : esc(f.event);
  const what = VIEW_EVENTS.has(f.event)
    ? (f.count > 1 ? `Visitors in ${where} viewed ${page}${times}` : `Someone in ${where} viewed ${page}`)
    : (f.count > 1 ? `${ev} in ${where} on ${page}${times}` : `Someone in ${where}: ${ev} on ${page}`);
  const key = f.isKey && VIEW_EVENTS.has(f.event) ? ' <span class="key">with key event</span>' : "";
  return `<li class="${isNew ? "new" : ""}"><span class="av">${avHtml(f.city, city?.device)}</span><span>${what}${key} <span class="t" data-privacy>${esc(f.site)}</span></span><span class="t num">${f.minutesAgo ? `${f.minutesAgo} min` : "now"}</span></li>`;
}
function renderFeed() {
  const rows = (state.data?.feed || []).filter((f) => !state.filter || f.city === state.filter);
  feedHead.innerHTML = `<b>Live events</b><span>${state.filter ? `<span data-privacy>${esc(state.filter)}</span> only, <button type="button" data-t="clear">show all</button>` : "Press M to hide"}</span>`;
  feedList.innerHTML = rows.map((f) => feedLi(f, state.newKeys.has(feedKey(f)))).join("")
    || `<li class="empty">${state.data ? "No events in the last 30 min." : "Loading events"}</li>`;
}

/* ── City card: renderCityCard() and the ".gcity" CSS block in globe.hbs are the whole design, swap them together ── */
function renderCityCard(c) {
  const dv = c.devices || {};
  const sites = c.sites || [];
  const flag = /^[A-Z]{2}$/.test(c.countryId || "") ? `<img class="flag" alt="" src="/vendor/flags/${c.countryId.toLowerCase()}.svg">` : "";
  const more = sites.length > 3 ? `<span class="more num">+${sites.length - 3}</span>` : "";
  const foot = [["Mobile", dv.mobile], ["Desktop", dv.desktop], ["Tablet", dv.tablet]].filter(([, n]) => n > 0).map(([l, n]) => `${l} <span class="num">${fmt(n)}</span>`);
  if (c.lastSeen != null) foot.push(`Last seen ${c.lastSeen ? `<span class="num">${c.lastSeen}</span> min ago` : "now"}`);
  return `<div class="gcity">
  <div class="ch">${flag}<div class="ct"><b data-privacy>${esc(c.city)}</b><span data-privacy>${esc(c.country)}</span></div><div class="stack" aria-label="${sites.length} ${sites.length === 1 ? "site" : "sites"}">${sites.slice(0, 3).map(favHtml).join("")}${more}</div></div>
  <div class="cb">
    <div class="kv"><div><small>Active</small><b class="num">${fmt(c.count)}</b></div><div><small>Views</small><b class="num">${fmt(c.views)}</b></div><div><small>Key events</small><b class="num">${fmt(c.keyEvents)}</b></div></div>
    ${c.topPage ? `<div class="page" data-privacy title="${esc(c.topPage)}">${esc(c.topPage)}</div>` : ""}
    ${sites.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Site</th><th>Users</th><th>Views</th></tr></thead><tbody>${sites.map((x) => `<tr><td><span class="site">${favHtml(x)}<span data-privacy title="${esc(x.topPage || "")}">${esc(x.name)}</span></span></td><td class="num">${fmt(x.users)}</td><td class="num">${fmt(x.views)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${foot.length ? `<div class="foot">${foot.join(" · ")}</div>` : ""}
  </div>
  </div>`;
}
function renderCard() {
  const c = state.cities[state.sel];
  if (!c) return closeCard();
  card.innerHTML = `<button type="button" class="ib x" data-t="close" aria-label="Close">${svg("x")}</button>${renderCityCard(c)}`;
  card.classList.add("city");
  card.hidden = false;
  positionCard();
}
function renderList() {
  const ids = state.list.map((k) => state.cities.findIndex((c) => cityKey(c) === k)).filter((i) => i >= 0);
  if (!ids.length) return closeCard();
  const users = ids.reduce((n, i) => n + state.cities[i].count, 0);
  card.innerHTML = `<button type="button" class="ib x" data-t="close" aria-label="Close">${svg("x")}</button>
  <div class="gcard-t"><div><b><span class="num">${ids.length}</span> cities, <span class="num">${fmt(users)}</span> users</b><span>Too close together to split on the map</span></div></div>
  <ul class="glist">${ids.map((i) => { const c = state.cities[i]; return `<li><button type="button" data-i="${i}"><span class="av">${avHtml(c.city, c.device)}</span><span data-privacy>${esc(c.city)}</span><span class="num">${fmt(c.count)}</span></button></li>`; }).join("")}</ul>`;
  card.classList.remove("city");
  card.hidden = false;
  positionCard();
}
function openGroup(ids) {
  const lead = state.cities[ids[0]];
  if (!lead || !engine) return;
  closeCard();
  if (engine.zoomIn(lead, () => {})) return;
  state.list = ids.map((i) => cityKey(state.cities[i]));
  renderMarks(); renderList();
}
function positionCard() {
  if (narrow()) { card.style.left = ""; card.style.top = ""; return; }
  const a = state.sel ?? state.cities.findIndex((c) => cityKey(c) === state.list?.[0]);
  const el = a >= 0 ? marks.querySelector(`[data-m~="${a}"]`) : null;
  if (!el) return;
  /* Try right, above, left, below the marker; skip any spot that covers the marker, the feed or the zoom control */
  const S = stage.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, gap = 10;
  const rel = (r) => ({ l: r.left - S.left, t: r.top - S.top, r: r.right - S.left, b: r.bottom - S.top });
  const m = rel(el.getBoundingClientRect()), mx = (m.l + m.r) / 2;
  const blocks = [m, ...[feedBox, $(".gzoom")].filter((b) => b && !b.hidden && b.offsetParent).map((b) => rel(b.getBoundingClientRect()))];
  const fit = ([x, y]) => [Math.max(8, Math.min(x, S.width - w - 8)), Math.max(8, Math.min(y, S.height - h - 8))];
  const spots = [[m.r + gap, m.t - 20], [mx - w / 2, m.t - gap - h], [m.l - gap - w, m.t - 20], [mx - w / 2, m.b + gap]].map(fit);
  const clear = ([x, y]) => !blocks.some((b) => x < b.r && x + w > b.l && y < b.b && y + h > b.t);
  const [x, y] = spots.find(clear) || spots[0];
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}
function openCity(i) {
  const c = state.cities[i];
  if (!c || !engine) return;
  closeCard();
  state.sel = i; state.filter = c.city;
  renderMarks();
  engine.flyTo(c, () => { if (state.sel === i) { renderCard(); renderFeed(); } });
}
function closeCard() {
  const had = state.filter, open = cardOpen();
  state.sel = null; state.list = null; state.filter = null; card.hidden = true;
  if (open) renderMarks();
  if (had) renderFeed();
}

/* ── Data + quota-aware refresh ── */
let nextAt = Date.now(), polling = false, lastError = false;
const interval = () => (state.refresh === "auto" ? (state.data?.refresh?.autoSec || 60) : Number(state.refresh));
function applyData(j) {
  const selKey = state.sel != null && state.cities[state.sel] ? cityKey(state.cities[state.sel]) : null;
  const first = !state.data;
  state.data = j;
  state.cities = (j.users || []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const keys = new Set((j.feed || []).map(feedKey));
  state.newKeys = first ? new Set() : new Set([...keys].filter((k) => !state.feedKeys.has(k)));
  state.feedKeys = keys;
  const idx = selKey ? state.cities.findIndex((c) => cityKey(c) === selKey) : -1;
  if (selKey && idx < 0) { state.sel = null; state.filter = null; card.hidden = true; } else if (idx >= 0) state.sel = idx;
  renderSummary(); renderMarks(); renderFeed();
  if (state.sel != null) renderCard(); else if (state.list) renderList();
}
async function poll(maxAge) {
  if (polling) return;
  polling = true;
  try {
    const r = await fetch(`/api/globe-users?maxAge=${maxAge}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    lastError = false;
    applyData(j);
  } catch (err) {
    lastError = true;
    console.warn("[globe] refresh failed:", err.message);
    if (!state.data) $("#gSub").textContent = "Live data could not load. Retrying.";
  } finally {
    polling = false;
    nextAt = Date.now() + interval() * 1000;
    renderRefresh();
  }
}
function renderRefresh() {
  const rf = state.data?.refresh;
  const sel = $("#rfSel");
  sel.value = state.refresh;
  sel.options[0].textContent = rf ? `Auto (${rf.autoSec} s)` : "Auto";
  const cap = $("#rfCap");
  if (rf?.throttled) cap.innerHTML = '<span class="warn">GA4 hourly quota is low: data refreshes every 5 min.</span>';
  else if (state.refresh === "auto") cap.innerHTML = rf ? `Set from your GA4 quota: <span class="num">${fmt(rf.usedThisHour)}</span> of <span class="num">${fmt(rf.perHour)}</span> tokens used this hour (busiest site).` : "Set from your GA4 quota once the first refresh lands.";
  else cap.textContent = "Fixed by you. Slows to 5 min if hourly quota runs low.";
  tickCountdown();
}
function tickCountdown() {
  const el = $("#rfNext");
  const s = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
  const at = state.data?.fetchedAt ? Math.round((Date.now() - new Date(state.data.fetchedAt).getTime()) / 1000) : null;
  el.textContent = polling ? "updating" : `${at != null ? `data ${at} s old, ` : ""}${lastError ? "retry" : "next"} in ${s} s`;
}
setInterval(() => {
  if (!polling && !document.hidden && Date.now() >= nextAt) poll(interval());
  tickCountdown();
}, 1000);

/* ── Controls ── */
function syncTools() {
  const proj = stage.querySelector('[data-t="proj"]');
  const projLabel = state.flat ? "Switch to 3D globe" : "Switch to 2D map";
  proj.innerHTML = svg(state.flat ? "globe" : "map"); proj.title = projLabel; proj.setAttribute("aria-label", projLabel);
  proj.setAttribute("aria-pressed", String(state.flat));
  const st = stage.querySelector('[data-t="style"]');
  st.setAttribute("aria-pressed", String(state.style === "outdoors"));
  st.title = state.style === "outdoors" ? "Map style: Outdoors (switch to Minimal)" : "Map style: Minimal (switch to Outdoors)";
  stage.querySelector('[data-t="feed"]').setAttribute("aria-pressed", String(state.feed));
  const pb = stage.querySelector('[data-t="panel"]'), min = state.panel === "min", pl = min ? "Expand panel" : "Collapse panel";
  stage.querySelectorAll(".zb").forEach((b) => { b.disabled = engine?.name === "canvas" && state.flat; });
  $(".gsum").toggleAttribute("data-min", min); pb.setAttribute("aria-expanded", String(!min)); pb.title = pl; pb.setAttribute("aria-label", pl);
  feedBox.hidden = !state.feed;
  stage.dataset.av = state.avatar;
  $("#gNote").textContent = state.avatar === "sites" ? "Icon = top site in a city. Stack = nearby cities, click to zoom." : "Avatar = city. Stack = nearby cities, click to zoom.";
  $("#gLight").checked = state.engine === "canvas" || engine?.name === "canvas";
  /* Dark space backdrop for the vivid looks (MapLibre globe or Outdoors) */
  if ((engine?.name !== "canvas" && !state.flat) || state.style === "outdoors") root.dataset.gspace = "dark"; else delete root.dataset.gspace;
}
const restyle = () => engine?.ready && engine.setStyle();
new MutationObserver(restyle).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

stage.addEventListener("click", (e) => {
  const mk = e.target.closest(".mk");
  if (mk) { const ids = mk.dataset.m.split(" ").map(Number); if (ids.length > 1) openGroup(ids); else openCity(ids[0]); return; }
  const pick = e.target.closest(".gcard [data-i]");
  if (pick) { openCity(Number(pick.dataset.i)); return; }
  const t = e.target.closest("[data-t]")?.dataset.t;
  if (!t) return;
  if (t === "close" || t === "clear") closeCard();
  else if (t === "proj") {
    closeCard(); state.flat = !state.flat; save("globe.proj", state.flat ? "2d" : "3d");
    syncTools(); engine?.ready && engine.setProjection();
  } else if (t === "style") {
    state.style = state.style === "outdoors" ? "minimal" : "outdoors"; root.dataset.map = state.style; save("globe.style", state.style);
    restyle(); syncTools();
  } else if (t === "theme") {
    const nav = document.getElementById("themeToggle");
    if (nav) nav.click(); else root.dataset.theme = isDark() ? "light" : "dark";
  } else if (t === "feed") { state.feed = !state.feed; syncTools(); }
  else if (t === "refresh") poll(0);
  else if (t === "panel") { state.panel = state.panel === "min" ? "open" : "min"; save("globe.panel", state.panel); syncTools(); }
  else if (t === "zin" || t === "zout") engine?.ready && engine.zoomBy(t === "zin" ? 2 : 0.5);
  else if (t === "full") {
    if (document.fullscreenElement) document.exitFullscreen?.(); else stage.requestFullscreen?.().catch(() => {});
  }
});
$("#rfSel").addEventListener("change", (e) => {
  state.refresh = e.target.value; save("globe.refresh", state.refresh);
  nextAt = Date.now() + interval() * 1000; renderRefresh();
});
$("#avSel").value = state.avatar;
$("#avSel").addEventListener("change", (e) => {
  state.avatar = e.target.value === "sites" ? "sites" : "people"; save("globe.avatar", state.avatar);
  syncTools(); renderMarks();
});
$("#gLight").addEventListener("change", (e) => {
  state.engine = e.target.checked ? "canvas" : "ml"; save("globe.engine", state.engine);
  closeCard(); startEngine(state.engine);
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "m" || e.key === "M") { state.feed = !state.feed; syncTools(); }
  if (e.key === "Escape") closeCard();
});
let rz;
const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { engine?.ready && engine.resize(); }, 120); };
addEventListener("resize", onResize);
document.addEventListener("fullscreenchange", onResize);

/* Auto-spin: one rAF loop, each engine decides when it may turn */
let last = performance.now();
function spin(t) {
  const dt = Math.min(64, t - last); last = t;
  /* hold still under the pointer so a marker does not slide away mid-click */
  if (engine?.ready && !reduce() && !document.hidden && !marks.querySelector(".mk:hover")) engine.spin(dt);
  requestAnimationFrame(spin);
}

syncTools();
renderFeed();
startEngine(state.engine).then(() => requestAnimationFrame(spin));
poll(interval());
})();
