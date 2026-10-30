FROM node:20-bookworm-slim

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
ENV PORT=4312

COPY package.json ./
RUN --mount=type=cache,id=hellotest-npm,target=/root/.npm,sharing=locked npm install --omit=dev

COPY src ./src

EXPOSE 4312

CMD ["npm", "start"]
