# GA4 Dashboard & MCP

## Design
@DESIGN.md

Every UI change (views/, public/css, new components) MUST follow DESIGN.md: colors, type, radii, spacing tokens. No ad hoc palette or font choices.

## Stack
Express + Handlebars, server-rendered. Client code lives in `public/js/main.js`. Controllers in `controllers/`, routes in `routes/`. The `redesign-archive` local branch holds the abandoned v1.3 client-rendered rewrite: port small pieces from it, never the whole stack.

## Credentials
JSON key file only, no env-based inline credentials.
- Main app: drop `ga4dataapi-*.json` in project root, auto-detected by filename, `.env` optional (only needed to override path via `GA4_CREDENTIALS_PATH`).
- `mcp-server/`: no auto-detect. `GOOGLE_APPLICATION_CREDENTIALS` must be set explicitly, either in `mcp-server/.env` or via `claude mcp add -e GOOGLE_APPLICATION_CREDENTIALS=...`.

## Tests
`pnpm test` runs mocha on `test/**/*.test.js`. Run once before commit, not after every edit.

## Maps
Every map (globe, flat, future) uses India's officially approved boundary (PoK, Gilgit-Baltistan, Aksai Chin, Arunachal Pradesh as India). Source: Natural Earth 10m India POV. Never ship default Natural Earth, world-atlas, or globe.gl country data.
