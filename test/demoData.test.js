const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");

// Boots the real app in demo mode (DEMO=1, no credentials) and checks the endpoints the pages call.
describe("demo mode", function () {
    this.timeout(30000);
    const port = 3900 + Math.floor(Math.random() * 90);
    const base = `http://localhost:${port}`;
    let app;
    const get = async (u) => {
        const res = await fetch(base + u);
        expect(res.status, u).to.equal(200);
        return res.headers.get("content-type").includes("json") ? res.json() : res.text();
    };

    before(async () => {
        app = spawn(process.execPath, ["app.js"], {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, DEMO: "1", PORT: String(port) },
            stdio: "ignore",
        });
        for (let i = 0; i < 100; i++) {
            try {
                const nav = await (await fetch(`${base}/api/nav-index`)).json();
                if (nav.sites?.length) return;
            } catch { /* not up yet */ }
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error("demo server did not start");
    });
    after(() => app && app.kill());

    it("renders the three pages with the Demo data badge", async () => {
        for (const p of ["/", "/globe", "/analytics"]) expect(await get(p)).to.include("Demo data");
    });

    it("realtime-all lists 8 fictional properties with live users", async () => {
        let j = await get("/api/realtime-all");
        for (let i = 0; i < 20 && j.cached === false && !j.data?.some((d) => d.activeUsers); i++) {
            await new Promise((r) => setTimeout(r, 300));
            j = await get("/api/realtime-all");
        }
        expect(j.ok).to.equal(true);
        expect(j.data).to.have.length(8);
        for (const d of j.data) {
            expect(d.domain).to.match(/\.example$/);
            expect(d).to.include.keys("propertyId", "siteName", "activeUsers", "pageViews", "series");
        }
        const total = j.data.reduce((a, d) => a + d.activeUsers, 0);
        expect(total).to.be.within(50, 3000);
    });

    it("globe-users has cities with coordinates, a feed and countries", async () => {
        const j = await get("/api/globe-users");
        expect(j.cities.length).to.be.greaterThan(0);
        expect(j.countries.length).to.be.greaterThan(0);
        expect(j.feed.length).to.be.greaterThan(0);
        expect(j.properties).to.have.length(8);
    });

    it("spikes flags the spiking property", async () => {
        const j = await get("/api/spikes");
        expect(j.ok).to.equal(true);
        expect(j.spikes.map((s) => s.siteName)).to.include("Pixel Recipes");
    });

    it("analytics card and reports return rows with previous-period values", async () => {
        const card = await get("/api/analytics-card/311000101/traffic-sources?range=28d");
        expect(card.ok).to.equal(true);
        expect(card.rows.length).to.be.greaterThan(3);
        expect(card.rows[0]).to.include.keys("dims", "metrics", "prev");
        const rep = await get("/api/analytics-reports/311000101?range=7d");
        expect(rep.ok).to.equal(true);
        expect(rep.topPages.length).to.be.greaterThan(0);
    });

    it("quota and favicon answer without Google", async () => {
        expect((await get("/api/quota")).quota.tokensPerDay.remaining).to.be.a("number");
        expect(await get("/api/favicon/311000101")).to.include("<svg");
    });
});
