# GA4 Pulseboard Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve privacy mode, globe UX, analytics report consistency, spike detection, and backend maintainability.

**Architecture:** Move GA4 report definitions and privacy formatting into shared modules. Route controller report execution through the shared GA4 service, then update views to consume shared metadata and apply one privacy marker pattern.

**Tech Stack:** Express, Handlebars, GA4 Data/Admin APIs, TypeScript via ts-node, Mocha/Chai for focused unit tests.

## Global Constraints

- Preserve existing dirty worktree changes and do not revert unrelated edits.
- Follow `DESIGN.md`: near-white gridded canvas, `#1348dc` / `#2b7fff` accents, 2px controls, compact typography, minimal shadows.
- No GA4 credentials required for unit tests.
- Do not add new runtime dependencies unless unavoidable.

---

### Task 1: Shared Helpers and Tests

**Files:**
- Create: `controllers/privacy.js`
- Create: `controllers/analyticsRecipes.js`
- Create: `test/privacy.test.js`
- Create: `test/analyticsRecipes.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `redactUrl(value)`, `redactDomain(value)`, `stripSensitiveGlobeUsersPayload(payload)`, `CARD_CONFIGS`, `CARD_CATALOG`, `getAnalyticsCardConfig(type)`, `getAnalyticsCatalog()`, `getDateRange(range)`.

- [ ] Write failing tests for URL redaction, globe payload stripping, and analytics card metadata.
- [ ] Run `pnpm test` and confirm tests fail because modules are missing.
- [ ] Implement helper modules.
- [ ] Run `pnpm test` and confirm tests pass.

### Task 2: Controller Refactor

**Files:**
- Modify: `controllers/apiController.js`
- Modify: `controllers/ga4Service.js`

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces: controller responses with shared card recipes and sanitized globe payloads.

- [ ] Replace direct analytics-card client construction with `runSafeHistoricalReport`.
- [ ] Replace property-detail realtime client construction with `runSafeRealtimeReport`.
- [ ] Replace globe user client construction with `runSafeRealtimeReport`.
- [ ] Return analytics catalog to the analytics view.
- [ ] Strip `url` from globe user payloads before caching/responding.

### Task 3: Globe Redesign and Privacy

**Files:**
- Modify: `views/globe.hbs`

**Interfaces:**
- Consumes: `/api/globe-users` payload without `url`.

- [ ] Align globe CSS with `DESIGN.md` tokens.
- [ ] Persist globe privacy mode using `pb_privacy`.
- [ ] Mark all sensitive client-injected text with `data-privacy`.
- [ ] Avoid raw sensitive values in marker titles when privacy is enabled.
- [ ] Improve mobile layout so panels do not cover the globe.

### Task 4: Analytics UX Cleanup

**Files:**
- Modify: `views/analytics.hbs`
- Modify: `controllers/apiController.js`

**Interfaces:**
- Consumes: `analyticsCatalog` from the controller.

- [ ] Build analytics cards from server-provided catalog.
- [ ] Align colors/radii with `DESIGN.md`.
- [ ] Keep summary cards, CSV export, and GA4 deep link working.

### Task 5: Verification

**Files:**
- Modify only if verification reveals failures.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run a syntax check for changed server JavaScript if needed.
- [ ] Report exact verification results.
