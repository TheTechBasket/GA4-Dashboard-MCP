const { expect } = require("chai");
const { shouldBypass, FRESH_GAP_MS } = require("../controllers/reportCache");

describe("reportCache shouldBypass", () => {
  it("allows one fresh bypass per key per window", () => {
    const t = 1_000_000;
    expect(shouldBypass("test:a", t)).to.equal(true);
    expect(shouldBypass("test:a", t + 1000)).to.equal(false);
    expect(shouldBypass("test:b", t + 1000)).to.equal(true);
    expect(shouldBypass("test:a", t + FRESH_GAP_MS)).to.equal(true);
  });
});
