# syntax=docker/dockerfile:1
# One image recipe for every Node service: --build-arg APP=account-api|social|instance-server
# Build from the repository root:
#   docker build -f infra/docker/node.Dockerfile --build-arg APP=social .

FROM node:24-slim AS base
# OpenSSL lets Prisma detect the right query engine at install time
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

# --- Install the whole workspace (dependency layer cached on the lockfile) ---
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile

# --- One-shot migration job (full workspace, has the Prisma CLI) ---
FROM build AS migrate
WORKDIR /repo/packages/db
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# --- One app plus its production dependencies (workspace packages included) ---
FROM build AS deploy
ARG APP
RUN pnpm deploy --legacy --filter "@mmoexile/${APP}" --prod /out

# --- Slim runtime ---
FROM node:24-slim AS runtime
# Prisma's query engine needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deploy --chown=node:node /out .
USER node
ENV NODE_ENV=production
# Workspace packages are source-first TypeScript; tsx compiles them on start
CMD ["node_modules/.bin/tsx", "src/main.ts"]
