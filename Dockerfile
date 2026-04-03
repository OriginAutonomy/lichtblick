# syntax=docker/dockerfile:1

# Stage 1: build
# node:20-slim is multi-arch (ARM64 + AMD64)
FROM node:20-slim AS build
WORKDIR /src

COPY .yarn/ .yarn/

# Copy manifests for all workspaces declared in root package.json
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/ packages/
COPY web/package.json web/
COPY desktop/package.json desktop/
COPY benchmark/package.json benchmark/
COPY patches/ patches/

RUN --mount=type=cache,target=/root/.yarn \
    corepack enable && yarn install --immutable

COPY . .
RUN yarn run web:build:prod

# Copy serve.json so caching headers are applied at runtime
RUN cp web/serve.json web/.webpack/

# Stage 2: serve
FROM node:20-slim AS serve

RUN --mount=type=cache,target=/root/.npm \
    npm install -g serve@14

WORKDIR /app
COPY --from=build /src/web/.webpack ./

EXPOSE 8017

ENTRYPOINT ["serve", "-s", ".", "-l", "8017", "--no-clipboard", "--cors"]
