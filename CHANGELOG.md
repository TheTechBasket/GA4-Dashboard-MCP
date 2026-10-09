# Changelog

All notable changes to this project are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-09

### Added

- Demo mode (`pnpm demo` or `DEMO=1`): generated data for 8 fictional sites, no Google account needed. A "Demo data" badge shows in the bar.
- `/setup` page: until credentials work, every page opens it. It has a prompt for your AI agent and a live checklist that moves on as each step passes.
- `pnpm setup:check`: checks the credentials from the terminal. Exit codes tell you which step failed.
- `GET /healthz` for uptime checks and the Docker health check.
- Docker image (`node:22-alpine`, runs as a non-root user, health check) and `docker-compose.yml`.
- Release workflow: a `v*` tag builds a multi-arch image (amd64, arm64) to GHCR and creates a GitHub release from this file.
- Home cards: per-minute charts, Open GA4 / Report / Visit site actions and an adjustable spike rule (z-score against a same-hour baseline).
- Report page extras: referrers by platform, source and medium split, suspected bot traffic, revenue and key events.
- Globe: day and night shade, local time on city cards, country flags from `/api/flag/:cc` (cached in `.data/flags`), site favicons (cached in `.data/favicons`).

### Changed

- Credentials come from env only: `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` in the root `.env`, with the read-only Analytics scope. The server re-reads `.env`, so no restart is needed after setup.
- The MCP server is part of the root package. It reads the same `.env`, and one `pnpm install` covers both.
- Globe rebuilt on MapLibre (OpenFreeMap tiles) with a canvas fallback. Every map uses India's official boundary (Natural Earth 10m India POV).
- Analytics page rebuilt: trend chart, what changed, deltas against the previous period.
- Top navigation is a command bar: Ctrl K jump box, page icons, settings menu with theme and GA4 quota. Light theme by default.
- Spike detection uses the usual busiest half hour over 7 days as its baseline, so normal peak hours no longer show as spikes.
- Report stats use GA4 totals. Failed time zone lookups are retried.
- Inter Variable is self-hosted (`public/fonts`). The app makes no Google Fonts requests.
- `ts-node` and `typescript` moved to `dependencies`, because the app loads `.ts` files at run time.

### Removed

- Key-file credentials: `ga4dataapi-*.json`, `GA4_CREDENTIALS_PATH` and `GOOGLE_APPLICATION_CREDENTIALS` are no longer read.
- The separate `mcp-server` package (its own `package.json`, lockfile and `.env`).
- Syne and DM Mono web fonts.

### Upgrading from 1.x

1. Open your service account JSON key (`ga4dataapi-*.json`).
2. Copy `client_email` to `GA4_CLIENT_EMAIL` and `private_key` to `GA4_PRIVATE_KEY` in the root `.env`. Keep the key in double quotes, with the `\n` sequences as they are in the file.
3. Run `pnpm install` at the root, then `pnpm setup:check`.
4. When the check passes, delete the JSON key file and `mcp-server/.env`.
