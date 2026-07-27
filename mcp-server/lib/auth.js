// Builds Google client-library auth options purely from env vars.
// Never reads a checked-in service-account .json file.
function getAuthOptions() {
	if (process.env.GA_SERVICE_ACCOUNT_JSON) {
		const creds = JSON.parse(process.env.GA_SERVICE_ACCOUNT_JSON);
		return { credentials: creds, projectId: creds.project_id };
	}

	if (process.env.GA_CLIENT_EMAIL && process.env.GA_PRIVATE_KEY) {
		return {
			credentials: {
				client_email: process.env.GA_CLIENT_EMAIL,
				// .env files can't hold real newlines — accept the escaped \n form
				private_key: process.env.GA_PRIVATE_KEY.replace(/\\n/g, "\n"),
			},
		};
	}

	if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
		// Google client libraries pick this env var up automatically.
		return {};
	}

	throw new Error(
		"No GA credentials found. Set GA_SERVICE_ACCOUNT_JSON, or GA_CLIENT_EMAIL + GA_PRIVATE_KEY, " +
			"or GOOGLE_APPLICATION_CREDENTIALS in mcp-server/.env (see .env.example).",
	);
}

// For REST calls outside the generated GA4 clients (e.g. Indexing API) —
// same 3 credential strategies, but returns a token-bearing auth client.
function getScopedAuthClient(scopes) {
	const { GoogleAuth } = require("google-auth-library");
	const auth = new GoogleAuth({ ...getAuthOptions(), scopes });
	return auth.getClient();
}

module.exports = { getAuthOptions, getScopedAuthClient };
