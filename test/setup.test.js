const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");
const { getCredentials, clientOptions } = require("../lib/credentials");
const { checkSetup } = require("../lib/setupCheck");
const { parseSetupDoc, loadSetupDoc } = require("../lib/setupDoc");

describe("credentials from env", () => {
    it("turns \\n sequences into newlines and trims the email", () => {
        const c = getCredentials({ GA4_CLIENT_EMAIL: " a@b.iam.gserviceaccount.com ", GA4_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n" });
        expect(c.client_email).to.equal("a@b.iam.gserviceaccount.com");
        expect(c.private_key).to.equal("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    });
    it("keeps real newlines as they are", () => {
        expect(getCredentials({ GA4_CLIENT_EMAIL: "a@b", GA4_PRIVATE_KEY: "x\ny" }).private_key).to.equal("x\ny");
    });
    it("drops one pair of wrapping quotes (docker run --env-file keeps them)", () => {
        const c = getCredentials({ GA4_CLIENT_EMAIL: "'a@b'", GA4_PRIVATE_KEY: '"-----BEGIN PRIVATE KEY-----\\nabc\\n"' });
        expect(c.client_email).to.equal("a@b");
        expect(c.private_key).to.equal("-----BEGIN PRIVATE KEY-----\nabc");
    });
    it("returns null when either value is missing or blank", () => {
        expect(getCredentials({})).to.equal(null);
        expect(getCredentials({ GA4_CLIENT_EMAIL: "a@b" })).to.equal(null);
        expect(getCredentials({ GA4_CLIENT_EMAIL: "  ", GA4_PRIVATE_KEY: "k" })).to.equal(null);
    });
    it("clientOptions throws without env", () => {
        expect(() => clientOptions({})).to.throw();
    });
});

describe("checkSetup", () => {
    it("reports envFound false and both missing keys for an empty env", async () => {
        const r = await checkSetup({ env: {} });
        expect(r.envFound).to.equal(false);
        expect(r.keyAccepted).to.equal(false);
        expect(r.propertyCount).to.equal(null);
        expect(r.missing).to.deep.equal(["GA4_CLIENT_EMAIL", "GA4_PRIVATE_KEY"]);
        expect(r.hint).to.be.a("string");
    });
});

describe("SETUP.md blocks", () => {
    it("parses prompt, manual steps and MCP prompt without fences", () => {
        const d = loadSetupDoc();
        expect(d.prompt).to.match(/^Set up Google Analytics/);
        expect(d.prompt).to.not.include("```");
        expect(d.manual.length).to.be.greaterThan(3);
        expect(d.mcp).to.include("--scope project");
    });
    it("escapes HTML in manual steps and keeps https links", () => {
        const d = parseSetupDoc("<!-- manual:start -->\n1. Open [x](https://e.com) <b>\n<!-- manual:end -->");
        expect(d.manual[0]).to.equal('Open <a href="https://e.com" target="_blank" rel="noopener">x</a> &lt;b&gt;');
    });
});

// Boots the app with blank credentials (shell values win over .env) and checks the gate.
describe("setup gate (not configured)", function () {
    this.timeout(30000);
    const port = 3990 + Math.floor(Math.random() * 9);
    const base = `http://localhost:${port}`;
    let app;

    before(async () => {
        app = spawn(process.execPath, ["app.js"], {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, DEMO: "", GA4_CLIENT_EMAIL: "", GA4_PRIVATE_KEY: "", PORT: String(port) },
            stdio: "ignore",
        });
        for (let i = 0; i < 100; i++) {
            try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* not up yet */ }
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error("server did not start");
    });
    after(() => app && app.kill());

    it("/healthz answers ok with the package version", async () => {
        const j = await (await fetch(`${base}/healthz`)).json();
        expect(j).to.deep.equal({ ok: true, version: require("../package.json").version });
    });
    it("pages redirect to /setup", async () => {
        for (const p of ["/", "/globe", "/analytics"]) {
            const res = await fetch(base + p, { redirect: "manual" });
            expect(res.status, p).to.equal(302);
            expect(res.headers.get("location"), p).to.equal("/setup");
        }
    });
    it("/api/* answers 503 not_configured", async () => {
        const res = await fetch(`${base}/api/quota`);
        expect(res.status).to.equal(503);
        expect(await res.json()).to.deep.equal({ error: "not_configured" });
    });
    it("/setup renders and the status endpoint reports env missing", async () => {
        const html = await (await fetch(`${base}/setup`)).text();
        expect(html).to.include("Connect Google Analytics");
        expect(html).to.include('id="ai"');
        const s = await (await fetch(`${base}/api/setup/status`)).json();
        expect(s.envFound).to.equal(false);
    });
});
