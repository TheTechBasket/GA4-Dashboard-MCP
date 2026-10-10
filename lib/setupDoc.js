/* Reads the setup prompt, manual steps and MCP prompt from SETUP.md (one source for page and docs).
   Blocks sit between <!-- name:start --> and <!-- name:end --> markers. */
const fs = require("fs");
const path = require("path");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function block(md, name) {
	const m = md.match(new RegExp(`<!-- ${name}:start -->([\\s\\S]*?)<!-- ${name}:end -->`));
	if (!m) return "";
	return m[1].trim().replace(/^```\w*\n/, "").replace(/\n```$/, "");
}

/** Markdown list item to safe HTML: escapes text, keeps [label](https://...) links, **bold** and `code`. */
function inline(s) {
	return esc(s)
		.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`)
		.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function parseSetupDoc(md) {
	const manual = block(md, "manual")
		.split("\n")
		.map((l) => l.match(/^\s*\d+\.\s+(.*)$/))
		.filter(Boolean)
		.map((m) => inline(m[1]));
	return { prompt: block(md, "prompt"), manual, mcp: block(md, "mcp") };
}

function loadSetupDoc(file = path.join(__dirname, "..", "SETUP.md")) {
	try {
		return parseSetupDoc(fs.readFileSync(file, "utf8"));
	} catch {
		return { prompt: "", manual: [], mcp: "" };
	}
}

module.exports = { loadSetupDoc, parseSetupDoc };
