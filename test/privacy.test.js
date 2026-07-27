const { expect } = require("chai");

const {
  redactDomain,
  redactUrl,
  stripSensitiveGlobeUsersPayload,
} = require("../controllers/privacy");

describe("privacy helpers", () => {
  it("redacts URLs to host-only labels without path or query leakage", () => {
    expect(redactUrl("https://www.example.com/private/path?token=abc")).to.equal(
      "example.com",
    );
    expect(redactUrl("not a url")).to.equal("not a url");
    expect(redactUrl(null)).to.equal(null);
  });

  it("normalizes domains for private display", () => {
    expect(redactDomain("www.news.example.com")).to.equal("news.example.com");
    expect(redactDomain("https://www.example.com/path")).to.equal("example.com");
  });

  it("removes raw URLs from globe payload properties", () => {
    const payload = {
      totalActiveUsers: 4,
      properties: [
        {
          site: "Client Website",
          domain: "www.client.example",
          url: "https://www.client.example/secret?utm=private",
          count: 4,
        },
      ],
      users: [
        {
          city: "London",
          prop: "Client Website",
          url: "https://www.client.example/page",
          count: 4,
        },
      ],
    };

    const stripped = stripSensitiveGlobeUsersPayload(payload);

    expect(stripped.properties[0]).to.deep.equal({
      site: "Client Website",
      domain: "client.example",
      count: 4,
    });
    expect(stripped.users[0]).to.not.have.property("url");
    expect(payload.properties[0].url).to.equal(
      "https://www.client.example/secret?utm=private",
    );
  });
});
