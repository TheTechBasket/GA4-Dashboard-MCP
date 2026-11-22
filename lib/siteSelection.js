/* Which GA4 properties the dashboard shows and fetches. Saved in .data/sites.json:
   { selected: [ids], known: [ids] }. No file = show every property (first run, old installs).
   A property GA4 lists that is not in `known` is new: shown (with a New badge on /setup#sites) until the owner unticks it.
   Fewer properties = fewer realtime and report calls, so less GA4 quota. */
const fs = require("fs");
const path = require("path");

const FILE = process.env.SITES_FILE || path.join(__dirname, "..", ".data", "sites.json");

function read() {
    try {
        const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
        return { selected: (j.selected || []).map(String), known: (j.known || []).map(String) };
    } catch {
        return null;
    }
}

/** Properties to show. No saved choice = all. */
function filter(properties, sel = read()) {
    if (!sel) return properties;
    const on = new Set(sel.selected), known = new Set(sel.known);
    return properties.filter((p) => on.has(String(p.id)) || !known.has(String(p.id)));
}

/** Every property with its state, for the picker. */
function annotate(properties, sel = read()) {
    const on = sel ? new Set(sel.selected) : null, known = new Set(sel?.known || []);
    return properties.map((p) => ({ ...p, selected: on ? on.has(String(p.id)) || !known.has(String(p.id)) : true, isNew: !!sel && !known.has(String(p.id)) }));
}

/** Save the choice. `known` = every property listed now, so later additions show as new. */
function save(selectedIds, allProperties) {
    const all = allProperties.map((p) => String(p.id));
    const valid = new Set(all);
    const data = { selected: [...new Set(selectedIds.map(String))].filter((id) => valid.has(id)), known: all, savedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    return data;
}

module.exports = { read, filter, annotate, save, FILE };
