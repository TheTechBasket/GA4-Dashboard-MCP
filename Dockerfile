# syntax=docker/dockerfile:1
# GA4 Dashboard. Credentials come from env (GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY), never a file.

FROM node:22-alpine AS pnpm
ENV PNPM_HOME=/pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

# Compile controllers/*.ts to .js so the runtime image needs no ts-node or typescript.
FROM pnpm AS build
COPY tsconfig.json ./
COPY controllers/*.ts controllers/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm dlx --package="typescript@$(node -p "require('./package.json').devDependencies.typescript")" \
      tsc -p . --noCheck --outDir . --declaration false --sourceMap false

FROM pnpm AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --package-import-method copy \
 && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \) -delete

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=5483
COPY --from=deps /app/node_modules ./node_modules
# Runtime files only: no docs, screenshots, tests or dev config.
COPY package.json app.js SETUP.md ./
COPY lib lib
COPY routes routes
COPY views views
COPY public public
COPY mcp-server/index.js mcp-server/
COPY mcp-server/lib mcp-server/lib
COPY controllers controllers
COPY --from=build /app/controllers/*.js controllers/
# Writable caches: .cache (GA4 report and globe cache), .data (flag and favicon cache).
RUN mkdir -p .cache .data mcp-server/.cache && chown -R node:node .cache .data mcp-server/.cache
USER node
VOLUME ["/app/.data"]
EXPOSE 5483
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5483/healthz || exit 1
CMD ["node", "app.js"]
