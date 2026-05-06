# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /src

# .yarn/ must exist before corepack/yarn runs (.yarnrc.yml references .yarn/yarn-wrapper.js)
COPY .yarn/ .yarn/

# Copy root manifests + patches (needed by yarn during resolution)
COPY package.json yarn.lock .yarnrc.yml ./
COPY patches/ patches/
COPY packages/ packages/
COPY web/package.json web/
COPY desktop/package.json desktop/
COPY benchmark/package.json benchmark/

RUN --mount=type=cache,target=/root/.yarn \
    corepack enable && yarn install --immutable

# Copy full source + build
COPY . .
RUN yarn run web:build:prod

# Bake serve.json so cache headers are applied at runtime
RUN cp web/serve.json web/.webpack/

# ── Stage 2: serve ────────────────────────────────────────────────
FROM node:20-slim AS serve

RUN --mount=type=cache,target=/root/.npm \
    npm install -g serve@14

WORKDIR /app
COPY --from=build --chown=node:node /src/web/.webpack ./

USER node
EXPOSE 8017

ENTRYPOINT ["serve", "-s", ".", "-l", "8017", "--no-clipboard", "--cors"]
