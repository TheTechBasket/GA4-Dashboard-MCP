// Site favicons for the globe: pick candidates from the homepage HTML (pure),
// then download the first real image and keep it in .data/favicons/ for 7 days.
const fs = require("fs/promises");
const path = require("path");

const DIR = path.join(__dirname, "..", ".data", "favicons");
const TTL_MS = 7 * 24 * 3600 * 1000;
const MISS_TTL_MS = 24 * 3600 * 1000;
const HTML_CAP = 512 * 1024;
const ICON_CAP = 200 * 1024;
const TIMEOUT_MS = 5000;
const EXT = { "image/png": "png", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

function attrs(tag) {
    const out = {};
    for (const m of tag.matchAll(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5];
    return out;
}

function maxSize(sizes) {
    if (!sizes) return 0;
    if (/any/i.test(sizes)) return Infinity;
    return Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])));
}

function ldLogos(html) {
    const logos = [];
    const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        const types = [].concat(n["@type"] || []);
        if (n.logo && types.some((t) => t === "Organization" || t === "WebSite")) {
            const logo = typeof n.logo === "string" ? n.logo : n.logo.url || n.logo.contentUrl;
            if (typeof logo === "string") logos.push(logo);
        }
        Object.values(n).forEach(walk);
    };
    for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try { walk(JSON.parse(m[1])); } catch { /* bad JSON-LD: skip */ }
    }
    return logos;
}

/**
 * Ordered icon candidates: JSON-LD logo, largest apple-touch-icon, rel=icon
 * (SVG first, then largest), /favicon.ico, Google s2. Each is { url, size }.
 */
function pickIconCandidates(html, baseUrl) {
    const base = new URL(baseUrl);
    const abs = (u) => { try { return new URL(u.trim(), base).href; } catch { return null; } };
    const links = [...String(html || "").matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).filter((a) => a.href && a.rel);
    const rels = (a) => a.rel.toLowerCase().split(/\s+/);
    const apple = links.filter((a) => rels(a).some((r) => r.startsWith("apple-touch-icon")))
        .sort((a, b) => maxSize(b.sizes) - maxSize(a.sizes));
    const isSvg = (a) => /svg/i.test(a.type || "") || /\.svg(\?|$)/i.test(a.href);
    const icons = links.filter((a) => rels(a).includes("icon"))
        .sort((a, b) => isSvg(b) - isSvg(a) || maxSize(b.sizes) - maxSize(a.sizes));
    const list = [
        ...ldLogos(String(html || "")).map((u) => ({ url: abs(u), size: 0 })),
        ...apple.map((a) => ({ url: abs(a.href), size: maxSize(a.sizes) || 180 })),
        ...icons.map((a) => ({ url: abs(a.href), size: isSvg(a) ? Infinity : maxSize(a.sizes) })),
        { url: abs("/favicon.ico"), size: 0 },
        { url: `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=64`, size: 64 },
    ];
    const seen = new Set();
    return list.filter((c) => c.url && /^https?:/.test(c.url) && !seen.has(c.url) && seen.add(c.url));
}

// Pixel width from PNG/ICO headers; 0 when unknown (SVG, JPEG, ...).
function imageWidth(buf) {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return buf.readUInt32BE(16);
    if (buf.length > 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
        let w = 0;
        for (let i = 0; i < buf.readUInt16LE(4) && 6 + i * 16 < buf.length; i++) w = Math.max(w, buf[6 + i * 16] || 256);
        return w;
    }
    return 0;
}

// ponytail: blocks obvious internal hosts only, no DNS resolution check.
function isPublicUrl(u) {
    const h = new URL(u).hostname;
    return !/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(h) && !h.endsWith(".local");
}

async function fetchCapped(url, cap) {
    if (!isPublicUrl(url)) throw new Error("blocked host");
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (GA4 Dashboard favicon fetch)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
        size += chunk.length;
        if (size > cap) { res.body.cancel?.().catch(() => {}); return { res, buf: null, tooBig: true }; }
        chunks.push(chunk);
    }
    return { res, buf: Buffer.concat(chunks) };
}

async function download(candidate) {
    const { res, buf } = await fetchCapped(candidate.url, ICON_CAP);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!buf || !type.startsWith("image/") || !buf.length) return null;
    const w = imageWidth(buf) || (Number.isFinite(candidate.size) ? candidate.size : 0);
    if (w && w < 32) return null;
    return { buf, ext: EXT[type] || type.slice(6).replace(/[^a-z0-9]/g, "") || "img" };
}

async function cachedFile(id) {
    const names = await fs.readdir(DIR).catch(() => []);
    const name = names.find((n) => n.startsWith(`${id}.`));
    if (!name) return null;
    const file = path.join(DIR, name);
    const { mtimeMs } = await fs.stat(file);
    return { file, fresh: Date.now() - mtimeMs < TTL_MS };
}

const inflight = new Map();
const misses = new Map();

/** Path to the stored favicon for a property, fetching it when missing or stale. */
async function getFavicon(propertyId, siteUrl) {
    const hit = await cachedFile(propertyId);
    if (hit?.fresh || !siteUrl) return hit?.file ?? null;
    if (Date.now() - (misses.get(propertyId) || 0) < MISS_TTL_MS) return hit?.file ?? null;
    if (!inflight.has(propertyId)) {
        inflight.set(propertyId, (async () => {
            let html = "";
            try { html = (await fetchCapped(siteUrl, HTML_CAP)).buf?.toString("utf8") || ""; } catch { /* still try /favicon.ico and s2 */ }
            for (const c of pickIconCandidates(html, siteUrl)) {
                const got = await download(c).catch(() => null);
                if (!got) continue;
                await fs.mkdir(DIR, { recursive: true });
                if (hit) await fs.rm(hit.file, { force: true });
                const file = path.join(DIR, `${propertyId}.${got.ext}`);
                await fs.writeFile(file, got.buf);
                return file;
            }
            misses.set(propertyId, Date.now());
            return hit?.file ?? null;
        })().finally(() => inflight.delete(propertyId)));
    }
    return inflight.get(propertyId);
}

module.exports = { pickIconCandidates, imageWidth, getFavicon };
