FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS build

# Reuse verified downloads and bound registry retries on unreliable connections.
ARG NPM_CONFIG_FETCH_RETRIES=5
ARG NPM_CONFIG_FETCH_RETRY_FACTOR=2
ARG NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000
ARG NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=15000
ARG NPM_CONFIG_FETCH_TIMEOUT=120000
ARG NPM_CONFIG_MAXSOCKETS=4
ARG NPM_CONFIG_PREFER_OFFLINE=true

WORKDIR /app

COPY package.json package-lock.json ./
# Avoid esbuild's install-time binary rewrite/exec (ETXTBSY on Docker).
# Keep its platform package and validate the native API after npm exits.
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm ci --ignore-scripts --include=optional --no-audit --no-fund \
    && node -e "const esbuild = require('esbuild'); esbuild.transformSync('const value: number = 1', { loader: 'ts' }); console.log('Verified esbuild ' + esbuild.version);"

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# Reuse verified downloads and bound registry retries on unreliable connections.
ARG NPM_CONFIG_FETCH_RETRIES=5
ARG NPM_CONFIG_FETCH_RETRY_FACTOR=2
ARG NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000
ARG NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=15000
ARG NPM_CONFIG_FETCH_TIMEOUT=120000
ARG NPM_CONFIG_MAXSOCKETS=4
ARG NPM_CONFIG_PREFER_OFFLINE=true

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4301
ENV ARTIFACT_ROOT=/artifacts
ENV QUALITY_AGENT_DATA_DIR=/quality-data
RUN mkdir -p /quality-data && chmod 700 /quality-data

COPY package.json package-lock.json ./
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 4301

CMD ["node", "dist/server.js"]
