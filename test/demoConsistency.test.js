const { expect } = require("chai");
const demo = require("../controllers/demoData");

// The same sessions must add up the same in every report (GA4 long-form run 3 showed 1103 vs 433).
describe("demo data consistency", () => {
    const client = demo.dataClient();
    const property = "properties/311000103"; // Pixel Recipes, the spiking site
    const total = async (dim, filter, extra = {}) => {
        const [r] = await client.runReport({ property, dateRanges: [{ startDate: "today", endDate: "today" }], dimensions: [{ name: dim }],
            metrics: [{ name: "sessions" }], dimensionFilter: { filter: { fieldName: filter[0], stringFilter: { matchType: "CONTAINS", value: filter[1] } } }, ...extra });
        return r.rows.reduce((a, x) => a + Number(x.metricValues[0].value), 0);
    };

    it("reddit referrer sessions equal reddit source sessions", async () => {
        const ref = await total("pageReferrer", ["pageReferrer", "reddit"]);
        const src = await total("sessionSource", ["sessionSource", "reddit"]);
        expect(ref).to.be.above(0);
        expect(Math.abs(ref - src)).to.be.at.most(2);
    });

    it("the viral page gets most of today's reddit sessions", async () => {
        const [r] = await client.runReport({ property, dateRanges: [{ startDate: "today", endDate: "today" }],
            dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }],
            dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "EXACT", value: "reddit.com" } } } });
        expect(r.rows[0].dimensionValues[0].value).to.contain("gochujang");
    });

    it("engagement rate varies by page within one source", async () => {
        const [r] = await client.runReport({ property, dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
            dimensions: [{ name: "landingPage" }], metrics: [{ name: "engagementRate" }],
            dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "EXACT", value: "google" } } } });
        expect(new Set(r.rows.map((x) => x.metricValues[0].value)).size).to.be.above(3);
    });
});
