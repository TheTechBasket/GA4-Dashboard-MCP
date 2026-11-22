# Plans reference

Material moved out of `plans/` on 2026-11-22. Open work is in `plans/todo.md`.

## GA4 quota facts (Google docs, read 2026-10-12)
- Quota is in the response body (`propertyQuota`, only with `returnPropertyQuota: true`), not in headers. No reset timestamp is returned.
- Standard property, per category (Core, Realtime, Funnel are separate): 200,000 tokens/day, 40,000 tokens/hour, 14,000 tokens per project per property per hour, 10 concurrent requests, 10 server errors per project per property per hour, 120 potentially thresholded requests/hour. 360 properties: x10, 50 concurrent.
- One request's cost is subtracted from day, hour and project-hour at once. Cost grows with rows, dims, metrics, filters, date range and cardinality.
- Daily reset is midnight Pacific. Hourly is rolling.
- If one quota is exhausted, every request to that property fails with RESOURCE_EXHAUSTED. A token quota does not reset in 500 ms, so do not retry fast. 500 and 503 retries burn the server-error quota.
- `getMetadata` and `checkCompatibility` charge Core. Admin API: 1,200 requests/min per project, 600/min per user.
- `batchRunReports`: up to 5 reports in one request, one concurrency slot.
- Installed `@google-analytics/data` 6.1.0 has `tokensPerProjectPerHour` in v1beta.

## MCP Apps widgets spec
Goal: tools return a small inline UI as well as compact JSON. Hosts without MCP Apps keep plain JSON.
- Extension `io.modelcontextprotocol/ui` (shipped 2026-01-26). Register an HTML resource at `ui://ga4/<name>` with MIME `text/html;profile=mcp-app`. The tool carries `_meta.ui.resourceUri`. SDK: `@modelcontextprotocol/ext-apps` (checked against 1.7.5). Check API names against the installed version first.
- Widgets: `run_report` (sortable table, bar chart for 1 dim x 1-2 metrics, line chart for `date`/`dateHour`); `run_realtime_report` (live users plus per-minute dither bar strip); `run_funnel_report` (step bars with drop-off percent); `run_pagespeed_insights` (4 score gauges plus CWV); `get_rate_limit_status` (per-property quota bars, ok/low/critical).
- No widget for: `get_account_summaries`, `get_property_details`, `list_google_ads_links`, `get_custom_dimensions_and_metrics`, `request_indexing`, `get_cache_status`.
- Rules: self-contained HTML (inline CSS and JS, no CDN). Follow DESIGN.md tokens. The widget reads only the tool result and never calls GA4. A refresh button calls the tool through the host and the same guard. Text `content` stays compact (12 KB cap). One shared bundle with a view switch per tool.
- Verify in Claude Desktop in light and dark. MCP Inspector does not fully render apps.

## Rejected and decided
- Double sidebar (Analytics explorer B): rejected 2026-10-09. Top command bar instead.
- dither-kit and evilcharts: need Tailwind and shadcn React. Wrong shape for Express plus Handlebars. Fits a future Astro or React project.
- Rejected product names: GAlance, Ganderboard, Gazepane, GlancePane, Quadpane. Name "GA4 Dashboard & MCP" was chosen 2026-09-22, later the interim name "GA4 Dashboard" (MCP dropped).
- Making every range default to `today` breaks `lib/network.js` and `lib/activity.js` (no `today` in their range sets) and drops explore off the store onto live GA4 calls. The real quota lever is the boot backfill, capped at 28 days.
- Activity `/activity` logging must not strip `_cache` from MCP tool responses.
- Service account needs Viewer access in GA4 Admin. The user does this step. Some Google Cloud orgs block key creation (`iam.disableServiceAccountKeyCreation`): the setup check must show a clear fix.
- Port-check of the `redesign-archive` branch analytics view is low value. The v2 page covers it. `main` was reset to the live version 2026-10-09.

## Roadmap seams (built)
History (`daily_snapshots`, `/history`), Network (`daily_breakdowns`, `/network`), Activity (`mcp_events`, `/activity`), Alerts (`/alerts`, digest preview) all shipped by v1.8.0. Store is on by default (`GA4_STORE=off` disables). Maps stay on the India boundary.

## Known issue: globe pole drag
MapLibre v6.13.0: tilted view near a pole (77 to 90 deg lat), a drag from the top or left of the pole does not move the globe. Upstream maplibre-gl-js #8623 and PR #8625 (open 2026-10-04). Re-test the drag on every MapLibre upgrade.

## Promo video (v6 final, 2026-10-10)
48 s, 1080p60, Kokoro VO placeholder, uploaded to TTB YouTube https://youtu.be/bZbx4_8PIXE. Style: Google-like white ground, four-color dots, real indigo app screens, demo mode only. Built in HyperFrames, recorded with srec over CDP. Source files (final mp4, voice, tour scripts, storyboard, peerlist assets) are archived in `/interstellar/Projects/promo-video-creation/videos/thetechbasket/ga4-dashboard-promo-archive/`. Pending: HeyGen voice swap.
