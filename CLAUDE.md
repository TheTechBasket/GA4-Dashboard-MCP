# GA4 Dashboard & MCP

## Design
@DESIGN.md

Every UI change (views/, public/css, new components) MUST follow DESIGN.md — colors, type, radii, spacing tokens. No ad hoc palette or font choices.

## Credentials
JSON key file only, no env-based inline credentials.
- Main app: drop `ga4dataapi-*.json` in project root, auto-detected by filename, `.env` optional (only needed to override path via `GA4_CREDENTIALS_PATH`).
- `mcp-server/`: no auto-detect. `GOOGLE_APPLICATION_CREDENTIALS` must be set explicitly — either in `mcp-server/.env` or via `claude mcp add -e GOOGLE_APPLICATION_CREDENTIALS=...`.
