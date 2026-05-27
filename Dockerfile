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

# Pre-create the layout dir so the entrypoint can write to it as the node user at runtime
RUN mkdir -p /lichtblick \
    && touch /lichtblick/default-layout.json \
    && chown -R node:node /lichtblick

# Entrypoint script must be created as root (node user cannot write to /).
# Uses bash because ${var/pattern/replacement} is a bash-only expansion (dash rejects it).
RUN printf '#!/bin/bash\n\
index_html=$(cat index.html)\n\
replace_pattern='"'"'/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/'"'"'\n\
replace_value=$(cat /lichtblick/default-layout.json)\n\
echo "${index_html/"$replace_pattern"/"$replace_value"}" > index.html\n\
exec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

USER node
EXPOSE 8017

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
CMD ["serve", "-s", ".", "-l", "8017"]
