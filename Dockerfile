# syntax=docker/dockerfile:1
FROM node:24.20.0-bookworm-slim AS base

LABEL org.opencontainers.image.title="Samvev M1" \
  org.opencontainers.image.description="Local development image for the Samvev M1 workspace" \
  org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  com.docker.compose.project="samvev-m1"

WORKDIR /workspace

ENV CI=true \
  NPM_CONFIG_AUDIT=false \
  NPM_CONFIG_FUND=false \
  NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates curl dumb-init \
  && mkdir -p /workspace/node_modules \
  && chown node:node /workspace /workspace/node_modules \
  && rm -rf /var/lib/apt/lists/*

USER node

FROM base AS bootstrap

COPY --chown=node:node package.json .npmrc ./

FROM base AS dependencies

COPY --chown=node:node . ./
# Keep dependency installation and its cache cleanup in one layer. A canonical
# runtime needs the dependencies, never npm's recoverable cache.
RUN npm ci --ignore-scripts && npm cache clean --force

FROM dependencies AS development

COPY --chown=node:node . ./

ENTRYPOINT ["dumb-init", "--"]

# Public immutable images must contain the web build, not only the API source.
# A Git archive intentionally excludes generated dist files.
FROM dependencies AS runtime

ARG SAMVEV_SOURCE_SHA=unproven
LABEL org.opencontainers.image.revision="${SAMVEV_SOURCE_SHA}"

RUN npm run build --workspace @samvev/web

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--import", "tsx", "services/api/src/server.ts"]

FROM development AS browser

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN ./node_modules/.bin/playwright install --with-deps chromium \
  && chown -R node:node /opt/playwright
USER node
