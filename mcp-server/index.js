#!/usr/bin/env node
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { getAdminClient, getDataClient, getAlphaDataClient } = require("./lib/clients");
const { getScopedAuthClient } = require("./lib/auth");
const cache = require("./lib/cache");
const rateLimit = require("./lib/rateLimit");

const server = new McpServer({ name: "ga4-mcp-server", version: "0.1.0" });

const propertyName = (propertyId) => `properties/${propertyId}`;

/** Cache-then-rate-limit-then-call wrapper shared by every GA4 tool. */
async function cachedCall({ toolName, params, tier, family, fn }) {
	const hit = cache.get(toolName, params, tier);
	if (hit) {
		return { ...hit.value, _cache: { hit: true, ageSeconds: hit.ageSeconds, ttlSeconds: hit.ttlSeconds } };
	}
	const value = await rateLimit.withRateLimit(family, fn);
	cache.set(toolName, params, tier, value);
	return { ...value, _cache: { hit: false, ageSeconds: 0, ttlSeconds: cache.TTL_SECONDS[tier] } };
}

function asText(value) {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Account + property info
// ---------------------------------------------------------------------------

server.registerTool(
	"get_account_summaries",
	{ description: "Lists every GA4 account and the properties under each one, for the credentials in use." },
	async () => {
		const result = await cachedCall({
			toolName: "get_account_summaries",
			params: {},
			tier: "metadata",
			family: "admin",
			fn: async () => {
				const [summaries] = await getAdminClient().listAccountSummaries({});
				return {
					accounts: summaries.map((s) => ({
						account: s.account,
						displayName: s.displayName,
						properties: (s.propertySummaries || []).map((p) => ({
							property: p.property,
							displayName: p.displayName,
							propertyType: p.propertyType,
						})),
					})),
				};
			},
		});
		return asText(result);
	},
);

/** Shared by the get_property_details tool and the currencyCode lookup on revenue reports below. */
async function getPropertyDetailsCached(propertyId) {
	return cachedCall({
		toolName: "get_property_details",
		params: { propertyId },
		tier: "metadata",
		family: "admin",
		fn: async () => {
			const [property] = await getAdminClient().getProperty({ name: propertyName(propertyId) });
			return {
				name: property.name,
				displayName: property.displayName,
				timeZone: property.timeZone,
				currencyCode: property.currencyCode,
				industryCategory: property.industryCategory,
				propertyType: property.propertyType,
				createTime: property.createTime,
				parent: property.parent,
			};
		},
	});
}

server.registerTool(
	"get_property_details",
	{
		description: "Returns details (display name, time zone, currency, industry, create time) for one GA4 property.",
		inputSchema: { propertyId: z.string().describe("Numeric GA4 property ID, e.g. 257579250") },
	},
	async ({ propertyId }) => asText(await getPropertyDetailsCached(propertyId)),
);

server.registerTool(
	"list_google_ads_links",
	{
		description: "Lists the Google Ads accounts linked to a GA4 property.",
		inputSchema: { propertyId: z.string().describe("Numeric GA4 property ID") },
	},
	async ({ propertyId }) => {
		const result = await cachedCall({
			toolName: "list_google_ads_links",
			params: { propertyId },
			tier: "metadata",
			family: "admin",
			fn: async () => {
				const [links] = await getAdminClient().listGoogleAdsLinks({ parent: propertyName(propertyId) });
				return {
					links: links.map((l) => ({
						name: l.name,
						customerId: l.customerId,
						canManageClients: l.canManageClients,
						createTime: l.createTime,
					})),
				};
			},
		});
		return asText(result);
	},
);

// ---------------------------------------------------------------------------
// Core + funnel reports
// ---------------------------------------------------------------------------

server.registerTool(
	"run_report",
	{
		description:
			"Runs a GA4 core report: dimensions x metrics over a date range. Mirrors the Data API runReport request shape.",
		inputSchema: {
			propertyId: z.string().describe("Numeric GA4 property ID"),
			startDate: z.string().describe("e.g. 7daysAgo, 28daysAgo, today, or YYYY-MM-DD"),
			endDate: z.string().describe("e.g. today, yesterday, or YYYY-MM-DD"),
			dimensions: z.array(z.string()).describe("e.g. [\"country\", \"sessionSource\"]"),
			metrics: z.array(z.string()).describe("e.g. [\"sessions\", \"activeUsers\"]"),
			limit: z.number().int().positive().max(1000).default(10),
			orderBys: z
				.array(
					z.object({
						metric: z.string().optional().describe("Metric name to sort by, e.g. \"totalAdRevenue\""),
						dimension: z.string().optional().describe("Dimension name to sort by instead of a metric"),
						desc: z.boolean().default(true),
					}),
				)
				.optional()
				.describe("Sort rows server-side instead of pulling everything and sorting client-side, e.g. top pages by revenue"),
		},
	},
	async ({ propertyId, startDate, endDate, dimensions, metrics, limit, orderBys }) => {
		const params = { propertyId, startDate, endDate, dimensions, metrics, limit, orderBys };
		const result = await cachedCall({
			toolName: "run_report",
			params,
			tier: "report",
			family: "data",
			fn: async () => {
				const [response] = await getDataClient().runReport({
					property: propertyName(propertyId),
					dateRanges: [{ startDate, endDate }],
					dimensions: dimensions.map((name) => ({ name })),
					metrics: metrics.map((name) => ({ name })),
					limit,
					orderBys: (orderBys || []).map((o) => ({
						...(o.metric ? { metric: { metricName: o.metric } } : { dimension: { dimensionName: o.dimension } }),
						desc: o.desc,
					})),
					returnPropertyQuota: true,
				});
				const { currencyCode } = await getPropertyDetailsCached(propertyId);
				return {
					rows: (response.rows || []).map((row) => ({
						dimensions: row.dimensionValues.map((d) => d.value),
						metrics: row.metricValues.map((m) => m.value),
					})),
					rowCount: response.rowCount,
					currencyCode,
					quota: response.propertyQuota || null,
				};
			},
		});
		return asText(result);
	},
);

server.registerTool(
	"run_funnel_report",
	{
		description:
			"Runs a GA4 funnel report: how many users completed each step of an ordered event sequence, over a date range.",
		inputSchema: {
			propertyId: z.string().describe("Numeric GA4 property ID"),
			startDate: z.string().describe("e.g. 7daysAgo or YYYY-MM-DD"),
			endDate: z.string().describe("e.g. today or YYYY-MM-DD"),
			steps: z
				.array(z.object({ name: z.string(), eventName: z.string() }))
				.min(2)
				.describe("Ordered funnel steps, each matched by a single eventName"),
		},
	},
	async ({ propertyId, startDate, endDate, steps }) => {
		const params = { propertyId, startDate, endDate, steps };
		const result = await cachedCall({
			toolName: "run_funnel_report",
			params,
			tier: "report",
			family: "alpha",
			fn: async () => {
				const [response] = await getAlphaDataClient().runFunnelReport({
					property: propertyName(propertyId),
					dateRanges: [{ startDate, endDate }],
					funnel: {
						steps: steps.map((step) => ({
							name: step.name,
							filterExpression: {
								funnelFieldFilter: {
									fieldName: "eventName",
									stringFilter: { value: step.eventName },
								},
							},
						})),
					},
				});
				const headers = response.funnelTable.dimensionHeaders.map((h) => h.name);
				return {
					dimensionHeaders: headers,
					rows: response.funnelTable.rows.map((row) => ({
						dimensions: row.dimensionValues.map((d) => d.value),
						metrics: row.metricValues.map((m) => m.value),
					})),
				};
			},
		});
		return asText(result);
	},
);

server.registerTool(
	"get_custom_dimensions_and_metrics",
	{
		description: "Lists the custom dimensions and custom metrics defined on a GA4 property.",
		inputSchema: { propertyId: z.string().describe("Numeric GA4 property ID") },
	},
	async ({ propertyId }) => {
		const result = await cachedCall({
			toolName: "get_custom_dimensions_and_metrics",
			params: { propertyId },
			tier: "metadata",
			family: "data",
			fn: async () => {
				const [meta] = await getDataClient().getMetadata({ name: `${propertyName(propertyId)}/metadata` });
				const pluck = (d) => ({ apiName: d.apiName, uiName: d.uiName, description: d.description });
				return {
					customDimensions: meta.dimensions.filter((d) => d.customDefinition).map(pluck),
					customMetrics: meta.metrics.filter((m) => m.customDefinition).map(pluck),
				};
			},
		});
		return asText(result);
	},
);

// ---------------------------------------------------------------------------
// Realtime report
// ---------------------------------------------------------------------------

server.registerTool(
	"run_realtime_report",
	{
		description: "Runs a GA4 realtime report covering the last N minutes (max 30, per the Data API).",
		inputSchema: {
			propertyId: z.string().describe("Numeric GA4 property ID"),
			dimensions: z.array(z.string()).default(["country"]),
			metrics: z.array(z.string()).default(["activeUsers"]),
			minutesAgo: z.number().int().min(1).max(30).default(29),
			limit: z.number().int().positive().max(1000).default(10),
		},
	},
	async ({ propertyId, dimensions, metrics, minutesAgo, limit }) => {
		const params = { propertyId, dimensions, metrics, minutesAgo, limit };
		const result = await cachedCall({
			toolName: "run_realtime_report",
			params,
			tier: "realtime",
			family: "realtime",
			fn: async () => {
				const [response] = await getDataClient().runRealtimeReport({
					property: propertyName(propertyId),
					dimensions: dimensions.map((name) => ({ name })),
					metrics: metrics.map((name) => ({ name })),
					minuteRanges: [{ startMinutesAgo: minutesAgo, endMinutesAgo: 0 }],
					limit,
					returnPropertyQuota: true,
				});
				const { currencyCode } = await getPropertyDetailsCached(propertyId);
				return {
					rows: (response.rows || []).map((row) => ({
						dimensions: row.dimensionValues.map((d) => d.value),
						metrics: row.metricValues.map((m) => m.value),
					})),
					currencyCode,
					quota: response.propertyQuota || null,
				};
			},
		});
		return asText(result);
	},
);

// ---------------------------------------------------------------------------
// PageSpeed Insights — real-world page speed, e.g. spot-check after a deploy
// ---------------------------------------------------------------------------

server.registerTool(
	"run_pagespeed_insights",
	{
		description:
			"Runs a PageSpeed Insights audit for one URL (Lighthouse performance/SEO/accessibility/best-practices scores).",
		inputSchema: {
			url: z.string().url(),
			strategy: z.enum(["mobile", "desktop"]).default("mobile"),
			categories: z
				.array(z.enum(["performance", "accessibility", "best-practices", "seo"]))
				.default(["performance"]),
		},
	},
	async ({ url, strategy, categories }) => {
		if (!process.env.PSI_API_KEY) {
			return asText({ error: "PSI_API_KEY not set — see mcp-server/.env.example" });
		}
		const params = { url, strategy, categories };
		const result = await cachedCall({
			toolName: "run_pagespeed_insights",
			params,
			tier: "psi",
			family: "psi",
			fn: async () => {
				const qs = new URLSearchParams({ url, strategy, key: process.env.PSI_API_KEY });
				categories.forEach((c) => qs.append("category", c));
				const res = await fetch(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
				const body = await res.json();
				if (!res.ok) {
					const err = new Error(body.error?.message || `PSI request failed (${res.status})`);
					err.code = res.status === 429 ? 8 : undefined; // map to rate-limit retry path
					throw err;
				}
				const categoryScores = {};
				for (const [key, cat] of Object.entries(body.lighthouseResult?.categories || {})) {
					categoryScores[key] = cat.score != null ? Math.round(cat.score * 100) : null;
				}
				const audits = body.lighthouseResult?.audits || {};
				const metric = (id) => audits[id]?.displayValue ?? null;
				return {
					url: body.id,
					strategy,
					scores: categoryScores,
					coreWebVitals: {
						lcp: metric("largest-contentful-paint"),
						cls: metric("cumulative-layout-shift"),
						tbt: metric("total-blocking-time"),
						fcp: metric("first-contentful-paint"),
					},
				};
			},
		});
		return asText(result);
	},
);

// ---------------------------------------------------------------------------
// Web Search Indexing API — request a (re)crawl right after deploying changes
// ---------------------------------------------------------------------------

server.registerTool(
	"request_indexing",
	{
		description:
			"Notifies Google's Indexing API that a URL changed, so it can be recrawled sooner. " +
			"Requires the GA service account to be added as an Owner of the URL's property in Search Console — " +
			"otherwise this returns a 403 ownership error. Not cached (it's an action, not a query).",
		inputSchema: {
			url: z.string().url(),
			type: z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED"),
		},
	},
	async ({ url, type }) => {
		const result = await rateLimit.withRateLimit("indexing", async () => {
			const client = await getScopedAuthClient(["https://www.googleapis.com/auth/indexing"]);
			const res = await client.request({
				url: "https://indexing.googleapis.com/v3/urlNotifications:publish",
				method: "POST",
				data: { url, type },
			});
			return res.data;
		}).catch((err) => ({
			error: err.response?.data?.error?.message || err.message,
			hint: "Add the service account as an Owner in Search Console for this URL's property, then retry.",
		}));
		return asText(result);
	},
);

// ---------------------------------------------------------------------------
// Inspection utilities — no GA4 API calls
// ---------------------------------------------------------------------------

server.registerTool(
	"get_cache_status",
	{ description: "Lists every cached tool response on disk: which tool, params, age, TTL, and whether it's still fresh." },
	async () => asText({ entries: cache.status() }),
);

server.registerTool(
	"get_rate_limit_status",
	{ description: "Shows the current local throttle state (requests/sec limit and tokens available) per GA4 API family." },
	async () => asText(rateLimit.status()),
);

// ---------------------------------------------------------------------------

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("ga4-mcp-server running on stdio");
}

main().catch((err) => {
	console.error("Fatal error starting ga4-mcp-server:", err);
	process.exit(1);
});
