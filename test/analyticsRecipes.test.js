const { expect } = require("chai");

const {
  getAnalyticsCardConfig,
  getAnalyticsCatalog,
  getDateRange,
} = require("../controllers/analyticsRecipes");

describe("analytics recipes", () => {
  it("returns stable date range presets", () => {
    expect(getDateRange("today")).to.deep.equal({
      startDate: "today",
      endDate: "today",
    });
    expect(getDateRange("unknown")).to.deep.equal({
      startDate: "28daysAgo",
      endDate: "today",
    });
  });

  it("keeps card API config separate from UI catalog metadata", () => {
    const config = getAnalyticsCardConfig("traffic-sources");
    expect(config.dimensions).to.deep.equal(["sessionSource", "sessionMedium"]);
    expect(config.metrics).to.deep.equal(["sessions", "activeUsers"]);
    expect(config.limit).to.equal(10);
    expect(config).to.not.have.property("icon");
  });

  it("exposes catalog cards grouped for the analytics UI", () => {
    const catalog = getAnalyticsCatalog();
    const traffic = catalog.find((card) => card.type === "traffic-sources");

    expect(catalog.length).to.be.greaterThan(5);
    expect(traffic).to.include({
      type: "traffic-sources",
      title: "Traffic Sources",
      group: "Acquisition",
    });
    expect(traffic).to.have.property("icon");
  });
});
