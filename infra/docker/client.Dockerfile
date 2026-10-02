# syntax=docker/dockerfile:1
# Static game client served by nginx, which also proxies /api to account-api.

FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile \
  && pnpm --filter @mmoexile/client build

FROM nginx:1.29-alpine
COPY infra/docker/client.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/client/dist /usr/share/nginx/html
