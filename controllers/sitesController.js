/* GET /sites: all-properties report from the daily snapshot files (no GA4 calls).
   data/snapshots/latest.json: scripts/snapshot-sessions.js (pnpm snapshot:sessions).
   data/snapshots/adsense-latest.json: optional, private writer outside the repo (README). */
const fs = require("fs/promises");
const path = require("path");
const demo = require("./demoData");
const { matchHost } = require("../public/js/siteStatus");

const SNAP_DIR = path.join(__dirname, "..", "data", "snapshots");

async function readJson(file) {
    try {
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return null;
    }
}

function hostOf(url) {
    try {
        return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/** Snapshot plus AdSense days attached per property (matched by web stream host). */
async function loadSitesSnapshot() {
    // Demo mode never shows the real snapshot (screenshots of a public demo).
    if (demo.enabled()) return { snapshot: null, adsense: null };
    const [snap, ads] = await Promise.all([
        readJson(path.join(SNAP_DIR, "latest.json")),
        readJson(path.join(SNAP_DIR, "adsense-latest.json")),
    ]);
    if (!snap || !Array.isArray(snap.properties) || !snap.properties.length) return { snapshot: null, adsense: null };

    const adDomains = ads && ads.domains && typeof ads.domains === "object" ? ads.domains : null;
    let props = [];
    if (adDomains) {
        const { ensureProperties } = require("./apiController");
        props = (await ensureProperties().catch(() => ({ properties: [] }))).properties || [];
    }
    const keys = adDomains ? Object.keys(adDomains) : [];
    let matched = 0;
    const properties = snap.properties.map((p) => {
        const out = { id: String(p.id), name: p.name, daily: p.daily || {}, error: p.error || undefined };
        if (!adDomains) return out;
        const prop = props.find((x) => String(x.id) === String(p.id));
        const key = matchHost(hostOf(prop?.url || prop?.domain || ""), keys);
        if (key) {
            matched++;
            out.ads = adDomains[key].daily || {};
            out.adsHost = key;
        }
        return out;
    });
    return {
        snapshot: { generatedAt: snap.generatedAt, properties },
        adsense: adDomains ? { generatedAt: ads.generatedAt, currency: ads.currency || "USD", matched } : null,
    };
}

exports.loadSitesSnapshot = loadSitesSnapshot;

exports.sitesView = async (req, res) => {
    try {
        const data = await loadSitesSnapshot();
        res.set("Cache-Control", "no-store").render("sites", {
            hasSnapshot: !!data.snapshot,
            sitesData: data,
            head: { title: "GA4 Dashboard · Sites", description: "Every GA4 property, last 14 days", image: "", url: "" },
        });
    } catch (err) {
        console.error("[sites] View error:", err.message);
        res.status(500).send("Sites page failed");
    }
};
