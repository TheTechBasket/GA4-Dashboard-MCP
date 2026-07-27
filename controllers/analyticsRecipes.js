const DATE_RANGES = {
  today: { startDate: "today", endDate: "today" },
  "7d": { startDate: "7daysAgo", endDate: "today" },
  "28d": { startDate: "28daysAgo", endDate: "today" },
};

const CARD_CONFIGS = {
  "new-users-by-date": {
    dimensions: ["date"],
    metrics: ["newUsers", "sessions", "totalRevenue"],
    limit: 28,
    timeSeries: true,
  },
  "traffic-sources": {
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["sessions", "activeUsers"],
    limit: 10,
  },
  "landing-pages": {
    dimensions: ["landingPagePlusQueryString"],
    metrics: ["sessions", "activeUsers"],
    limit: 10,
  },
  countries: {
    dimensions: ["country"],
    metrics: ["sessions", "activeUsers"],
    limit: 10,
  },
  events: {
    dimensions: ["eventName"],
    metrics: ["eventCount"],
    limit: 12,
  },
  browsers: {
    dimensions: ["browser"],
    metrics: ["activeUsers", "newUsers"],
    limit: 8,
  },
  "page-paths": {
    dimensions: ["pagePath"],
    metrics: ["screenPageViews", "activeUsers"],
    limit: 12,
  },
  devices: {
    dimensions: ["deviceCategory"],
    metrics: ["sessions", "activeUsers"],
    limit: 5,
  },
  "revenue-by-source": {
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["totalRevenue", "totalAdRevenue"],
    fallbackMetrics: ["purchaseRevenue"],
    limit: 10,
  },
  /* ── New Reports-section cards ─────────────────────────── */
  "source-engagement": {
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["sessions", "activeUsers"],
    limit: 12,
  },
  "hourly-traffic": {
    dimensions: ["dateHour"],
    metrics: ["activeUsers", "screenPageViews"],
    limit: 48,
    timeSeries: true,
  },
  "content-engagement": {
    dimensions: ["pagePath"],
    metrics: ["screenPageViews", "activeUsers"],
    limit: 12,
  },
  "traffic-anomalies": {
    dimensions: ["sessionSource"],
    metrics: ["sessions", "activeUsers"],
    limit: 15,
  },
};

const CARD_CATALOG = [
  {
    type: "new-users-by-date",
    title: "Growth Trend",
    group: "Audience",
    wide: true,
    chartCard: true,
    sub: "New users, sessions, revenue — click a legend item to switch",
    color: "#059669",
    bg: "rgba(5, 150, 105, 0.1)",
    icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  },
  {
    type: "traffic-sources",
    title: "Traffic Sources",
    group: "Acquisition",
    sub: "Sessions and active users by source / medium",
    color: "#1348dc",
    bg: "rgba(19, 72, 220, 0.1)",
    icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  },
  {
    type: "landing-pages",
    title: "Landing Pages",
    group: "Content",
    sub: "Entry pages by sessions and active users",
    color: "#2b7fff",
    bg: "rgba(43, 127, 255, 0.1)",
    icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  },
  {
    type: "countries",
    title: "Countries",
    group: "Audience",
    sub: "Sessions and active users by country",
    color: "#059669",
    bg: "rgba(5, 150, 105, 0.1)",
    icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  },
  {
    type: "events",
    title: "Events",
    group: "Behavior",
    sub: "Event count by event name",
    color: "#d97706",
    bg: "rgba(217, 119, 6, 0.1)",
    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  },
  {
    type: "browsers",
    title: "Browsers",
    group: "Technology",
    sub: "Active and new users by browser",
    color: "#5d636f",
    bg: "rgba(93, 99, 111, 0.12)",
    icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  },
  {
    type: "page-paths",
    title: "Top Pages",
    group: "Content",
    sub: "Pageviews and active users by path",
    color: "#2b7fff",
    bg: "rgba(43, 127, 255, 0.1)",
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  },
  {
    type: "devices",
    title: "Devices",
    group: "Technology",
    sub: "Sessions and active users by device type",
    color: "#1348dc",
    bg: "rgba(19, 72, 220, 0.1)",
    icon: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  },
  {
    type: "revenue-by-source",
    title: "Revenue by Source",
    group: "Revenue",
    sub: "Revenue by traffic source",
    color: "#d97706",
    bg: "rgba(217, 119, 6, 0.1)",
    icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  },
  /* ── New Report cards ──────────────────────────────────── */
  {
    type: "source-engagement",
    title: "Traffic Quality",
    group: "Reports",
    sub: "Sessions and active users by source",
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.1)",
    icon: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  },
  {
    type: "hourly-traffic",
    title: "Hourly Activity",
    group: "Reports",
    wide: true,
    chartCard: true,
    sub: "Active users and pageviews by hour of day",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.1)",
    icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  },
  {
    type: "content-engagement",
    title: "Content Engagement",
    group: "Reports",
    sub: "Top pages by pageviews and avg engagement time",
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.1)",
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  },
  {
    type: "traffic-anomalies",
    title: "Traffic Anomalies",
    group: "Reports",
    sub: "Unusual traffic sources or spikes in activity",
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.1)",
    icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDateRange(range) {
  return clone(DATE_RANGES[range] || DATE_RANGES["28d"]);
}

function getAnalyticsCardConfig(type) {
  const config = CARD_CONFIGS[type];
  return config ? clone(config) : null;
}

function getAnalyticsCatalog() {
  return clone(CARD_CATALOG);
}

module.exports = {
  CARD_CONFIGS,
  CARD_CATALOG,
  DATE_RANGES,
  getAnalyticsCardConfig,
  getAnalyticsCatalog,
  getDateRange,
};
