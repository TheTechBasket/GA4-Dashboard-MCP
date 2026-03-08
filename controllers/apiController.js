const fs = require("fs/promises");
const path = require("path");
const { getCityCoords } = require("./cityCoords");

const CACHE_DIR = path.join(__dirname, "..", ".cache");
const PROPERTIES_CACHE_PATH = path.join(CACHE_DIR, "properties.json");
const CREDENTIALS_PATH = "ga4dataapi-3b121924e25d.json";

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
        } else {
            const fetchStart = Date.now();
            ({ data: batchData, quota } = await batchRealtimeReport({ properties }));
            fetchDurationMs = Date.now() - fetchStart;
            realtimeMemCache = { data: batchData, quota, fetchDurationMs };
            realtimeMemCachedAt = Date.now();
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
                title: "Pulseboard · Live Monitor",
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

/** GET /api/quota – returns the latest quota snapshot from the last realtime fetch */
exports.quotaData = (req, res) => {
    if (!latestQuota) {
        return res.json({ ok: false, quota: null, message: "No quota data yet. Reload the dashboard first." });
    }
    res.json({ ok: true, quota: latestQuota });
};

/** GET /api/property-detail/:propertyId – per-card detail: top countries, sources, pages */
exports.propertyDetail = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    try {
        const { BetaAnalyticsDataClient } = require("@google-analytics/data");
        const client = new BetaAnalyticsDataClient({ keyFilename: CREDENTIALS_PATH });

        // Helper: run a single realtime report, return empty on failure
        const safe = async (opts) => {
            try { const [r] = await client.runRealtimeReport(opts); return r; }
            catch (e) { console.warn(`[detail] ${propertyId} dim error:`, e.message); return { rows: [] }; }
        };

        // Run three focused realtime reports in parallel (each isolated so one failure doesn't break the rest)
        // NOTE: firstUserSource / sessionSource are NOT valid realtime dimensions.
        //       Use eventName for top events instead.
        const [countryRes, eventRes, pageRes] = await Promise.all([
            safe({
                property: `properties/${propertyId}`,
                dimensions: [{ name: "country" }, { name: "countryId" }],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
            safe({
                property: `properties/${propertyId}`,
                dimensions: [{ name: "eventName" }],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
            safe({
                property: `properties/${propertyId}`,
                dimensions: [{ name: "unifiedScreenName" }],
                metrics: [{ name: "screenPageViews" }],
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
    const { BetaAnalyticsDataClient } = require("@google-analytics/data");
    const client = new BetaAnalyticsDataClient({ keyFilename: CREDENTIALS_PATH });

    const results = await Promise.all(
        properties.map(async (prop) => {
            try {
                const [response] = await client.runRealtimeReport({
                    property: `properties/${prop.id}`,
                    dimensions: [
                        { name: "city" },
                        { name: "country" },
                        { name: "countryId" },
                        { name: "deviceCategory" },
                    ],
                    metrics: [{ name: "activeUsers" }],
                    minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
                    limit: 50,
                });
                return { prop, rows: response.rows || [] };
            } catch (err) {
                // 7 = PERMISSION_DENIED (no access), 3 = INVALID_ARGUMENT (dim conflict)
                if (err.code !== 7 && err.code !== 3) console.warn(`[globe-users] ${prop.site}: ${err.message}`);
                return { prop, rows: [] };
            }
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
        if (cached) return res.json(cached);

        const propCache  = await getCachedProperties();
        const properties = propCache?.properties ?? [];

        const payload = await fetchGlobeUsersData(properties);
        payload.fetchedAt = new Date().toISOString();

        await saveGlobeUsersToCache(payload);
        res.json(payload);
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

/** GET /globe – renders the 3D globe view */
exports.globeView = (req, res) => {
    res.render("globe", {
        head: {
            title: "Pulseboard · Globe",
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
            head: {
                title: "Pulseboard · Analytics",
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

/** Date range presets */
const DATE_RANGES = {
    today: { startDate: "today",      endDate: "today" },
    "7d":  { startDate: "7daysAgo",   endDate: "today" },
    "28d": { startDate: "28daysAgo",  endDate: "today" },
};

/** Card type config – dateRange is the default; overridden by ?range= query param */
const CARD_CONFIGS = {
    "traffic-sources": {
        dimensions: ["sessionSource", "sessionMedium"],
        metrics:    ["sessions"],
        limit:      10,
    },
    "landing-pages": {
        dimensions: ["landingPagePlusQueryString"],
        metrics:    ["sessions"],
        limit:      10,
    },
    "countries": {
        dimensions: ["country"],
        metrics:    ["sessions"],
        limit:      10,
    },
    "events": {
        dimensions: ["eventName"],
        metrics:    ["eventCount"],
        limit:      12,
    },
    "browsers": {
        dimensions: ["browser"],
        metrics:    ["newUsers"],
        limit:      8,
    },
    "page-paths": {
        dimensions: ["pagePath"],
        metrics:    ["screenPageViews"],
        limit:      12,
    },
    "devices": {
        dimensions: ["deviceCategory"],
        metrics:    ["sessions"],
        limit:      5,
    },
    "new-users-by-date": {
        dimensions: ["date"],
        metrics:    ["newUsers", "sessions"],
        limit:      28,
        timeSeries: true,  // render as trend chart; ordered by date asc
    },
    "revenue-by-date": {
        dimensions: ["date"],
        metrics:    ["totalRevenue", "totalAdRevenue"],
        fallbackMetrics: ["purchaseRevenue"],
        limit:      28,
        timeSeries: true,
    },
    "revenue-by-source": {
        dimensions: ["sessionSource", "sessionMedium"],
        metrics:    ["totalRevenue", "totalAdRevenue"],
        fallbackMetrics: ["purchaseRevenue"],
        limit:      10,
    },
};

/** GET /api/analytics-card/:propertyId/:type?range=today|7d|28d */
exports.analyticsCard = async (req, res) => {
    const { propertyId, type } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).json({ error: "Invalid propertyId" });
    }
    const range  = req.query.range || "28d";
    const cfg    = CARD_CONFIGS[type];
    if (!cfg) return res.status(400).json({ error: `Unknown card type: ${type}` });

    const dateRange = DATE_RANGES[range] || DATE_RANGES["28d"];
    // For time-series cards, match the limit to the range
    const limit = cfg.timeSeries
        ? (range === "today" ? 1 : range === "7d" ? 7 : 28)
        : cfg.limit;

    try {
        const { BetaAnalyticsDataClient } = require("@google-analytics/data");
        const client = new BetaAnalyticsDataClient({ keyFilename: CREDENTIALS_PATH });
        const currencyCode = await getPropertyCurrencyCode(propertyId);

        const metricSets = [cfg.metrics];
        if (cfg.fallbackMetrics?.length) metricSets.push(cfg.fallbackMetrics);

        let response = null;
        let metricHeaders = cfg.metrics;
        let lastMetricError = null;

        for (const metricNames of metricSets) {
            const orderBys = cfg.timeSeries
                ? [{ dimension: { dimensionName: "date" }, desc: false }]
                : [{ metric: { metricName: metricNames[0] }, desc: true }];

            try {
                [response] = await client.runReport({
                    property:   `properties/${propertyId}`,
                    dimensions: cfg.dimensions.map(name => ({ name })),
                    metrics:    metricNames.map(name => ({ name })),
                    dateRanges: [dateRange],
                    limit,
                    orderBys,
                });
                metricHeaders = metricNames;
                lastMetricError = null;
                break;
            } catch (err) {
                lastMetricError = err;
                const isRetryableMetricError =
                    err.code === 3 || /metric|revenue|dimension/i.test(err.message || "");
                const isLastMetricSet = metricNames === metricSets[metricSets.length - 1];

                if (!isRetryableMetricError || isLastMetricSet) {
                    throw err;
                }

                console.warn(
                    `[analytics-card] ${type}: ${err.message}. Retrying with fallback metrics.`,
                );
            }
        }

        if (!response && lastMetricError) throw lastMetricError;

        const rows = (response.rows || []).map(row => ({
            dims:    row.dimensionValues.map(d => d.value),
            metrics: row.metricValues.map(m => parseFloat(m.value || "0")),
        }));

        const totals = rows.reduce((acc, r) => {
            r.metrics.forEach((v, i) => { acc[i] = (acc[i] || 0) + v; });
            return acc;
        }, []);

        res.json({
            ok: true, type, rows, totals, range,
            timeSeries: !!cfg.timeSeries,
            dimensionHeaders: cfg.dimensions,
            metricHeaders,
            currencyCode,
        });
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
