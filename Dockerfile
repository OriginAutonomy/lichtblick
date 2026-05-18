# Build stage
FROM node:16 AS build
WORKDIR /src
COPY . ./

RUN corepack enable
RUN yarn install --immutable

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8017

RUN printf '#!/bin/sh\n\
mkdir -p /lichtblick\n\
touch /lichtblick/default-layout.json\n\
index_html=$(cat index.html)\n\
replace_pattern='"'"'/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/'"'"'\n\
replace_value=$(cat /lichtblick/default-layout.json)\n\
echo "${index_html/"$replace_pattern"/"$replace_value"}" > index.html\n\
exec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CMD ["caddy", "file-server", "--listen", ":8017"]
