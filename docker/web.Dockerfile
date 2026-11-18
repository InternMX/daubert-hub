FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=@daubert/web --include-workspace-root=false

COPY apps/web apps/web
# Manufactura en la interfaz: APAGADA por omisión (imagen de PRODUCCIÓN). Son variables de COMPILACIÓN de Vite: habilitarla exige reconstruir la imagen web con ambas en "true"
# (--build-arg VITE_MANUFACTURING_UI=true --build-arg VITE_MANUFACTURING_DOCUMENTS=true) y que el API tenga MANUFACTURING_ENABLED=true. Ver docs/hub/manufactura-habilitacion-produccion.md.
ARG VITE_MANUFACTURING_UI=false
ARG VITE_MANUFACTURING_DOCUMENTS=false
ENV VITE_MANUFACTURING_UI=${VITE_MANUFACTURING_UI} VITE_MANUFACTURING_DOCUMENTS=${VITE_MANUFACTURING_DOCUMENTS}
RUN npm run build --workspace=@daubert/web

FROM nginx:alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
