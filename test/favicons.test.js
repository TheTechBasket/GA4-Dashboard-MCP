const assert = require("assert");
const { pickIconCandidates, imageWidth } = require("../controllers/favicons");
const { letterTile } = require("../public/js/letterTile");

const BASE = "https://example.com/";
const urls = (html) => pickIconCandidates(html, BASE).map((c) => c.url);

describe("favicons", () => {
    it("puts the JSON-LD Organization logo first", () => {
        const html = `<head>
          <link rel="icon" href="/favicon-32.png" sizes="32x32">
          <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Organization","logo":{"@type":"ImageObject","url":"/img/logo.png"}}]}</script>
        </head>`;
        const list = urls(html);
        assert.strictEqual(list[0], "https://example.com/img/logo.png");
        assert.strictEqual(list[1], "https://example.com/favicon-32.png");
    });

    it("orders apple-touch-icon by size, then SVG icon, then larger PNG icons", () => {
        const html = `<link rel="apple-touch-icon" sizes="120x120" href="/a120.png">
          <link rel="apple-touch-icon" sizes="180x180" href="/a180.png">
          <link rel="icon" type="image/png" sizes="16x16" href="/i16.png">
          <link rel="icon" type="image/png" sizes="192x192" href="/i192.png">
          <link rel="icon" type="image/svg+xml" href="/icon.svg">`;
        assert.deepStrictEqual(urls(html).slice(0, 5), [
            "https://example.com/a180.png", "https://example.com/a120.png",
            "https://example.com/icon.svg", "https://example.com/i192.png", "https://example.com/i16.png",
        ]);
    });

    it("falls back to /favicon.ico then Google s2 when the page has no icons", () => {
        assert.deepStrictEqual(urls("<html><head><title>x</title></head></html>"), [
            "https://example.com/favicon.ico",
            "https://www.google.com/s2/favicons?domain=example.com&sz=64",
        ]);
    });

    it("reads PNG width from the header", () => {
        const png = Buffer.alloc(32);
        png.writeUInt32BE(0x89504e47, 0);
        png.writeUInt32BE(16, 16);
        assert.strictEqual(imageWidth(png), 16);
        assert.strictEqual(imageWidth(Buffer.from("<svg/>")), 0);
    });

    it("builds a letter tile from the site name and series color by index", () => {
        assert.deepStrictEqual(letterTile("www.mysite.example", 0), { letter: "M", color: "#4f46e5" });
        assert.deepStrictEqual(letterTile("quiz.example.com", 5), { letter: "Q", color: "#0891b2" });
        assert.strictEqual(letterTile("", 2).letter, "?");
    });
});
