FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=@daubert/api --include-workspace-root=false

COPY apps/api apps/api
RUN npm run build --workspace=@daubert/api

FROM node:24-alpine AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@daubert/api --include-workspace-root=false \
    && npm cache clean --force

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/package.json ./apps/api/package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || '3000') + '/api/health').then(async (response) => { const body = await response.json(); if (!response.ok || body.database !== 'connected') process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "apps/api/dist/src/main.js"]
