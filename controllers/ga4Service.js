/**
 * ga4Service.js
 * Centralized, streamlined service for Google Analytics 4 (Data & Admin APIs).
 * Handles client instantiation, valid dimension/metric pairings, error isolation,
 * quota tracking, and fallback defaults.
 */

const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const { AnalyticsAdminServiceClient } = require("@google-analytics/admin");

const demo = require("./demoData");
const { getCredentials, clientOptions } = require("../lib/credentials");
const quotaLedger = require("../lib/quotaLedger");
const { addSpent } = require("../lib/quotaConsole");

/** True when the app can talk to GA4: demo mode, or GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY in env. */
const isConfigured = () => demo.enabled() || !!getCredentials();

let dataClientInstance = null;
let adminClientInstance = null;
let latestQuotaSnapshot = null;

// GA4 Data methods and the quota pool each one spends from.
const QUOTA_POOLS = {
  runReport: "core",
  runPivotReport: "core",
  batchRunReports: "core",
  batchRunPivotReports: "core",
  runRealtimeReport: "realtime",
  runFunnelReport: "funnel",
};

/** Write one response's propertyQuota to the shared ledger (read by the MCP server) and count its cost. */
function noteQuota(property, pool, propertyQuota) {
  if (!propertyQuota) return;
  const id = String(property || "").split("/").pop();
  if (!id) return;
  quotaLedger.record(id, pool, propertyQuota, "dashboard");
  addSpent(pool, propertyQuota.tokensPerHour?.consumed);
}

/**
 * Wrap the real Data client so every report call asks for propertyQuota and records it.
 * Demo mode never gets here: its fake client makes no GA4 calls and writes nothing.
 */
function withQuotaLedger(client) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      const pool = QUOTA_POOLS[prop];
      if (!pool || typeof value !== "function") return value;
      return async (request = {}, ...rest) => {
        const batch = Array.isArray(request.requests);
        const req = batch
          ? { ...request, requests: request.requests.map((r) => ({ ...r, returnPropertyQuota: true })) }
          : { ...request, returnPropertyQuota: true };
        const out = await value.call(target, req, ...rest);
        const res = out?.[0];
        const quota = res?.propertyQuota || res?.reports?.find((r) => r?.propertyQuota)?.propertyQuota
          || res?.pivotReports?.find((r) => r?.propertyQuota)?.propertyQuota;
        noteQuota(request.property, pool, quota);
        return out;
      };
    },
  });
}

/**
 * Get or initialize cached BetaAnalyticsDataClient
 */
function getGA4DataClient() {
  if (!dataClientInstance) {
    dataClientInstance = demo.enabled() ? demo.dataClient() : withQuotaLedger(new BetaAnalyticsDataClient(clientOptions()));
  }
  return dataClientInstance;
}

/**
 * Get or initialize cached AnalyticsAdminServiceClient
 */
function getGA4AdminClient() {
  if (!adminClientInstance) {
    adminClientInstance = demo.enabled() ? demo.adminClient() : new AnalyticsAdminServiceClient(clientOptions());
  }
  return adminClientInstance;
}

/** Drop cached clients so the next call uses the current env credentials (setup flow). */
function resetClients() {
  dataClientInstance = null;
  adminClientInstance = null;
}

/**
 * Returns latest quota snapshot
 */
function getLatestQuota() {
  return latestQuotaSnapshot;
}

/**
 * Valid Realtime Dimensions in GA4:
 * country, countryId, city, deviceCategory, eventName, unifiedScreenName, streamName, platform, minutesAgo
 */
const VALID_REALTIME_DIMENSIONS = new Set([
  "country",
  "countryId",
  "city",
  "deviceCategory",
  "eventName",
  "unifiedScreenName",
  "streamName",
  "platform",
  "operatingSystem",
  "browser",
  "minutesAgo",
]);

/**
 * Safely execute a GA4 Realtime Report for a single property
 */
async function runSafeRealtimeReport({
  propertyId,
  dimensions = [{ name: "streamName" }],
  metrics = [{ name: "activeUsers" }, { name: "screenPageViews" }],
  fallbackMetrics = null,
  minuteRanges = [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
  limit = 50,
  client = null,
}) {
  const gaClient = client || getGA4DataClient();
  
  // Filter out any dimensions not valid for realtime
  const validDims = dimensions.filter((d) => VALID_REALTIME_DIMENSIONS.has(d.name));
  const finalDims = validDims.length > 0 ? validDims : [{ name: "streamName" }];

  const metricSets = [metrics];
  if (fallbackMetrics && fallbackMetrics.length > 0) {
    metricSets.push(fallbackMetrics);
  }

  let lastError = null;

  for (const currentMetrics of metricSets) {
    try {
      const [response] = await gaClient.runRealtimeReport({
        property: `properties/${propertyId}`,
        dimensions: finalDims,
        metrics: currentMetrics,
        minuteRanges,
        limit,
        returnPropertyQuota: true,
      });

      if (response.propertyQuota) {
        const q = response.propertyQuota;
        latestQuotaSnapshot = {
          tokensPerDay: q.tokensPerDay,
          tokensPerHour: q.tokensPerHour,
          tokensPerProjectPerHour: q.tokensPerProjectPerHour,
          concurrentRequests: q.concurrentRequests,
          updatedAt: new Date().toISOString(),
        };
      }

      return {
        propertyId,
        ok: true,
        rows: response.rows || [],
        totals: response.totals || [],
        quota: response.propertyQuota || null,
        usedMetrics: currentMetrics,
      };
    } catch (err) {
      lastError = err;
      const isRetryableMetricError =
        err.code === 3 || /dimension|metric|queried together|INVALID_ARGUMENT/i.test(err.message || "");
      const isLastMetricSet = currentMetrics === metricSets[metricSets.length - 1];
      if (!isRetryableMetricError || isLastMetricSet) break;
    }
  }

  const isPermissionDenied = lastError?.code === 7;
  if (!isPermissionDenied) {
    console.warn(`[ga4Service] Realtime query warning for ${propertyId}: ${lastError?.message}`);
  }
  return {
    propertyId,
    ok: false,
    error: lastError?.message || "Realtime query failed",
    errorCode: lastError?.code,
    isPermissionDenied,
    rows: [],
    totals: [],
  };
}

/**
 * Safely execute a GA4 Historical Report for a single property
 */
async function runSafeHistoricalReport({
  propertyId,
  dimensions = [{ name: "date" }],
  metrics = [{ name: "activeUsers" }, { name: "sessions" }],
  fallbackMetrics = null,
  dateRange = { startDate: "28daysAgo", endDate: "today" },
  limit = 10,
  orderBys = null,
  dimensionFilter = null,
  metricAggregations = null,
}) {
  const client = getGA4DataClient();

  const metricSets = [metrics];
  if (fallbackMetrics && fallbackMetrics.length > 0) {
    metricSets.push(fallbackMetrics);
  }

  let lastError = null;

  for (const currentMetrics of metricSets) {
    try {
      const requestOrder = orderBys || [
        dimensions.some((d) => d.name === "date")
          ? { dimension: { dimensionName: "date" }, desc: false }
          : { metric: { metricName: currentMetrics[0].name }, desc: true },
      ];

      const request = {
        property: `properties/${propertyId}`,
        dimensions,
        metrics: currentMetrics,
        dateRanges: [dateRange],
        limit,
        orderBys: requestOrder,
      };
      if (dimensionFilter) request.dimensionFilter = dimensionFilter;
      if (metricAggregations) request.metricAggregations = metricAggregations;
      const [response] = await client.runReport(request);

      return {
        propertyId,
        ok: true,
        rows: response.rows || [],
        totals: response.totals || [],
        dimensionHeaders: response.dimensionHeaders || [],
        metricHeaders: response.metricHeaders || [],
        usedMetrics: currentMetrics,
      };
    } catch (err) {
      lastError = err;
    }
  }

  console.warn(`[ga4Service] Historical report warning for ${propertyId}: ${lastError?.message}`);
  return {
    propertyId,
    ok: false,
    error: lastError?.message || "Report query failed",
    errorCode: lastError?.code,
    rows: [],
    dimensionHeaders: [],
    metricHeaders: [],
  };
}

module.exports = {
  getGA4DataClient,
  getGA4AdminClient,
  getLatestQuota,
  runSafeRealtimeReport,
  runSafeHistoricalReport,
  isConfigured,
  resetClients,
  withQuotaLedger,
};
