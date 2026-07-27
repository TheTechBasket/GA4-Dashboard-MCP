// Builds Google client-library auth options.
// Only credential source: GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account .json file.
function getAuthOptions() {
	if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
		// Google client libraries pick this env var up automatically.
		return {};
	}

	throw new Error(
		"No GA credentials found. Set GOOGLE_APPLICATION_CREDENTIALS in mcp-server/.env to a service-account .json path (see .env.example).",
	);
}

// For REST calls outside the generated GA4 clients (e.g. Indexing API) —
// same credential strategy, but returns a token-bearing auth client.
function getScopedAuthClient(scopes) {
	const { GoogleAuth } = require("google-auth-library");
	const auth = new GoogleAuth({ ...getAuthOptions(), scopes });
	return auth.getClient();
}

module.exports = { getAuthOptions, getScopedAuthClient };
