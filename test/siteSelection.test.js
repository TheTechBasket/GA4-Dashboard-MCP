const assert = require("assert");
const os = require("os"), path = require("path"), fs = require("fs");
process.env.SITES_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sites-")), "sites.json");
const sel = require("../lib/siteSelection");

describe("siteSelection", () => {
    const props = [{ id: "1" }, { id: "2" }, { id: "3" }];
    it("shows all sites before any choice, then only the picked ones; new properties show until unticked", () => {
        assert.strictEqual(sel.filter(props).length, 3);
        sel.save(["2", "99"], props.slice(0, 2)); // 99 is not a property: dropped
        assert.deepStrictEqual(sel.read().selected, ["2"]);
        assert.deepStrictEqual(sel.filter(props).map((p) => p.id), ["2", "3"]);
        const a = sel.annotate(props);
        assert.deepStrictEqual(a.map((p) => [p.selected, p.isNew]), [[false, false], [true, false], [true, true]]);
    });
});
