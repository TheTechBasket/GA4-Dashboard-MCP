const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.QUOTA_LEDGER_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cooldown-")), "ledger.json");
process.env.GA4_CLIENT_EMAIL = "sa@example-project-123.iam.gserviceaccount.com";
delete require.cache[require.resolve("../lib/quotaLedger")];
const ledger = require("../lib/quotaLedger");

describe("quota ledger: cooldown after rate-limit and server errors", () => {
	it("ignores errors that are not rate-limit or server errors", () => {
		assert.strictEqual(ledger.block("c1", "core", { code: 3, message: "bad dimension" }, "t"), null);
		assert.strictEqual(ledger.blocked("c1", "core"), null);
	});

	it("pauses one property and pool until the daily reset, naming the GCP project", () => {
		const now = Date.now();
		const c = ledger.block("c1", "core", { code: 8, message: "Exhausted property tokens per day" }, "t", now);
		assert.strictEqual(c.gcpProject, "example-project-123");
		assert.strictEqual(c.until, ledger.nextDailyReset(now).getTime());
		assert.ok(ledger.blocked("c1", "core"));
		assert.strictEqual(ledger.blocked("c2", "core"), null);
		assert.throws(() => { throw ledger.blockedError(c); }, /example-project-123/);
	});

	it("pauses the whole project when the project hourly budget runs out", () => {
		ledger.block("c1", "realtime", { code: 8, message: "Exhausted tokens per project per hour" }, "t");
		assert.ok(ledger.blocked("c9", "funnel"));
	});

	it("pauses an hour from the 5th server error in an hour", () => {
		const now = Date.now() + 2 * 3600 * 1000; // past the project cooldown above
		let c;
		for (let i = 0; i < 5; i++) c = ledger.block("c1", "core", { code: 14, message: "unavailable" }, "t", now + i);
		assert.strictEqual(c.until, now + 3600 * 1000);
	});
});
