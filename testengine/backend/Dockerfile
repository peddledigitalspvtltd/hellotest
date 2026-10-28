FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS build

WORKDIR /app

COPY package.json package-lock.json ./
# Avoid esbuild's install-time binary rewrite/exec (ETXTBSY on Docker).
# Keep its platform package and validate the native API after npm exits.
RUN npm ci --ignore-scripts --include=optional --no-audit --no-fund \
    && node -e "const esbuild = require('esbuild'); esbuild.transformSync('const value: number = 1', { loader: 'ts' }); console.log('Verified esbuild ' + esbuild.version);"

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4301
ENV ARTIFACT_ROOT=/artifacts
ENV QUALITY_AGENT_DATA_DIR=/quality-data
RUN mkdir -p /quality-data && chmod 700 /quality-data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 4301

CMD ["node", "dist/server.js"]
