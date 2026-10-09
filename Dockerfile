# GA4 Dashboard & MCP. Credentials come from env (GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY), never a file.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Writable caches: .cache (GA4 report and globe cache), .data (flag and favicon cache).
RUN mkdir -p .cache .data mcp-server/.cache && chown -R node:node .cache .data mcp-server/.cache
USER node
VOLUME ["/app/.data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "app.js"]
