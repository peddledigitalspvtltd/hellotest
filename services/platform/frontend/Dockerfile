FROM node:20-alpine AS build

WORKDIR /app/services/platform/frontend

COPY services/platform/frontend/package.json services/platform/frontend/package-lock.json ./
# Avoid esbuild's install-time binary rewrite/exec (ETXTBSY on Docker).
# Keep its platform package and validate the native API after npm exits.
RUN npm ci --ignore-scripts --include=optional --no-audit --no-fund \
    && node -e "const esbuild = require('esbuild'); esbuild.transformSync('const value: number = 1', { loader: 'ts' }); console.log('Verified esbuild ' + esbuild.version);"

COPY services/platform/frontend .
COPY services /app/services
COPY package.json package-lock.json /app/
RUN npm ci --prefix /app --ignore-scripts --no-audit --no-fund
ARG HELLOTEST_DEBUG_SOURCEMAPS=false
ENV HELLOTEST_DEBUG_SOURCEMAPS=$HELLOTEST_DEBUG_SOURCEMAPS
RUN npm run build:all

FROM nginx:1.27-alpine

RUN apk add --no-cache jq

WORKDIR /usr/share/nginx/html

COPY --from=build /app/services/platform/frontend/dist ./
COPY --from=build /app/services/platform/frontend/dist-admin /usr/share/nginx/admin
COPY services/platform/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY services/platform/frontend/docker-entrypoint.sh /docker-entrypoint.d/40-hellotest-runtime-config.sh
COPY services/platform/frontend/public/runtime-config.js /usr/share/nginx/html/runtime-config.js

RUN chmod +x /docker-entrypoint.d/40-hellotest-runtime-config.sh

EXPOSE 80 81
