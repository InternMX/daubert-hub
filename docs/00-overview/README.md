# Visión general

## Qué es Daubert Hub

Daubert Hub es la aplicación interna (piloto) de Daubert para:

1. **Administrar datos maestros compartidos**: empresas (proveedores, clientes, servicios, fletes), contactos y sus métodos de contacto, alias comerciales y direcciones.
2. **Monitorear y operar automatizaciones n8n**: Remisiones Audi, Remisiones Caterpillar y Notificaciones de pago (estado, historial, detalle, reproceso manual, ajuste seguro de folios, acuses de revisión).
3. **Administrar usuarios y accesos** (roles `ADMIN` / `GENERAL`).

El Hub **no ejecuta** la lógica de las automatizaciones: la ejecuta n8n. El Hub lee el estado que n8n deja en PostgreSQL y, en casos puntuales (reproceso manual), pide a n8n que actúe por webhook. Ver [ADR-005](../decisions/ADR-005-hub-consume-estado-automatizaciones.md).

## Componentes

| Componente | Tecnología | Rol | Documento |
| --- | --- | --- | --- |
| Web | React 19 + TypeScript + Vite + MUI, servida por Nginx | Interfaz de usuario | [hub/architecture.md](../hub/architecture.md) |
| API | NestJS 11 + TypeScript | Único punto de acceso del navegador a datos y a n8n | [hub/api.md](../hub/api.md) |
| Base de datos | PostgreSQL (fuera de Docker, en el host Windows) | Fuente de verdad operativa | [database/README.md](../database/README.md) |
| n8n | n8n (fuera de Docker) | Ejecuta las automatizaciones | [automations/README.md](../automations/README.md) |
| Dropbox | Carpetas de archivos | Origen de archivos y destino de PDFs de las automatizaciones | [automations/caterpillar/architecture.md](../automations/caterpillar/architecture.md) |
| Docker / Nginx | Docker Compose (`compose.pilot.yaml`) | Empaqueta Web y API en el piloto | [operations/deployment.md](../operations/deployment.md) |

## Mapa de lectura por perfil

- **Desarrollador nuevo**: [architecture](architecture.md) → [hub/architecture](../hub/architecture.md) → [hub/api](../hub/api.md) → `README.md` raíz (comandos de desarrollo) → [environments](environments.md).
- **Operador / soporte**: [environments](environments.md) → [operations/troubleshooting](../operations/troubleshooting.md) → [caterpillar/troubleshooting](../automations/caterpillar/troubleshooting.md).
- **Quien recupera el sistema sin el autor original**: [environments](environments.md) → [operations/deployment](../operations/deployment.md) → [database/roles-permissions](../database/roles-permissions.md) → [database/migrations](../database/migrations.md) → [caterpillar/production-runbook](../automations/caterpillar/production-runbook.md).
- **Auditor de decisiones**: [decisions/README](../decisions/README.md) + [deployments/](../deployments/).

## Glosario mínimo

| Término | Significado |
| --- | --- |
| Ejecución | Fila de `ops.ejecuciones_automatizacion`: un intento de procesar un archivo origen. Estados: `PROCESANDO`, `COMPLETADA`, `ERROR`, `CANCELADA`. |
| Serie documental | Fila de `operacion.series_documentales` que lleva el `siguiente_folio` de un tipo de remisión. |
| Reserva de folios | Rango de folios que una ejecución toma de una serie (`operacion.reservas_folios`). Ver [document-series](../database/document-series.md). |
| Ruta / llave de proceso | Fila de `ops.automatizacion_series_proceso`: relaciona una `llave_proceso` (planta/proceso) con una serie y un cliente. |
| Reproceso | Nueva ejecución **hija** (`reproceso_de_id`) creada a partir de una ejecución en `ERROR`/`CANCELADA`. Ver [reprocessing](../automations/caterpillar/reprocessing.md). |
| TEST / PROD | Bases `daubert_hub_test` / `daubert_global`. Ver [environments](environments.md). |
| Fase 12C | Etiqueta histórica (en código y commits) del reproceso manual de Caterpillar. |
