# ga4-mcp-server

MCP server exposing Google Analytics Admin + Data API tools. It is part of the
GA4 Dashboard repo: one `pnpm install` at the root covers it, and it
reads credentials from the root `.env`.

## Setup

Set `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` in the root `.env` (see
[SETUP.md](../SETUP.md), or open `/setup` in the dashboard). Check them with
`pnpm setup:check`. Run the server by hand with `pnpm mcp`.

## Registering with Claude Code

From the project where you want the tools:

```bash
claude mcp add ga4 --scope project -- node <path>/mcp-server/index.js
```

`--scope project` writes `.mcp.json` in that project. Use `--scope user` to
have it in every project. No `-e` flags are needed: the server loads
`<path>/.env` by its own path, whatever the working directory.

`claude mcp list` should show `ga4` as Connected. Tools appear in a session
after a restart.

## Credentials

The private key lives only in the root `.env` (gitignored). The MCP client
config holds just the command, never the key.

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
| `run_pagespeed_insights` | Lighthouse scores + Core Web Vitals for one URL: needs `PSI_API_KEY` |
| `request_indexing` | Ask Google to recrawl a URL after a deploy: needs Search Console owner access, see below |
| `get_cache_status` | What's cached, how old, still fresh? (no API call) |
| `get_rate_limit_status` | Current local throttle tokens per API family (no API call) |

Search Console *data* (queries, clicks, impressions) is intentionally not
duplicated here: use the existing SEO Gets MCP for that. This server only
adds the one-off Indexing API action.

### PageSpeed Insights setup

Needs a `PSI_API_KEY`: a plain API key (not the GA service account), since
PSI auth is key-based, not OAuth. The GCP project already has one
(`pagespeed`, restricted to `pagespeedonline.googleapis.com`):

```bash
gcloud services api-keys get-key-string \
  projects/<PROJECT_ID>/locations/global/keys/<KEY_ID>
```

Put the output in the root `.env` as `PSI_API_KEY=...`.

### Indexing API setup

The GA service account (`<SERVICE_ACCOUNT_EMAIL>`)
currently has **no Search Console access on any property**: confirmed live: `request_indexing` returns
`403 Permission denied. Failed to verify the URL ownership.` until you fix this.

To enable it per site: Search Console → that property → Settings → Users and
permissions → Add user → paste the service account email above → **Owner**.
Do this for each domain you want `request_indexing` to work on.

## Rate limiting

Each API family (`admin`, `data`, `realtime`, `alpha`/funnel, `psi`, `indexing`)
has its own local token bucket (defaults: 2/8/4/2/1/0.1 req/sec: override via
`RATE_LIMIT_*_RPS` env vars). `indexing` defaults to 1 request every 10s as a
burst guard: Google's real cap there is ~200/day, not a per-second rate, and
this server doesn't track that daily count locally. Calls that exceed it are queued and delayed,
never dropped. On top of that, every `run_report` / `run_realtime_report`
response includes Google's own live `quota` object (tokens left today/this
hour, from `returnPropertyQuota: true`): that's the authoritative number,
the local bucket is just a safety throttle.

## Caching

Every tool response is cached to `mcp-server/.cache/` (gitignored) and
memory, keyed by tool name + params. TTL tiers (override via
`CACHE_TTL_*_SEC`):

- `realtime`: 60s (active users change by the minute)
- `report`: 1h (historical reports rarely change mid-day)
- `metadata`: 6h (account/property/custom-dimension info changes rarely)
- `psi`: 30min (a real Lighthouse run is expensive; long enough to avoid
  re-running on every question, short enough to catch a post-deploy regression)

`request_indexing` is a write action, not cached.

Every response carries a `_cache: { hit, ageSeconds, ttlSeconds }` field so
the caller always knows whether the data is fresh or served from cache.
`get_cache_status` inspects the whole cache without calling any API.

`run_report` and `run_realtime_report` also carry `currencyCode` (the
property's own currency, piggybacked on the cached `get_property_details`
metadata call): revenue metrics like `totalRevenue`/`totalAdRevenue` are
returned in the property's local currency, not normalized to USD. Properties
in this account mix INR and USD; comparing raw revenue numbers across
properties without checking `currencyCode` first will silently produce
nonsense (e.g. a property billing in INR can look like it out-earns a much
bigger USD property by 10x when it doesn't).

## Other APIs enabled on this GCP project (not built here)

`gcloud services list --enabled --project=<PROJECT_ID>` shows the following APIs are enabled on the GCP project, but this MCP server does not call them:

- `searchconsole.googleapis.com`: covered by SEO Gets MCP, skipped here on purpose
- `maps-backend`, `maps-embed-backend`, `places-backend`, `geocoding-backend`: used by the
  existing globe view's city lookups, not analytics-shaped, no MCP need
- `telemetry.googleapis.com`: GCP-internal, auto-enabled, nothing to call
