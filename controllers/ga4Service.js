/**
 * ga4Service.js
 * Centralized, streamlined service for Google Analytics 4 (Data & Admin APIs).
 * Handles client instantiation, valid dimension/metric pairings, error isolation,
 * quota tracking, and fallback defaults.
 */

const fs = require("fs");
const path = require("path");
const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const { AnalyticsAdminServiceClient } = require("@google-analytics/admin");

const REPO_ROOT = path.join(__dirname, "..");

/**
 * Resolve the GA4 service-account key file. The filename is hash-suffixed
 * (ga4dataapi-<hash>.json) so it can't be hardcoded — glob for it instead.
 * Returns null if no matching key file is present (first-run / not configured).
 */
function resolveCredentialsPath() {
  if (process.env.GA4_CREDENTIALS_PATH && fs.existsSync(process.env.GA4_CREDENTIALS_PATH)) {
    return process.env.GA4_CREDENTIALS_PATH;
  }
  try {
    const match = fs.readdirSync(REPO_ROOT).find(
      (f) => /^ga4dataapi-.+\.json$/.test(f) && f !== "ga4dataapi.example.json"
    );
    return match ? path.join(REPO_ROOT, match) : null;
  } catch {
    return null;
  }
}

const CREDENTIALS_PATH = resolveCredentialsPath();

let dataClientInstance = null;
let adminClientInstance = null;
let latestQuotaSnapshot = null;

/**
 * Get or initialize cached BetaAnalyticsDataClient
 */
function getGA4DataClient(keyFilename = CREDENTIALS_PATH) {
  if (!dataClientInstance) {
    dataClientInstance = new BetaAnalyticsDataClient({ keyFilename });
  }
  return dataClientInstance;
}

/**
 * Get or initialize cached AnalyticsAdminServiceClient
 */
function getGA4AdminClient(keyFilename = CREDENTIALS_PATH) {
  if (!adminClientInstance) {
    adminClientInstance = new AnalyticsAdminServiceClient({ keyFilename });
  }
  return adminClientInstance;
}

/**
 * Returns latest quota snapshot
 */
function getLatestQuota() {
  return latestQuotaSnapshot;
}

/**
 * Valid Realtime Dimensions in GA4:
 * country, countryId, city, deviceCategory, eventName, unifiedScreenName, streamName, platform
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
  keyPath = CREDENTIALS_PATH,
  client = null,
}) {
  const gaClient = client || getGA4DataClient(keyPath);
  
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
  keyPath = CREDENTIALS_PATH,
}) {
  const client = getGA4DataClient(keyPath);

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

      const [response] = await client.runReport({
        property: `properties/${propertyId}`,
        dimensions,
        metrics: currentMetrics,
        dateRanges: [dateRange],
        limit,
        orderBys: requestOrder,
      });

      return {
        propertyId,
        ok: true,
        rows: response.rows || [],
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
  resolveCredentialsPath,
  CREDENTIALS_PATH,
};
