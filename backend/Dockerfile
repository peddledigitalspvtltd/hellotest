FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-yaml

COPY api/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node api/src ./src
COPY --chown=node:node api/agents ./agents
COPY --chown=node:node instance-setup-data ./instance-setup-data

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=5 \
  CMD wget -q -O - http://127.0.0.1:3000/health/ready >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
