# GA4 Dashboard & MCP

## Design
@DESIGN.md

Every UI change (views/, public/css, new components) MUST follow DESIGN.md: colors, type, radii, spacing tokens. No ad hoc palette or font choices.

## Stack
Express + Handlebars, server-rendered. Client code lives in `public/js/main.js`. Controllers in `controllers/`, routes in `routes/`. The `redesign-archive` local branch holds the abandoned v1.3 client-rendered rewrite: port small pieces from it, never the whole stack.

## Credentials
Env only, never a key file. Both the app and `mcp-server/` read `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` (quoted, `\n` escaped) from the root `.env` through `lib/credentials.js`. Optional: `PSI_API_KEY`, `PORT`.
- Until both are set (or `DEMO=1`), pages redirect to `/setup` and `/api/*` returns 503 `not_configured` (gate in `app.js`). The server re-reads `.env` on each check, so no restart is needed.
- Check: `pnpm setup:check` (exit 0 connected, 1 env missing, 2 key rejected, 3 no properties, 4 GA4 request failed), `GET /api/setup/status`, `GET /healthz`.
- Setup prompt, manual steps and MCP prompt live in `SETUP.md` between markers; `/setup` reads them from there. Edit text there, not in the view.
- One `pnpm install` at the root covers the MCP server (`pnpm mcp`).

## Tests
`pnpm test` runs mocha on `test/**/*.test.js`. Run once before commit, not after every edit.

## Maps
Every map (globe, flat, future) uses India's officially approved boundary (PoK, Gilgit-Baltistan, Aksai Chin, Arunachal Pradesh as India). Source: Natural Earth 10m India POV. Never ship default Natural Earth, world-atlas, or globe.gl country data.
