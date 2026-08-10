const { expect } = require("chai");
const fs = require("fs");

const home = fs.readFileSync("views/home.hbs", "utf8");
const main = fs.readFileSync("public/js/main.js", "utf8");

describe("homepage property actions", () => {
  it("renders card actions and no standalone alert rail", () => {
    expect(home).to.include("prop-actions-toggle");
    expect(home).to.include("Open analytics");
    expect(home).to.include("Visit website");
    expect(home).to.not.include('id="spikeInsightsContainer"');
  });

  it("does not render the removed spike rail in client code", () => {
    expect(main).to.not.include("spikeInsightsContainer");
    expect(main).to.include("prop-alert");
  });
});
