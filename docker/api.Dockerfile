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

# Release/build metadata (see apps/api/src/config/environment.ts and GET
# /api/health) — passed in at build time via `docker build --build-arg` (or
# compose.pilot.yaml's build.args), never derived from commit count. Both
# have safe defaults so an ordinary `docker build` with no args still
# produces a working image; APP_VERSION should normally be set from the root
# package.json "version" and GIT_COMMIT from `git rev-parse --short HEAD`.
ARG APP_VERSION=unknown
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV GIT_COMMIT=${GIT_COMMIT}
# PDF de Manufactura: Chromium y las fuentes de la plantilla (Calibri => Carlito, métricas compatibles) viven EN LA IMAGEN; nada depende de un navegador instalado en el host.
# fontconfig/ttf-dejavu son el respaldo de caracteres. --no-sandbox lo añade la API solo con MANUFACTURING_PDF_CHROME_NO_SANDBOX=true (el contenedor corre como el usuario node, sin privilegios).
RUN apk add --no-cache chromium font-carlito fontconfig ttf-dejavu \
    && fc-cache -f
ENV MANUFACTURING_PDF_CHROME_PATH=/usr/bin/chromium
ENV MANUFACTURING_PDF_CHROME_NO_SANDBOX=true
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/package.json ./apps/api/package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || '3000') + '/api/health').then(async (response) => { const body = await response.json(); if (!response.ok || body.database !== 'connected') process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "apps/api/dist/src/main.js"]
