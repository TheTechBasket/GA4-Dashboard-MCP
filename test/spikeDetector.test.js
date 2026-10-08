const { expect } = require("chai");
const { classifyReferralSource } = require("../controllers/spikeDetector");

describe("spike detector referral classification", () => {
  it("classifies known referral sources", () => {
    expect(classifyReferralSource("news.ycombinator.com")).to.include({
      category: "hn",
      name: "Hacker News",
    });
    expect(classifyReferralSource("t.co")).to.include({
      category: "twitter",
      name: "X / Twitter",
    });
  });

  it("classifies empty and direct sources as direct traffic", () => {
    expect(classifyReferralSource("(direct)")).to.include({
      category: "direct",
      name: "Direct / Bookmark",
    });
    expect(classifyReferralSource("")).to.include({
      category: "direct",
      name: "Direct / Bookmark",
    });
  });
});

describe("spike detector baseline", () => {
  const row = (dateHour, users) => ({
    dimensionValues: [{ value: dateHour }],
    metricValues: [{ value: String(users) }],
  });

  it("averages each day's busiest hour, halved for the 30-minute window", () => {
    const { peakHalfHourBaseline } = require("../controllers/spikeDetector");
    const rows = [row("2026100810", 40), row("2026100803", 5), row("2026100910", 80), row("2026100902", 2)];
    expect(peakHalfHourBaseline(rows)).to.equal(30);
  });

  it("falls back to 1 with no history", () => {
    const { peakHalfHourBaseline } = require("../controllers/spikeDetector");
    expect(peakHalfHourBaseline([])).to.equal(1);
  });
});
