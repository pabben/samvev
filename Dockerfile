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
RUN npm ci --ignore-scripts

FROM dependencies AS development

COPY --chown=node:node . ./

ENTRYPOINT ["dumb-init", "--"]

FROM development AS browser

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN ./node_modules/.bin/playwright install --with-deps chromium \
  && chown -R node:node /opt/playwright
USER node
