FROM node:20-alpine AS capability-ui

# Reuse verified downloads and bound registry retries on unreliable connections.
ARG NPM_CONFIG_FETCH_RETRIES=5
ARG NPM_CONFIG_FETCH_RETRY_FACTOR=2
ARG NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000
ARG NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=15000
ARG NPM_CONFIG_FETCH_TIMEOUT=120000
ARG NPM_CONFIG_MAXSOCKETS=4
ARG NPM_CONFIG_PREFER_OFFLINE=true

WORKDIR /source
COPY services/platform/frontend/package*.json ./services/platform/frontend/
# Avoid esbuild's install-time binary rewrite/exec (ETXTBSY on Docker).
# Keep its platform package and validate the native API after npm exits.
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm ci --prefix services/platform/frontend --ignore-scripts --include=optional --no-audit --no-fund \
    && node -e "const esbuild = require('./services/platform/frontend/node_modules/esbuild'); esbuild.transformSync('const value: number = 1', { loader: 'ts' }); console.log('Verified esbuild ' + esbuild.version);"
COPY package.json package-lock.json ./
COPY services ./services
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm ci --ignore-scripts --no-audit --no-fund
COPY scripts/build ./scripts/build
ARG HELLOTEST_CAPABILITY=all
ENV CAPABILITY_UI_OUTPUT_ROOT=/capability-ui
ARG HELLOTEST_DEBUG_SOURCEMAPS=false
ENV HELLOTEST_DEBUG_SOURCEMAPS=$HELLOTEST_DEBUG_SOURCEMAPS
RUN node scripts/build/capability-ui.mjs "$HELLOTEST_CAPABILITY"

FROM node:20-alpine AS runtime

# Reuse verified downloads and bound registry retries on unreliable connections.
ARG NPM_CONFIG_FETCH_RETRIES=5
ARG NPM_CONFIG_FETCH_RETRY_FACTOR=2
ARG NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000
ARG NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=15000
ARG NPM_CONFIG_FETCH_TIMEOUT=120000
ARG NPM_CONFIG_MAXSOCKETS=4
ARG NPM_CONFIG_PREFER_OFFLINE=true

WORKDIR /app

RUN apk add --no-cache python3 py3-yaml

COPY services/platform/backend/package*.json ./services/platform/backend/
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm ci --prefix services/platform/backend --omit=dev --no-audit --no-fund

COPY package.json package-lock.json ./
COPY services/platform/package.json ./services/platform/package.json
COPY services/mcp/package.json ./services/mcp/package.json
COPY services/testing/package.json ./services/testing/package.json
COPY services/knowledge/package.json ./services/knowledge/package.json
COPY services/manual/package.json ./services/manual/package.json
COPY services/dashboard/package.json ./services/dashboard/package.json
COPY services/automation/package.json ./services/automation/package.json
COPY services/agentic/package.json ./services/agentic/package.json
COPY services/chatbot/package.json ./services/chatbot/package.json
COPY services/ai/package.json ./services/ai/package.json
COPY services/trace/package.json ./services/trace/package.json
COPY services/integration/package.json ./services/integration/package.json
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY --chown=node:node services/capabilities.json ./services/capabilities.json
COPY --chown=node:node services/platform/backend ./services/platform/backend
COPY --chown=node:node services/platform/shared ./services/platform/shared
COPY --chown=node:node services/mcp/backend ./services/mcp/backend
COPY --chown=node:node services/testing/backend ./services/testing/backend
COPY --chown=node:node services/testing/shared ./services/testing/shared
COPY --chown=node:node services/knowledge/backend ./services/knowledge/backend
COPY --chown=node:node services/manual/backend ./services/manual/backend
COPY --chown=node:node services/dashboard/backend ./services/dashboard/backend
COPY --chown=node:node services/automation/backend ./services/automation/backend
COPY --chown=node:node services/automation/shared ./services/automation/shared
COPY --chown=node:node services/agentic/backend ./services/agentic/backend
COPY --chown=node:node services/agentic/shared ./services/agentic/shared
COPY --chown=node:node services/chatbot/backend ./services/chatbot/backend
COPY --chown=node:node services/ai/backend ./services/ai/backend
COPY --chown=node:node services/ai/shared ./services/ai/shared
COPY --chown=node:node services/trace/backend ./services/trace/backend
COPY --chown=node:node services/integration/backend ./services/integration/backend

ARG HELLOTEST_CAPABILITY=all
ENV HELLOTEST_SERVICE_PROFILE=$HELLOTEST_CAPABILITY
COPY --from=capability-ui --chown=node:node /capability-ui ./capability-ui

COPY scripts/build/check-runtime-exports.cjs ./scripts/build/check-runtime-exports.cjs
RUN node scripts/build/check-runtime-exports.cjs /app

USER node

WORKDIR /app/services/platform/backend

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=5 \
  CMD wget -q -O - http://127.0.0.1:3000/health/ready >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
