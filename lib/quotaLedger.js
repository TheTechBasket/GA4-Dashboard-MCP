/**
 * Shared GA4 quota ledger: the last `propertyQuota` Google returned, per property and quota pool.
 * The dashboard and the MCP server run as separate processes on the same GCP project, so both
 * write here (.data/quota-ledger.json) and both read it before spending tokens.
 * In each QuotaStatus, `consumed` is the cost of that one request, `remaining` is what is left after it.
 */
const fs = require("fs");
const path = require("path");

const FILE = process.env.QUOTA_LEDGER_FILE || path.join(__dirname, "..", ".data", "quota-ledger.json");

// Google's published limits (developers.google.com/analytics/devguides/reporting/data/v1/quotas).
// Core, realtime and funnel are separate pools with the same numbers. 360 properties get x10.
const STANDARD = { day: 200000, hour: 40000, projectHour: 14000 };
const POOLS = ["core", "realtime", "funnel"];

const pct = (name, fallback) => {
	const n = Number(process.env[name]);
	return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : fallback;
};
// Below these shares of the limit a pool is "low": callers that can wait (the MCP) stop spending.
const RESERVE = {
	projectHour: pct("QUOTA_RESERVE_PROJECT_HOUR_PCT", 0.3),
	hour: pct("QUOTA_RESERVE_HOUR_PCT", 0.2),
	day: pct("QUOTA_RESERVE_DAY_PCT", 0.2),
};
const CRITICAL = 0.1;
const HOUR_MS = 3600 * 1000;

function readAll() {
	try {
		return JSON.parse(fs.readFileSync(FILE, "utf8"));
	} catch {
		return {};
	}
}

const left = (q, key) => {
	const n = Number(q?.[key]?.remaining);
	return Number.isFinite(n) ? n : null;
};
const spent = (q, key) => {
	const n = Number(q?.[key]?.consumed);
	return Number.isFinite(n) ? n : null;
};

/** Store one response's propertyQuota. No-op when Google sent none. */
function record(propertyId, pool, propertyQuota, source) {
	if (!propertyQuota || !POOLS.includes(pool)) return;
	const all = readAll(); // ponytail: read-merge-write, last writer wins per key; fine at a few writes a minute
	// Keep only consumed/remaining per quota: protobuf objects also carry `_consumed`-style keys.
	const quota = {};
	for (const [k, v] of Object.entries(propertyQuota)) {
		if (v && typeof v === "object") quota[k] = { consumed: v.consumed, remaining: v.remaining };
	}
	all[`${propertyId}:${pool}`] = { propertyId: String(propertyId), pool, source, at: Date.now(), quota };
	try {
		fs.mkdirSync(path.dirname(FILE), { recursive: true });
		const tmp = `${FILE}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(all));
		fs.renameSync(tmp, FILE);
	} catch {
		// Ledger is advisory: a failed write must never fail the GA4 call that produced it.
	}
}

/** Next midnight America/Los_Angeles, when Google resets daily quotas. */
function nextDailyReset(now = Date.now()) {
	const pt = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
	const offsetMs = now - pt.getTime();
	const midnight = new Date(pt);
	midnight.setHours(24, 0, 0, 0);
	return new Date(midnight.getTime() + offsetMs);
}

/**
 * Compact view of one ledger entry: what the last call cost, what is left, and a status.
 * Hourly numbers older than an hour and daily numbers from before the last Pacific midnight are
 * reported as null (unknown), since Google has refilled them since.
 */
function summarize(entry, now = Date.now()) {
	if (!entry) return { status: "unknown" };
	const q = entry.quota;
	const ageMs = now - entry.at;
	const hourFresh = ageMs < HOUR_MS;
	const dayFresh = nextDailyReset(entry.at).getTime() > now;
	const scale = (left(q, "tokensPerDay") || 0) > STANDARD.day ? 10 : 1; // 360 property
	const out = {
		cost: spent(q, "tokensPerHour"),
		projectHourLeft: hourFresh ? left(q, "tokensPerProjectPerHour") : null,
		hourLeft: hourFresh ? left(q, "tokensPerHour") : null,
		dayLeft: dayFresh ? left(q, "tokensPerDay") : null,
		ageSec: Math.round(ageMs / 1000),
	};
	const ratio = (v, limit) => (v == null ? 1 : v / (limit * scale));
	const r = {
		projectHour: ratio(out.projectHourLeft, STANDARD.projectHour),
		hour: ratio(out.hourLeft, STANDARD.hour),
		day: ratio(out.dayLeft, STANDARD.day),
	};
	if (out.projectHourLeft == null && out.hourLeft == null && out.dayLeft == null) out.status = "unknown";
	else if (Math.min(r.projectHour, r.hour, r.day) < CRITICAL) out.status = "critical";
	else if (r.projectHour < RESERVE.projectHour || r.hour < RESERVE.hour || r.day < RESERVE.day) out.status = "low";
	else out.status = "ok";
	return out;
}

function get(propertyId, pool) {
	return readAll()[`${propertyId}:${pool}`] || null;
}

/** summarize() for one property and pool, read from disk. */
function status(propertyId, pool, now = Date.now()) {
	return summarize(get(propertyId, pool), now);
}

/** Every entry, summarized, for status tools and the console quota line. */
function list(now = Date.now()) {
	return Object.values(readAll()).map((e) => ({ propertyId: e.propertyId, pool: e.pool, source: e.source, ...summarize(e, now) }));
}

module.exports = { record, get, status, list, summarize, nextDailyReset, STANDARD, RESERVE, POOLS, FILE };
