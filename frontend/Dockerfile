FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build:all

FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html

COPY --from=build /app/dist ./
COPY --from=build /app/dist-admin /usr/share/nginx/admin
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-hellotest-runtime-config.sh
COPY public/runtime-config.js /usr/share/nginx/html/runtime-config.js

RUN chmod +x /docker-entrypoint.d/40-hellotest-runtime-config.sh

EXPOSE 80 81
