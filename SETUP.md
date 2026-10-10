# Setup

The dashboard and the MCP server read two values from `.env` in the project root: `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY`. They come from a Google Cloud service account. No key file stays on disk.

Start the app with `pnpm start` and open it. Until `.env` works, every page opens `/setup`, which shows the prompt below and checks progress live. `pnpm setup:check` runs the same check in the terminal.

The `/setup` page reads the three blocks below from this file. Edit the text between the markers, not the markers.

## With an AI agent

Paste this prompt into Claude Code, Codex, Gemini CLI or any agent that can run commands in the project folder.

<!-- prompt:start -->
```text
Set up Google Analytics access for the GA4 Dashboard app in this folder.

1. Check that gcloud is installed and logged in (gcloud auth list). If not, stop and ask me to run: gcloud auth login
2. Create a new Google Cloud project named ga4-dash-<6 random chars>. No billing is needed.
3. Enable analyticsdata.googleapis.com and analyticsadmin.googleapis.com.
4. Create a service account "ga4-dashboard" and a JSON key for it in a temp folder outside this repo.
5. Copy .env.example to .env if .env is missing. Set GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY from the key (private key in double quotes, newlines as \n). Keep every other line.
6. Run: pnpm setup:check. When it says "key accepted", delete the JSON key file.
7. Show me the client email and tell me to add it as Viewer in GA4 Admin, Account access management. Wait until I say done, then run pnpm setup:check again.

If you have browser tools (Claude in Chrome, Playwright or similar), ask me once if you may use them. If I say yes:
- Use the browser for any step gcloud cannot do, or if gcloud is missing (Cloud Console pages).
- Do step 7 yourself in GA4 Admin, then tell me what you added.
I must sign in to Google myself; never type my password.

Docker: if the app runs in a container, step 6 is: docker compose up -d (it reloads .env), then docker compose exec dashboard node scripts/setup-check.js.

Rules: never print the private key, never commit .env.
If you cannot run shell commands or a browser, give me these steps one at a time with the exact console links, and wait for me after each one.
```
<!-- prompt:end -->

## By hand

<!-- manual:start -->
1. **Create a project.** Open [New Project](https://console.cloud.google.com/projectcreate), give it a name (for example ga4-dash) and click Create. No billing needed.
2. **Turn on the APIs.** Open [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com) and click Enable. Do the same for [Google Analytics Admin API](https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com).
3. **Create a service account.** Open [Create service account](https://console.cloud.google.com/iam-admin/serviceaccounts/create), name it ga4-dashboard and click Create and close. Skip the optional steps.
4. **Download a key.** Open the new account, Keys tab: Add key, Create new key, JSON, Create. A file downloads.
5. **Fill .env.** Copy `client_email` and `private_key` from that file into `.env` as `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY`. Keep the private key in double quotes with its `\n`.
6. **Check the key.** Run `pnpm setup:check`. When it passes, delete the downloaded file.
7. **Give access in GA4.** In [GA4 Admin](https://analytics.google.com/analytics/web/#/admin), Account access management: click +, Add users, paste the client email, choose Viewer and click Add.
8. **Done.** Come back to this page. It moves on by itself.
<!-- manual:end -->

`pnpm setup:check` exit codes: 0 connected, 1 `.env` values missing, 2 key rejected by Google, 3 no GA4 properties visible yet, 4 GA4 request failed (for example an API is not enabled).

## Use with AI (MCP)

The MCP server in `mcp-server/` uses the same `.env` and the same `pnpm install`. Paste this prompt into your AI tool, or run the command in it yourself. Replace `<project folder>` with the absolute path of this folder (the `/setup` page fills it in).

<!-- mcp:start -->
```text
Add the GA4 Dashboard MCP server to my AI tool.

Server command: node <project folder>/mcp-server/index.js
It reads credentials from <project folder>/.env (already set up).
Scope: this project only (.mcp.json in my current project) unless I say all projects.

For Claude Code run:
claude mcp add ga4 --scope project -- node <project folder>/mcp-server/index.js
Then list the tools and run get_account_summaries to confirm it works.
```
<!-- mcp:end -->
