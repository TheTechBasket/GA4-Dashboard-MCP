const fs = require("fs/promises");
const path = require("path");
const { getCityCoords } = require("./cityCoords");
const {
    getAnalyticsCardConfig,
    getAnalyticsCatalog,
    getDateRange,
} = require("./analyticsRecipes");
const { runSafeHistoricalReport, runSafeRealtimeReport, CREDENTIALS_PATH } = require("./ga4Service");
const { stripSensitiveGlobeUsersPayload } = require("./privacy");
const { cacheGet, cacheSet, cacheCleanup } = require("./reportCache");

const CACHE_DIR = path.join(__dirname, "..", ".cache");
const PROPERTIES_CACHE_PATH = path.join(CACHE_DIR, "properties.json");

/** How long before the properties cache is considered stale (hours) */
const CACHE_TTL_HOURS = 12;

/** Latest property quota snapshot – updated on every realtime batch fetch */
let latestQuota = null;
let analyticsAdminClient = null;
const propertyCurrencyMemCache = new Map();

/** In-memory realtime cache – prevents re-fetching on every page reload */
const REALTIME_MEM_TTL = 2 * 60 * 1000; // 2 minutes
let realtimeMemCache = null;   // { data, quota, fetchDurationMs, cachedAt }
let realtimeMemCachedAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, "");
    } catch {
        return null;
    }
}

function isCacheStale(cache) {
    if (!cache || !cache.lastUpdated) return true;
    const ageMs = Date.now() - new Date(cache.lastUpdated).getTime();
    return ageMs > CACHE_TTL_HOURS * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Cache IO
// ---------------------------------------------------------------------------

/**
 * Reads the cache file.
 * Supports both old format (plain array) and new format ({ properties, lastUpdated }).
 */
async function getCachedProperties() {
    try {
        const raw = await fs.readFile(PROPERTIES_CACHE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            // Migrate old format – treat as stale so it will refresh
            return { properties: parsed, lastUpdated: null };
        }
        return parsed; // { properties: [...], lastUpdated: ISO }
    } catch {
        return null;
    }
}

async function savePropertiesToCache(properties) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
        PROPERTIES_CACHE_PATH,
        JSON.stringify(
            { properties, lastUpdated: new Date().toISOString() },
            null,
            2,
        ),
    );
}

// ---------------------------------------------------------------------------
// GA4 Admin – list properties + domains
// ---------------------------------------------------------------------------

async function getAnalyticsProperties(credentialsJsonPath) {
    const analyticsAdmin = getAnalyticsAdminClient(credentialsJsonPath);

    const [accounts] = await analyticsAdmin.listAccounts();
    if (!accounts || accounts.length === 0) throw new Error("No accounts found");

    let allProperties = [];

    for (const account of accounts) {
        let properties = [];
        try {
            [properties] = await analyticsAdmin.listProperties({
                filter: `parent:${account.name}`,
                pageSize: 200,
            });
        } catch (err) {
            console.warn(
                `[admin] Could not list properties for account ${account.name}: ${err.message}`,
            );
            continue;
        }

        const formatted = properties
            .filter((p) => p && p.name)
            .map((p) => ({
                id: p.name.split("/").pop(),
                site: p.displayName,
                url: null,
                domain: null,
                currencyCode: p.currencyCode || null,
            }));

        allProperties = [...allProperties, ...formatted];
    }

    // Fetch web data streams in parallel to get domain URLs
    console.log(
        `[admin] Fetching data streams for ${allProperties.length} properties…`,
    );
    const enriched = await Promise.all(
        allProperties.map(async (prop) => {
            try {
                const [streams] = await analyticsAdmin.listDataStreams({
                    parent: `properties/${prop.id}`,
                });
                const webStream = streams.find((s) => s.type === "WEB_DATA_STREAM");
                const rawUrl = webStream?.webStreamData?.defaultUri ?? null;
                const domain = rawUrl ? extractDomain(rawUrl) : null;
                return { ...prop, url: rawUrl, domain };
            } catch {
                // Permission denied or no streams – skip enrichment
                return prop;
            }
        }),
    );

    return enriched;
}

function getAnalyticsAdminClient(credentialsJsonPath = CREDENTIALS_PATH) {
    if (!analyticsAdminClient) {
        const { AnalyticsAdminServiceClient } = require("@google-analytics/admin");
        analyticsAdminClient = new AnalyticsAdminServiceClient({
            keyFilename: credentialsJsonPath,
        });
    }
    return analyticsAdminClient;
}

async function getPropertyCurrencyCode(
    propertyId,
    credentialsJsonPath = CREDENTIALS_PATH,
) {
    if (!propertyId) return "USD";

    if (propertyCurrencyMemCache.has(propertyId)) {
        return propertyCurrencyMemCache.get(propertyId);
    }

    const cache = await getCachedProperties();
    const cachedProperty = (cache?.properties || []).find(
        (prop) => String(prop.id) === String(propertyId),
    );
    if (cachedProperty?.currencyCode) {
        propertyCurrencyMemCache.set(propertyId, cachedProperty.currencyCode);
        return cachedProperty.currencyCode;
    }

    try {
        const analyticsAdmin = getAnalyticsAdminClient(credentialsJsonPath);
        const [property] = await analyticsAdmin.getProperty({
            name: `properties/${propertyId}`,
        });
        const currencyCode = property?.currencyCode || "USD";
        propertyCurrencyMemCache.set(propertyId, currencyCode);
        return currencyCode;
    } catch (err) {
        console.warn(
            `[analytics-card] currency lookup failed for ${propertyId}: ${err.message}`,
        );
        return "USD";
    }
}

// ---------------------------------------------------------------------------
// Public: refresh cache (called on startup or via API endpoint)
// ---------------------------------------------------------------------------

exports.refreshPropertiesCache = async function refreshPropertiesCache(
    credentialsJsonPath = CREDENTIALS_PATH,
) {
    console.log("[cache] Refreshing properties cache…");
    const properties = await getAnalyticsProperties(credentialsJsonPath);
    await savePropertiesToCache(properties);
    console.log(`[cache] Saved ${properties.length} properties.`);
    return properties;
};

// ---------------------------------------------------------------------------
// GA4 Data API – batch realtime report
// ---------------------------------------------------------------------------

async function batchRealtimeReport({
    properties,
    credentialsJsonPath = CREDENTIALS_PATH,
}) {
    const { BetaAnalyticsDataClient } = require("@google-analytics/data");
    const analyticsDataClient = new BetaAnalyticsDataClient({
        keyFilename: credentialsJsonPath,
    });

    // Capture quota from the first successful response (project-level pool is shared)
    let quotaAggregate = null;

    const results = await Promise.all(
        properties.map(async (property) => {
            const request = {
                property: `properties/${property.id}`,
                dimensions: [{ name: "streamName" }],
                metrics: [
                    { name: "activeUsers" },
                    { name: "screenPageViews" },
                ],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
                returnPropertyQuota: true,
            };

            try {
                const [response] = await analyticsDataClient.runRealtimeReport(request);

                // Capture quota (first response that has it wins)
                if (response.propertyQuota && !quotaAggregate) {
                    const q = response.propertyQuota;
                    quotaAggregate = {
                        tokensPerDay: q.tokensPerDay,
                        tokensPerHour: q.tokensPerHour,
                        tokensPerProjectPerHour: q.tokensPerProjectPerHour,
                        concurrentRequests: q.concurrentRequests,
                        updatedAt: new Date().toISOString(),
                    };
                    latestQuota = quotaAggregate; // persist for /api/quota endpoint
                }

                if (!response.rows || response.rows.length === 0) {
                    return {
                        propertyId: property.id,
                        siteName: property.site,
                        domain: property.domain,
                        url: property.url,
                        activeUsers: 0,
                        pageViews: 0,
                        dashboardUrl: `https://analytics.google.com/analytics/web/#/p${property.id}/reports/intelligenthome`,
                    };
                }

                const totalActiveUsers = response.rows.reduce(
                    (sum, row) =>
                        sum + parseInt(row.metricValues?.[0]?.value || "0", 10),
                    0,
                );
                const totalPageViews = response.rows.reduce(
                    (sum, row) =>
                        sum + parseInt(row.metricValues?.[1]?.value || "0", 10),
                    0,
                );

                return {
                    propertyId: property.id,
                    siteName: property.site,
                    domain: property.domain,
                    url: property.url,
                    activeUsers: totalActiveUsers,
                    pageViews: totalPageViews,
                    dashboardUrl: `https://analytics.google.com/analytics/web/#/p${property.id}/reports/intelligenthome`,
                };
            } catch (error) {
                if (error.code === 7) {
                    // PERMISSION_DENIED – service account lacks access to this property
                    console.warn(
                        `[SKIP] No access to "${property.site}" (id: ${property.id}). Grant Viewer access in GA4.`,
                    );
                    return null;
                }
                console.error(
                    `[error] Property "${property.site}" [code ${error.code}]: ${error.message}`,
                );
                return {
                    error: true,
                    propertyId: property.id,
                    siteName: property.site,
                    domain: property.domain,
                    url: property.url,
                    activeUsers: 0,
                    pageViews: 0,
                    errorMessage: error.details || error.message,
                    dashboardUrl: `https://analytics.google.com/analytics/web/#/p${property.id}/reports/intelligenthome`,
                };
            }
        }),
    );

    return {
        data: results.filter((r) => r !== null),
        quota: quotaAggregate,
    };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

exports.allrealtime = async (req, res) => {
    try {
        let cache = await getCachedProperties();

        if (isCacheStale(cache)) {
            try {
                const properties = await exports.refreshPropertiesCache(CREDENTIALS_PATH);
                cache = { properties, lastUpdated: new Date().toISOString() };
            } catch (err) {
                console.error(
                    "[cache] Refresh failed, using stale cache:",
                    err.message,
                );
            }
        }

        const properties = cache?.properties ?? [];

        // ---- in-memory short-term cache: skip GA4 API if fresh enough ----
        const memAge = Date.now() - realtimeMemCachedAt;
        let batchData, quota, fetchDurationMs;

        if (realtimeMemCache && memAge < REALTIME_MEM_TTL) {
            ({ data: batchData, quota, fetchDurationMs } = realtimeMemCache);
            console.log(`[mem-cache] Serving realtime from memory (age ${Math.round(memAge/1000)}s)`);
        } else if (realtimeMemCache) {
            // Memory cache exists but stale - serve memory cache instantly, refresh in background
            ({ data: batchData, quota, fetchDurationMs } = realtimeMemCache);
            console.log(`[mem-cache] Serving stale memory cache, refreshing in background…`);
            (async () => {
                try {
                    const fetchStart = Date.now();
                    const { data, quota: q } = await batchRealtimeReport({ properties });
                    realtimeMemCache = { data, quota: q, fetchDurationMs: Date.now() - fetchStart };
                    realtimeMemCachedAt = Date.now();
                } catch (e) {
                    console.warn('[mem-cache] Background refresh failed:', e.message);
                }
            })();
        } else {
            // Cold start - render instantly with cached properties structure, fetch live data in background
            console.log('[mem-cache] Cold start: rendering instant layout, fetching live data in background…');
            batchData = properties.map((p) => ({
                propertyId: p.id,
                siteName: p.site,
                domain: p.domain || null,
                url: p.url || null,
                activeUsers: 0,
                pageViews: 0,
                dashboardUrl: `https://analytics.google.com/analytics/web/#/p${p.id}/reports/intelligenthome`,
            }));
            quota = null;
            fetchDurationMs = 0;

            // Trigger background fetch to warm memory cache
            (async () => {
                try {
                    const fetchStart = Date.now();
                    const { data, quota: q } = await batchRealtimeReport({ properties });
                    realtimeMemCache = { data, quota: q, fetchDurationMs: Date.now() - fetchStart };
                    realtimeMemCachedAt = Date.now();
                    console.log(`[mem-cache] Cold start background fetch complete (${data.length} properties)`);
                } catch (e) {
                    console.warn('[mem-cache] Cold start background fetch failed:', e.message);
                }
            })();
        }
        // ---------------------------------------------------------------------

        const accessible = batchData.filter((r) => !r.error);
        const errors = batchData.filter((r) => r.error);

        const totalActiveUsers = accessible.reduce((s, r) => s + r.activeUsers, 0);
        const totalPageViews = accessible.reduce((s, r) => s + r.pageViews, 0);

        const formattedData = batchData.map((r) => ({
            propertyId: r.propertyId,
            siteName: r.siteName,
            domain: r.domain || null,
            url: r.url || null,
            activeUsers: r.activeUsers,
            pageViews: r.pageViews,
            error: r.error ? r.errorMessage : null,
            dashboardUrl: r.dashboardUrl,
        }));

        res.status(200).render("home", {
            data: formattedData,
            quota: quota ?? null,
            cacheAge: cache?.lastUpdated ?? null,
            fetchDurationMs,
            totalActiveUsers,
            totalPageViews,
            accessibleCount: accessible.length,
            errorCount: errors.length,
            head: {
                title: "GA4 Dashboard & MCP · Live Monitor",
                description: "Real-time Analytics Dashboard",
                image: "",
                url: "",
            },
        });
    } catch (err) {
        console.error("[route] Fatal error:", err.message);
        res.status(500).send(err.message);
    }
};

/** GET /api/realtime-all – returns live realtime stats for all properties (async hydration endpoint) */
exports.realtimeAllApi = async (req, res) => {
    try {
        const cache = await getCachedProperties();
        const properties = cache?.properties ?? [];
        const memAge = Date.now() - realtimeMemCachedAt;

        if (realtimeMemCache && memAge < REALTIME_MEM_TTL) {
            return res.json({ ok: true, cached: true, ...realtimeMemCache });
        }

        const fetchStart = Date.now();
        const { data, quota } = await batchRealtimeReport({ properties });
        const fetchDurationMs = Date.now() - fetchStart;

        realtimeMemCache = { data, quota, fetchDurationMs };
        realtimeMemCachedAt = Date.now();

        res.json({ ok: true, cached: false, data, quota, fetchDurationMs });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
};

/** GET /api/quota – returns the latest quota snapshot from the last realtime fetch */
exports.quotaData = (req, res) => {
    if (!latestQuota) {
        return res.json({ ok: false, quota: null, message: "No quota data yet. Reload the dashboard first." });
    }
    res.json({ ok: true, quota: latestQuota });
};

/** GET /api/spikes – detects traffic spikes and analyzes referral sources */
exports.trafficSpikes = async (req, res) => {
    try {
        const cached = await cacheGet("spike", "all");
        if (cached) {
            return res.json({ ...cached, cached: true });
        }

        const { detectAllSpikes } = require("./spikeDetector");
        const cache = await getCachedProperties();
        const properties = cache?.properties ?? [];

        const spikes = await detectAllSpikes(properties);
        const payload = { ok: true, count: spikes.length, spikes };
        cacheSet("spike", "all", payload).catch(() => {});
        res.json(payload);
    } catch (err) {
        console.error("[spikes] Error detecting traffic spikes:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
};

/** GET /api/property-detail/:propertyId – per-card detail: top countries, sources, pages */
exports.propertyDetail = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    try {
        // Run three focused realtime reports in parallel (each isolated so one failure doesn't break the rest)
        // NOTE: firstUserSource / sessionSource are NOT valid realtime dimensions.
        //       Use eventName for top events instead.
        const [countryRes, eventRes, pageRes] = await Promise.all([
            runSafeRealtimeReport({
                propertyId,
                dimensions: [{ name: "country" }, { name: "countryId" }],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
            runSafeRealtimeReport({
                propertyId,
                dimensions: [{ name: "eventName" }],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
            runSafeRealtimeReport({
                propertyId,
                dimensions: [{ name: "unifiedScreenName" }],
                metrics: [{ name: "screenPageViews" }],
                fallbackMetrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
        ]);

        const countries = (countryRes.rows || []).map(r => ({
            name: r.dimensionValues?.[0]?.value ?? "Unknown",
            id:   r.dimensionValues?.[1]?.value ?? "ZZ",
            users: parseInt(r.metricValues?.[0]?.value || "0", 10),
        })).filter(r => r.users > 0);

        const events = (eventRes.rows || []).map(r => ({
            name:  r.dimensionValues?.[0]?.value ?? "(unknown)",
            users: parseInt(r.metricValues?.[0]?.value || "0", 10),
        })).filter(r => r.users > 0).slice(0, 8);

        const pages = (pageRes.rows || []).map(r => ({
            path:  r.dimensionValues?.[0]?.value ?? "/",
            views: parseInt(r.metricValues?.[0]?.value || "0", 10),
        })).filter(r => r.views > 0).slice(0, 8);

        res.json({ ok: true, countries, events, pages });
    } catch (err) {
        if (err.code === 7) {
            return res.status(403).json({ error: "Permission denied for this property" });
        }
        res.status(500).json({ error: err.message });
    }
};

/** GET /api/visitor-insights/:propertyId?range=today|7d|28d – aggregate visitor personas */
exports.visitorInsights = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    try {
        const { getVisitorInsights } = require("./visitorInsights");
        const range = req.query.range || "28d";
        const insights = await getVisitorInsights(propertyId, range);
        res.json(insights);
    } catch (err) {
        console.error(`[visitor-insights] ${propertyId}:`, err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
};

/** POST /api/refresh-cache – force a properties cache refresh */
exports.refreshCache = async (req, res) => {
    try {
        const properties = await exports.refreshPropertiesCache(CREDENTIALS_PATH);
        res.json({
            ok: true,
            count: properties.length,
            updatedAt: new Date().toISOString(),
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
};

// ---------------------------------------------------------------------------
// Globe data – country-level realtime aggregation
// ---------------------------------------------------------------------------

const GLOBE_CACHE_PATH = path.join(CACHE_DIR, "globe.json");
const GLOBE_CACHE_TTL_SEC = 60; // 1 minute

async function getCachedGlobeData() {
    try {
        const raw = await fs.readFile(GLOBE_CACHE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.fetchedAt) return null;
        const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
        if (ageMs > GLOBE_CACHE_TTL_SEC * 1000) return null;
        return parsed;
    } catch {
        return null;
    }
}

async function saveGlobeDataToCache(payload) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(GLOBE_CACHE_PATH, JSON.stringify(payload, null, 2));
}

async function fetchGlobeCountryData(properties) {
    const { BetaAnalyticsDataClient } = require("@google-analytics/data");
    const client = new BetaAnalyticsDataClient({ keyFilename: CREDENTIALS_PATH });

    // One report per property with country + countryId dimensions
    const results = await Promise.all(
        properties.map(async (prop) => {
            try {
                const [response] = await client.runRealtimeReport({
                    property: `properties/${prop.id}`,
                    dimensions: [{ name: "country" }, { name: "countryId" }],
                    metrics: [{ name: "activeUsers" }],
                    minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
                });
                return { prop, rows: response.rows || [] };
            } catch (err) {
                if (err.code !== 7) {
                    console.warn(`[globe] ${prop.site}: ${err.message}`);
                }
                return { prop, rows: [] };
            }
        }),
    );

    // Aggregate by countryId across all properties
    const byCountry = new Map();
    for (const { prop, rows } of results) {
        for (const row of rows) {
            const countryName = row.dimensionValues?.[0]?.value ?? "Unknown";
            const countryId   = row.dimensionValues?.[1]?.value ?? "ZZ";
            const users       = parseInt(row.metricValues?.[0]?.value || "0", 10);
            if (!users) continue;

            if (!byCountry.has(countryId)) {
                byCountry.set(countryId, {
                    countryId,
                    country: countryName,
                    totalUsers: 0,
                    properties: [],
                });
            }
            const entry = byCountry.get(countryId);
            entry.totalUsers += users;
            entry.properties.push({
                name:   prop.site,
                domain: prop.domain ?? null,
                users,
            });
        }
    }

    // Sort properties within each country
    const countries = [...byCountry.values()].sort((a, b) => b.totalUsers - a.totalUsers);
    countries.forEach(c => c.properties.sort((a, b) => b.users - a.users));

    return countries;
}

// ---------------------------------------------------------------------------
// Globe users – city-level realtime data for avatar map
// ---------------------------------------------------------------------------

const GLOBE_USERS_CACHE_PATH = path.join(CACHE_DIR, "globe_users.json");
const GLOBE_USERS_TTL_SEC = 30;

async function getCachedGlobeUsers() {
    try {
        const raw  = await fs.readFile(GLOBE_USERS_CACHE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed?.fetchedAt) return null;
        const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
        if (ageMs > GLOBE_USERS_TTL_SEC * 1000) return null;
        return parsed;
    } catch { return null; }
}

async function saveGlobeUsersToCache(payload) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(GLOBE_USERS_CACHE_PATH, JSON.stringify(payload, null, 2));
}

/** Simple deterministic color from a string seed */
function seedColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue},65%,55%)`;
}

async function fetchGlobeUsersData(properties) {
    const results = await Promise.all(
        properties.map(async (prop) => {
            const response = await runSafeRealtimeReport({
                propertyId: prop.id,
                dimensions: [
                    { name: "city" },
                    { name: "country" },
                    { name: "countryId" },
                    { name: "deviceCategory" },
                ],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
                // NOTE: city×country×countryId×device is a high-cardinality breakdown.
                // The default limit (50) truncated rows for busier properties, which
                // silently undercounted totalActiveUsers vs the homepage's per-stream
                // total (no such cap). Raised well past any realistic concurrent-user
                // combo count so the globe's total matches the homepage's.
                limit: 10000,
            });
            return { prop, rows: response.rows || [] };
        })
    );

    // city key → aggregate entry
    const cityMap    = new Map();
    const countryMap = new Map();
    const deviceMap  = new Map();
    const propMap    = new Map(); // per-property active users
    let   rawTotal   = 0;         // all users regardless of coordinate availability

    for (const { prop, rows } of results) {
        for (const row of rows) {
            const city    = row.dimensionValues?.[0]?.value ?? "(not set)";
            const country = row.dimensionValues?.[1]?.value ?? "Unknown";
            const ctryId  = row.dimensionValues?.[2]?.value ?? "ZZ";
            const device  = row.dimensionValues?.[3]?.value ?? "desktop";
            const users   = parseInt(row.metricValues?.[0]?.value || "0", 10);
            if (!users) continue;
            rawTotal += users;

            // City aggregation
            const coords = getCityCoords(city);
            if (coords && city !== "(not set)") {
                const key = `${city}||${ctryId}`;
                if (!cityMap.has(key)) {
                    cityMap.set(key, {
                        city, country, countryId: ctryId,
                        lat: coords[0], lng: coords[1],
                        count: 0,
                        device,
                        color: seedColor(`${city}${ctryId}`),
                        prop: prop.site,
                    });
                }
                cityMap.get(key).count += users;
            }

            // Country aggregation
            if (!countryMap.has(ctryId)) countryMap.set(ctryId, { name: country, id: ctryId, count: 0 });
            countryMap.get(ctryId).count += users;

            // Device aggregation
            const devLabel = device.charAt(0).toUpperCase() + device.slice(1);
            deviceMap.set(devLabel, (deviceMap.get(devLabel) || 0) + users);

            // Property aggregation
            if (!propMap.has(prop.site)) {
                propMap.set(prop.site, { site: prop.site, domain: prop.domain || null, url: prop.url || null, count: 0 });
            }
            propMap.get(prop.site).count += users;
        }
    }

    const users       = [...cityMap.values()].sort((a, b) => b.count - a.count);
    const cities      = users.slice(0, 8).map(u => ({ city: u.city, country: u.country, id: u.countryId, count: u.count }));
    const countries   = [...countryMap.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    const devices     = [...deviceMap.entries()].map(([name, count]) => ({ name, count }))
                          .sort((a, b) => b.count - a.count);
    const propsList   = [...propMap.values()].sort((a, b) => b.count - a.count);

    return { users, cities, countries, devices, properties: propsList, totalActiveUsers: rawTotal };
}

/** GET /api/globe-users – city-level user data for avatar map */
exports.globeUsers = async (req, res) => {
    try {
        const cached = await getCachedGlobeUsers();
        if (cached) return res.json(stripSensitiveGlobeUsersPayload(cached));

        const propCache  = await getCachedProperties();
        const properties = propCache?.properties ?? [];

        const payload = await fetchGlobeUsersData(properties);
        payload.fetchedAt = new Date().toISOString();

        const publicPayload = stripSensitiveGlobeUsersPayload(payload);

        await saveGlobeUsersToCache(publicPayload);
        res.json(publicPayload);
    } catch (err) {
        console.error("[globe-users] Fatal:", err.message);
        res.status(500).json({ error: err.message });
    }
};

/** GET /api/globe-data – JSON endpoint for the 3D globe */
exports.globeData = async (req, res) => {
    try {
        const cached = await getCachedGlobeData();
        if (cached) {
            return res.json(cached);
        }

        const propCache  = await getCachedProperties();
        const properties = propCache?.properties ?? [];

        const countries  = await fetchGlobeCountryData(properties);
        const payload    = { fetchedAt: new Date().toISOString(), countries };

        await saveGlobeDataToCache(payload);
        res.json(payload);
    } catch (err) {
        console.error("[globe] Fatal:", err.message);
        res.status(500).json({ error: err.message });
    }
};

/** GET /globe – renders the 3D globe view (uses main layout for nav) */
exports.globeView = (req, res) => {
    res.render("globe", {
        head: {
            title: "GA4 Dashboard & MCP · Globe",
            description: "3D real-time active user globe",
            image: "",
            url: "",
        },
    });
};

// ---------------------------------------------------------------------------
// Analytics page
// ---------------------------------------------------------------------------

/** GET /analytics – renders analytics dashboard view */
exports.analyticsView = async (req, res) => {
    try {
        const cache      = await getCachedProperties();
        const properties = cache?.properties ?? [];
        res.render("analytics", {
            properties,
            analyticsCatalog: getAnalyticsCatalog(),
            head: {
                title: "GA4 Dashboard & MCP · Analytics",
                description: "In-depth analytics dashboard",
                image: "",
                url: "",
            },
        });
    } catch (err) {
        console.error("[analytics] View error:", err.message);
        res.status(500).send(err.message);
    }
};

/** GET /api/analytics-card/:propertyId/:type?range=today|7d|28d */
exports.analyticsCard = async (req, res) => {
    const { propertyId, type } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    const range  = req.query.range || "28d";
    const cfg    = getAnalyticsCardConfig(type);
    if (!cfg) return res.status(400).json({ error: `Unknown card type: ${type}` });

    // ── Check cache first (skip caching for realtime-summary-like queries) ──
    const cacheKey = `${propertyId}:${type}:${range}`;
    const cached = await cacheGet("card", cacheKey);
    if (cached) {
        return res.json({ ...cached, cached: true });
    }

    const dateRange = getDateRange(range);
    // For time-series cards, match the limit to the range
    const limit = cfg.timeSeries
        ? (range === "today" ? 1 : range === "7d" ? 7 : 28)
        : cfg.limit;

    try {
        const currencyCode = await getPropertyCurrencyCode(propertyId);
        const metricObjects = cfg.metrics.map(name => ({ name }));
        const fallbackMetricObjects = cfg.fallbackMetrics?.map(name => ({ name })) || null;
        const orderBys = cfg.timeSeries
            ? [{ dimension: { dimensionName: cfg.dimensions[0] || "date" }, desc: false }]
            : [{ metric: { metricName: cfg.metrics[0] }, desc: true }];

        const response = await runSafeHistoricalReport({
            propertyId,
            dimensions: cfg.dimensions.map(name => ({ name })),
            metrics: metricObjects,
            fallbackMetrics: fallbackMetricObjects,
            dateRange,
            limit,
            orderBys,
        });

        if (!response.ok) throw new Error(response.error || "Report query failed");

        const metricHeaders = (response.usedMetrics || metricObjects).map(metric => metric.name);

        const rows = (response.rows || []).map(row => ({
            dims:    row.dimensionValues.map(d => d.value),
            metrics: row.metricValues.map(m => parseFloat(m.value || "0")),
        }));

        const totals = rows.reduce((acc, r) => {
            r.metrics.forEach((v, i) => { acc[i] = (acc[i] || 0) + v; });
            return acc;
        }, []);

        const payload = {
            ok: true, type, rows, totals, range,
            timeSeries: !!cfg.timeSeries,
            dimensionHeaders: cfg.dimensions,
            metricHeaders,
            currencyCode,
        };

        // Cache asynchronously (don't block response)
        cacheSet("card", cacheKey, payload).catch(() => {});

        res.json(payload);
    } catch (err) {
        console.error(`[analytics-card] ${type}:`, err.message);
        res.status(500).json({ error: err.message });
    }
};

/** GET /api/realtime-summary/:propertyId – pulls live data from in-memory realtime cache */
exports.realtimeSummary = (req, res) => {
    if (!realtimeMemCache) {
        return res.json({ ok: false, message: "No realtime data cached. Load the dashboard first." });
    }
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    const prop = (realtimeMemCache.data || []).find(r => String(r.propertyId) === String(propertyId));
    if (!prop) return res.json({ ok: false, message: "Property not in cache" });
    res.json({
        ok: true,
        activeUsers: prop.activeUsers,
        pageViews:   prop.pageViews,
        cachedAgo:   Math.round((Date.now() - realtimeMemCachedAt) / 1000),
    });
};

// ---------------------------------------------------------------------------
// Reports section – aggregated report data with spike annotations
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics-reports/:propertyId?range=28d
 * Returns a curated report bundle:
 *   - dayOfWeek: sessions/users aggregated by weekday for the period
 *   - topSources: top session sources with session counts
 *   - topPages: top pages by views & engagement time
 *   - spikeAnnotations: detected traffic anomalies with source cause
 *   - hourlyPattern: traffic by hour
 */
exports.analyticsReports = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    const range = req.query.range || "28d";

    // ── Check disk cache first ──
    const cacheKey = `${propertyId}:reports:${range}`;
    const cached = await cacheGet("report", cacheKey);
    if (cached) {
        return res.json({ ...cached, cached: true });
    }

    const dateRange = getDateRange(range);

    try {
        const { classifyReferralSource } = require("./spikeDetector");

        // 1. Day-of-week pattern: fetch last 28 days, group by weekday client-side
        const dowPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "date" }],
            metrics: [{ name: "sessions" }, { name: "activeUsers" }],
            dateRange,
            limit: range === "28d" ? 28 : range === "7d" ? 7 : 1,
            orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
        });

        // 2. Top referral sources (traffic anomalies)
        const sourcesPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
            metrics: [{ name: "sessions" }, { name: "activeUsers" }],
            dateRange,
            limit: 15,
        });

        // 3. Top pages by views & users
        const pagesPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "pagePath" }],
            metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
            dateRange,
            limit: 10,
        });

        // 4. Landing pages per source (to correlate viral sources with entry pages)
        const landingPagePromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "sessionSource" }, { name: "landingPagePlusQueryString" }],
            metrics: [{ name: "sessions" }],
            dateRange,
            limit: 20,
        });

        // 5. Top page referrers (actual referral URLs)
        const referrerPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "pageReferrer" }],
            metrics: [{ name: "sessions" }],
            dateRange,
            limit: 15,
        });

        // 6. Hourly pattern (last 48 hours)
        const hourlyPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "dateHour" }],
            metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
            dateRange: { startDate: "7daysAgo", endDate: "today" },
            limit: 48,
        });

        const [dowRes, sourcesRes, pagesRes, landingPageRes, referrerRes, hourlyRes] = await Promise.all([
            dowPromise, sourcesPromise, pagesPromise, landingPagePromise, referrerPromise, hourlyPromise
        ]);

        // -- Day of week aggregation --
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayBuckets = dayNames.map(d => ({ day: d, sessions: 0, users: 0, count: 0 }));
        if (dowRes.ok) {
            (dowRes.rows || []).forEach(r => {
                const dateStr = r.dimensionValues?.[0]?.value || "";
                const year = parseInt(dateStr.slice(0, 4), 10);
                const month = parseInt(dateStr.slice(4, 6), 10) - 1;
                const day = parseInt(dateStr.slice(6, 8), 10);
                if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                    const dow = new Date(year, month, day).getDay();
                    dayBuckets[dow].sessions += parseInt(r.metricValues?.[0]?.value || "0", 10);
                    dayBuckets[dow].users += parseInt(r.metricValues?.[1]?.value || "0", 10);
                    dayBuckets[dow].count++;
                }
            });
        }
        const dayOfWeek = dayBuckets.map(b => ({
            day: b.day,
            sessions: b.sessions,
            users: b.users,
            avgSessions: b.count > 0 ? Math.round(b.sessions / b.count) : 0,
        }));

        // -- Top sources with anomaly classification --
        const topSources = (sourcesRes.rows || [])
            .map(r => {
                const src = r.dimensionValues?.[0]?.value || "(direct)";
                const med = r.dimensionValues?.[1]?.value || "";
                const sessions = parseInt(r.metricValues?.[0]?.value || "0", 10);
                const users = parseInt(r.metricValues?.[1]?.value || "0", 10);
                const classified = classifyReferralSource(src);
                return {
                    source: src,
                    medium: med,
                    sessions,
                    users,
                    classifiedName: classified.name,
                    category: classified.category,
                    shape: classified.shape,
                };
            })
            .filter(r => r.sessions > 0)
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 12);

        // -- Top pages --
        const topPages = (pagesRes.rows || [])
            .map(r => ({
                path: r.dimensionValues?.[0]?.value || "/",
                views: parseInt(r.metricValues?.[0]?.value || "0", 10),
                users: parseInt(r.metricValues?.[1]?.value || "0", 10),
            }))
            .filter(r => r.views > 0)
            .sort((a, b) => b.views - a.views)
            .slice(0, 10);

        // -- Hourly pattern (for last 48h or up to limit) --
        const hourlyPattern = (hourlyRes.rows || [])
            .map(r => ({
                hour: r.dimensionValues?.[0]?.value || "",
                users: parseInt(r.metricValues?.[0]?.value || "0", 10),
                views: parseInt(r.metricValues?.[1]?.value || "0", 10),
            }))
            .filter(r => r.users > 0 || r.views > 0)
            .sort((a, b) => a.hour.localeCompare(b.hour))
            .slice(-48);

        // -- Build source → landing pages map from landingPageRes --
        const sourceToLandingPages = new Map();
        if (landingPageRes.ok) {
            (landingPageRes.rows || []).forEach(r => {
                const src = r.dimensionValues?.[0]?.value || "(direct)";
                const lp = r.dimensionValues?.[1]?.value || "/";
                const sessions = parseInt(r.metricValues?.[0]?.value || "0", 10);
                if (!sessions) return;
                if (!sourceToLandingPages.has(src)) {
                    sourceToLandingPages.set(src, []);
                }
                sourceToLandingPages.get(src).push({ landingPage: lp, sessions });
            });
            // Sort each source's landing pages by sessions descending
            sourceToLandingPages.forEach((pages, key) => {
                sourceToLandingPages.set(key, pages.sort((a, b) => b.sessions - a.sessions).slice(0, 5));
            });
        }

        // -- Top referring URLs --
        const topReferrers = (referrerRes.rows || [])
            .map(r => ({
                referrer: r.dimensionValues?.[0]?.value || "(direct)",
                sessions: parseInt(r.metricValues?.[0]?.value || "0", 10),
            }))
            .filter(r => r.sessions > 0 && r.referrer !== "(direct)" && r.referrer !== "")
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10);

        // -- Search URL mappings for viral platforms --
        // Get domain from cached property if available
        let siteDomain = "";
        try {
            const cache = await getCachedProperties();
            const propMeta = (cache?.properties || []).find(p => String(p.id) === String(propertyId));
            if (propMeta?.domain) siteDomain = propMeta.domain;
        } catch { /* ignore */ }

        function buildSearchUrl(category, domain) {
            const encoded = encodeURIComponent(domain ? `site:${domain}` : domain || "");
            const encodedRaw = encodeURIComponent(domain || "");
            const urls = {
                twitter: domain ? `https://twitter.com/search?q=${encodeURIComponent(`site:${domain}`)}&src=typed_query&f=live` : null,
                reddit: domain ? `https://www.reddit.com/search/?q=${encodeURIComponent(`site:${domain}`)}` : null,
                hn: domain ? `https://hn.algolia.com/?query=${encodeURIComponent(`site:${domain}`)}&sort=byDate&type=story` : null,
                instagram: domain ? `https://www.instagram.com/explore/search/keyword/?q=${encodedRaw}` : null,
                tiktok: null,
                discord: null,
                telegram: null,
                whatsapp: null,
                producthunt: domain ? `https://www.producthunt.com/search?q=${encodedRaw}` : null,
                github: domain ? `https://github.com/search?q=${encodedRaw}&type=repositories` : null,
                linkedin: domain ? `https://www.linkedin.com/search/results/content/?keywords=${encodedRaw}` : null,
                youtube: domain ? `https://www.youtube.com/results?search_query=${encodeURIComponent(domain)}` : null,
                facebook: domain ? `https://www.facebook.com/search/top?q=${encodeURIComponent(domain)}` : null,
                perplexity: domain ? `https://www.perplexity.ai/search?q=${encodeURIComponent(domain)}` : null,
                claude: null,
                chatgpt: null,
                pinterest: domain ? `https://www.pinterest.com/search/pins/?q=${encodedRaw}` : null,
                medium: domain ? `https://medium.com/search?q=${encodedRaw}` : null,
                quora: domain ? `https://www.quora.com/search?q=${encodeURIComponent(domain)}` : null,
                stackoverflow: domain ? `https://stackoverflow.com/search?q=${encodedRaw}` : null,
                bing: null,
                duckduckgo: null,
            };
            return urls[category] || null;
        }

        // -- Spike annotations (detect anomalies from sources data) --
        const spikeAnnotations = topSources
            .filter(s => {
                // Anomalies: social, AI chatbot, or news aggregator sources with notable traffic
                const anomalyCategories = ["chatgpt", "twitter", "reddit", "hn", "instagram", "tiktok", "discord", "perplexity", "claude", "facebook", "producthunt"];
                return anomalyCategories.includes(s.category) && s.sessions >= 2;
            })
            .map(s => {
                // Find landing pages for this source
                const srcLandingPages = (sourceToLandingPages.get(s.source) || []).slice(0, 3);
                // Find matching referrers (by checking if referrer URL contains the source domain pattern)
                const matchingReferrers = topReferrers.filter(r => {
                    const refLower = r.referrer.toLowerCase();
                    const srcLower = s.source.toLowerCase();
                    const categoryPatterns = {
                        twitter: /t\.co|twitter|x\.com/i,
                        reddit: /reddit/i,
                        hn: /ycombinator|news\.ycombinator/i,
                        instagram: /instagram/i,
                        facebook: /facebook/i,
                        producthunt: /producthunt/i,
                        github: /github/i,
                        linkedin: /linkedin/i,
                        youtube: /youtube/i,
                        pinterest: /pinterest/i,
                        medium: /medium/i,
                        quora: /quora/i,
                        stackoverflow: /stackoverflow|stackexchange/i,
                    };
                    const pattern = categoryPatterns[s.category];
                    return pattern ? pattern.test(refLower) : refLower.includes(srcLower);
                }).slice(0, 2);

                const searchUrl = buildSearchUrl(s.category, siteDomain);

                return {
                    shape: s.shape,
                    source: s.classifiedName,
                    category: s.category,
                    sessions: s.sessions,
                    users: s.users,
                    annotation: `Traffic from ${s.classifiedName} — ${s.sessions} sessions, ${s.users} users`,
                    landingPages: srcLandingPages,
                    referrers: matchingReferrers,
                    searchUrl,
                    searchLabel: searchUrl ? `Search on ${s.classifiedName}` : null,
                };
            })
            .sort((a, b) => b.sessions - a.sessions);

        // Look for unusual source patterns (high-volume single source dominating)
        const totalSourceSessions = topSources.reduce((sum, s) => sum + s.sessions, 0) || 1;
        const unusualSources = topSources
            .filter(s => {
                const share = s.sessions / totalSourceSessions;
                return share > 0.3 && s.category !== "google" && s.category !== "direct";
            })
            .map(s => {
                const srcLandingPages = (sourceToLandingPages.get(s.source) || []).slice(0, 2);
                const searchUrl = buildSearchUrl(s.category, siteDomain);
                return {
                    shape: s.shape,
                    source: s.classifiedName,
                    share: Math.round((s.sessions / totalSourceSessions) * 100),
                    sessions: s.sessions,
                    annotation: `${s.classifiedName} accounts for ${Math.round((s.sessions / totalSourceSessions) * 100)}% of all traffic`,
                    landingPages: srcLandingPages,
                    searchUrl,
                    searchLabel: searchUrl ? `Search on ${s.classifiedName}` : null,
                };
            });

        const payload = {
            ok: true,
            propertyId,
            range,
            dayOfWeek,
            topSources,
            topPages,
            hourlyPattern,
            spikeAnnotations,
            unusualSources,
            totals: {
                totalSessions: topSources.reduce((s, x) => s + x.sessions, 0),
                totalUsers: topSources.reduce((s, x) => s + x.users, 0),
                totalPageviews: topPages.reduce((s, x) => s + x.views, 0),
            },
        };

        // Cache asynchronously (don't block response)
        cacheSet("report", cacheKey, payload).catch(() => {});

        res.json(payload);
    } catch (err) {
        console.error(`[analytics-reports] ${propertyId}:`, err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
};
