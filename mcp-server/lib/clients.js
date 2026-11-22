const { getAuthOptions } = require("./auth");
// DEMO=1: the app's fake clients (8 .example sites), so the server runs with no Google account.
// ponytail: no demo funnel; runFunnelReport fails in demo mode.
const demo = require("../../controllers/demoData");

let adminClient = null;
let dataClient = null;
let alphaDataClient = null;

function getAdminClient() {
	if (!adminClient && demo.enabled()) adminClient = demo.adminClient();
	if (!adminClient) {
		const { AnalyticsAdminServiceClient } = require("@google-analytics/admin");
		adminClient = new AnalyticsAdminServiceClient(getAuthOptions());
	}
	return adminClient;
}

function getDataClient() {
	if (!dataClient && demo.enabled()) dataClient = demo.dataClient();
	if (!dataClient) {
		const { BetaAnalyticsDataClient } = require("@google-analytics/data");
		dataClient = new BetaAnalyticsDataClient(getAuthOptions());
	}
	return dataClient;
}

// Funnel reports are still v1alpha-only on the GA4 Data API.
function getAlphaDataClient() {
	if (!alphaDataClient) {
		const { v1alpha } = require("@google-analytics/data");
		alphaDataClient = new v1alpha.AlphaAnalyticsDataClient(getAuthOptions());
	}
	return alphaDataClient;
}

module.exports = { getAdminClient, getDataClient, getAlphaDataClient };
