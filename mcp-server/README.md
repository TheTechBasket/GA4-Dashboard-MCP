# ga4-mcp-server

Standalone MCP server exposing Google Analytics Admin + Data API tools. Lives
in its own folder with its own `package.json` — installing/running it never
touches the root Pulseboard app's dependencies or runtime.

## Setup

```bash
cd mcp-server
pnpm install
```

Credentials: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` — points at a
service-account key file on disk, can live anywhere, e.g. the existing
`ga4dataapi-*.json` in the repo root.

Either put this in `mcp-server/.env` (gitignored, copy from `.env.example`),
or set it as an `env` value when you register the server with Claude
(`claude mcp add`, or the MCP settings UI) — both work, env vars set by the
MCP client take priority over `.env`.

## Registering with Claude Code

Registered at **user scope** (available in every project, not just this repo):

```bash
claude mcp add ga4 -s user -e GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json -- node /absolute/path/to/mcp-server/index.js
```

For this local checkout, the command shape is:

```bash
claude mcp add ga4 -s user -- node /absolute/path/to/mcp-server/index.js
```

If credentials are not already in `mcp-server/.env`, include the key path:

```bash
claude mcp add ga4 -s user -e GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json -- node /absolute/path/to/mcp-server/index.js
```

`claude mcp list` should show `ga4` as Connected. Tools only appear in a
session after a restart — Claude Code doesn't hot-reload newly registered
MCP servers mid-session.

## Security note on credentials

`GOOGLE_APPLICATION_CREDENTIALS` only ever holds a **file path** in Claude's
config (`~/.claude.json` for user scope) — the private key itself stays in
the one `.json` file on disk and is never duplicated into config or `.env`.

## Tools

| Tool | Purpose |
|---|---|
| `get_account_summaries` | All GA4 accounts + properties visible to the credentials |
| `get_property_details` | Display name, timezone, currency, etc. for one property |
| `list_google_ads_links` | Google Ads accounts linked to a property |
| `run_report` | Core report: dimensions x metrics over a date range, with optional `orderBys` (sort server-side, e.g. top pages by revenue, instead of pulling every row and sorting client-side) |
| `run_funnel_report` | Step-by-step funnel completion over a date range |
| `get_custom_dimensions_and_metrics` | Custom dimensions/metrics defined on a property |
| `run_realtime_report` | Active users right now, last up to 30 minutes |
| `run_pagespeed_insights` | Lighthouse scores + Core Web Vitals for one URL — needs `PSI_API_KEY` |
| `request_indexing` | Ask Google to recrawl a URL after a deploy — needs Search Console owner access, see below |
| `get_cache_status` | What's cached, how old, still fresh? (no API call) |
| `get_rate_limit_status` | Current local throttle tokens per API family (no API call) |

Search Console *data* (queries, clicks, impressions) is intentionally not
duplicated here — use the existing SEO Gets MCP for that. This server only
adds the one-off Indexing API action.

### PageSpeed Insights setup

Needs a `PSI_API_KEY` — a plain API key (not the GA service account), since
PSI auth is key-based, not OAuth. The GCP project already has one
(`pagespeed`, restricted to `pagespeedonline.googleapis.com`):

```bash
gcloud services api-keys get-key-string \
  projects/<PROJECT_ID>/locations/global/keys/<KEY_ID>
```

Put the output in `mcp-server/.env` as `PSI_API_KEY=...` or in the `claude mcp add -e` flags.

### Indexing API setup

The GA service account (`<SERVICE_ACCOUNT_EMAIL>`)
currently has **no Search Console access on any property** — confirmed live: `request_indexing` returns
`403 Permission denied. Failed to verify the URL ownership.` until you fix this.

To enable it per site: Search Console → that property → Settings → Users and
permissions → Add user → paste the service account email above → **Owner**.
Do this for each domain you want `request_indexing` to work on.

## Rate limiting

Each API family (`admin`, `data`, `realtime`, `alpha`/funnel, `psi`, `indexing`)
has its own local token bucket (defaults: 2/8/4/2/1/0.1 req/sec — override via
`RATE_LIMIT_*_RPS` env vars). `indexing` defaults to 1 request every 10s as a
burst guard — Google's real cap there is ~200/day, not a per-second rate, and
this server doesn't track that daily count locally. Calls that exceed it are queued and delayed,
never dropped. On top of that, every `run_report` / `run_realtime_report`
response includes Google's own live `quota` object (tokens left today/this
hour, from `returnPropertyQuota: true`) — that's the authoritative number,
the local bucket is just a safety throttle.

## Caching

Every tool response is cached to `mcp-server/.cache/` (gitignored) and
memory, keyed by tool name + params. TTL tiers (override via
`CACHE_TTL_*_SEC`):

- `realtime` — 60s (active users change by the minute)
- `report` — 1h (historical reports rarely change mid-day)
- `metadata` — 6h (account/property/custom-dimension info changes rarely)
- `psi` — 30min (a real Lighthouse run is expensive; long enough to avoid
  re-running on every question, short enough to catch a post-deploy regression)

`request_indexing` is a write action, not cached.

Every response carries a `_cache: { hit, ageSeconds, ttlSeconds }` field so
the caller always knows whether the data is fresh or served from cache.
`get_cache_status` inspects the whole cache without calling any API.

`run_report` and `run_realtime_report` also carry `currencyCode` (the
property's own currency, piggybacked on the cached `get_property_details`
metadata call) — revenue metrics like `totalRevenue`/`totalAdRevenue` are
returned in the property's local currency, not normalized to USD. Properties
in this account mix INR and USD; comparing raw revenue numbers across
properties without checking `currencyCode` first will silently produce
nonsense (e.g. a property billing in INR can look like it out-earns a much
bigger USD property by 10x when it doesn't).

## Other APIs enabled on this GCP project (not built here)

`gcloud services list --enabled --project=<PROJECT_ID>` shows the following APIs are enabled on the GCP project, but this MCP server does not call them:

- `searchconsole.googleapis.com` — covered by SEO Gets MCP, skipped here on purpose
- `maps-backend`, `maps-embed-backend`, `places-backend`, `geocoding-backend` — used by the
  existing globe view's city lookups, not analytics-shaped, no MCP need
- `telemetry.googleapis.com` — GCP-internal, auto-enabled, nothing to call

## Publishing later

`package.json` already has `bin`/`files` set up for `npm publish` if this
ever needs to be shared outside this repo — no changes needed at that point
beyond bumping the version and running `npm publish`.
