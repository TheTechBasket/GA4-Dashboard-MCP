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
