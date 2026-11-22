const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

// Boots the MCP server with DEMO=1 and no credentials, and runs the calls the long-form video shows.
describe("MCP server demo mode", function () {
    this.timeout(20000);
    let client;
    const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-demo-")), "ledger.json");

    before(async () => {
        const env = { ...process.env, DEMO: "1", GA4_CLIENT_EMAIL: "", GA4_PRIVATE_KEY: "", QUOTA_LEDGER_FILE: ledger };
        client = new Client({ name: "test", version: "0" });
        await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, "..", "mcp-server", "index.js")], env }));
    });
    after(() => client && client.close());

    const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

    it("lists demo properties and runs realtime and source reports", async () => {
        const { accounts } = await call("get_account_summaries");
        const props = accounts[0].properties;
        assert.strictEqual(props.length, 8);
        const id = props[0].property.split("/")[1];
        const rt = await call("run_realtime_report", { propertyId: id, dimensions: ["country"], metrics: ["activeUsers"] });
        assert.ok(JSON.stringify(rt).includes("activeUsers"));
        const src = await call("run_report", { propertyId: id, startDate: "today", endDate: "today", dimensions: ["sessionSource"], metrics: ["sessions"], limit: 5 });
        assert.ok(JSON.stringify(src).includes("sessions"));
    });
});
