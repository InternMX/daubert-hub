# Mapa del sistema

Índice rápido de "dónde vive qué". Fuentes: `apps/api/src/**/*.controller.ts`, `apps/web/src/App.tsx`, `apps/api/src/app.module.ts`, migraciones.

## Módulos de la API (`apps/api/src`)

| Módulo | Prefijo de ruta | Estado documental |
| --- | --- | --- |
| `health` | `/api/health` (público) | [hub/api.md](../hub/api.md) |
| `security` (auth, usuarios, sesiones) | `/api/auth/*`, `/api/users/*` | [authentication](../hub/authentication.md), [authorization](../hub/authorization.md) |
| `providers` | `/api/providers` | Sólo listado en [hub/api.md](../hub/api.md) |
| `clients` | `/api/clients` | Sólo listado |
| `contacts`, `contact-methods`, `contact-directory` | `/api/contacts`, `/api/contact-methods`, `/api/contact-directory/companies` | Sólo listado |
| `companies`, `aliases`, `addresses` | `/api/companies/search`, `/api/companies/:id/aliases`, `/api/companies/:id/addresses`, `/api/addresses/:id` | Sólo listado |
| `recent-activity` | `/api/recent-activity` | [hub/automations.md](../hub/automations.md) |
| `automations` (series, overview, review, trigger-requests) | `/api/automations/*` | [hub/automations.md](../hub/automations.md) |
| `automations/remisiones-caterpillar` | `/api/automations/remissions/caterpillar/*` | [automations/caterpillar](../automations/caterpillar/README.md) |
| `automations/remisiones-audi` | `/api/automations/remissions/audi/executions` | [automations/audi](../automations/audi/README.md) |
| `automations/payment-notifications` | `/api/automations/payment-notifications/*` (incluye `PATCH …/:executionId/files/:fileId/assignment`, asignación puntual) | [automations/payment-notifications](../automations/payment-notifications/README.md) · [production-rollout](../automations/payment-notifications/production-rollout.md) |

## Rutas de la Web (`apps/web/src/App.tsx`)

| Ruta | Página | Acceso |
| --- | --- | --- |
| `/login`, `/change-password` | Login / cambio de contraseña | Público (sólo no autenticados) / sesión con cambio pendiente |
| `/` | Inicio (acciones rápidas + actividad reciente) | Autenticado |
| `/providers`, `/providers/new`, `/providers/:id`, `/providers/:id/edit` | Proveedores | Autenticado |
| `/clients`, `/clients/new`, `/clients/:clientId`, `/clients/:clientId/edit` | Clientes | Autenticado |
| `/contacts` | Contactos | Autenticado |
| `/automations` | Centro de automatizaciones | Autenticado |
| `/automations/remissions/audi` | Remisiones Audi | Autenticado (acciones de folio sólo `ADMIN`) |
| `/automations/remissions/caterpillar` | Remisiones Caterpillar | Autenticado (ajuste de folio y reproceso sólo `ADMIN`) |
| `/automations/payment-notifications`, `…/:executionId` | Notificaciones de pago | Autenticado |
| `/users`, `/users/new`, `/users/:userId`, `/users/:userId/edit` | Administración de usuarios | Sólo `ADMIN` (`AdminRoute`) |

## Esquemas de PostgreSQL (uso observado en el código)

| Esquema | Propósito | Documento |
| --- | --- | --- |
| `core` | Datos maestros (`empresas`, `direcciones`, `documentos`, contactos) | [database/architecture.md](../database/architecture.md) |
| `ops` | Automatizaciones, ejecuciones, rutas por proceso, auditoría de disparos, acuses de revisión | ídem |
| `operacion` | Series documentales, reservas de folios, remisiones, ajustes de serie | ídem |
| `security` | Usuarios y sesiones del Hub | ídem |
| `audit` | Función/trigger genérico `audit.fn_registrar_cambio` | ídem |

## Roles de base de datos

| Rol | Quién lo usa |
| --- | --- |
| `postgres` | Administración/DDL manual (migraciones). Nunca la API ni n8n. |
| `daubert_hub_app` | API del Hub en PROD |
| `n8n_app` | n8n en PROD (compartido Audi + Caterpillar) |
| `daubert_hub_test_user`, `n8n_cat_test` | API y n8n en TEST |

Detalle: [database/roles-permissions.md](../database/roles-permissions.md).

## Automatizaciones (códigos)

| Código (`ops.automatizaciones.codigo`) | Nombre en el Hub | Documento |
| --- | --- | --- |
| `REMISIONES_CATERPILLAR` | Remisiones Caterpillar | [caterpillar](../automations/caterpillar/README.md) |
| `REMISIONES_AUDI` | Remisiones Audi | [audi](../automations/audi/README.md) |
| `PAYMENT_NOTIFICATIONS` | Notificaciones de pago | [payment-notifications](../automations/payment-notifications/README.md) |

Catálogo estático del Hub: `apps/api/src/automations/overview/automation-catalog.ts`.

## Series documentales conocidas

`REMISION_AUDI`, `REMISION_CAT_P2`, `REMISION_CAT_P3`, `REMISION_CAT_P4`, `REMISION_CAT_P5`, `REMISION_CAT_P6`, `REMISION_CAT_NL_FINSA_1`, `REMISION_CAT_NL_FINSA_3`, `REMISION_CAT_TORREON`. Ver [document-series](../database/document-series.md).

## Scripts operativos del repo

| Script | Propósito |
| --- | --- |
| `scripts/dev-test-only.cjs` | Launcher de `npm run dev`: garantiza que el desarrollo sólo use `daubert_hub_test` |
| `apps/api/scripts/bootstrap-admin.ts` / `-prod.ts` | Crear el **primer** `ADMIN` (TEST / PROD). Ver [authentication](../hub/authentication.md) |
| `apps/api/scripts/reset-admin-password.ts` / `-prod.ts` | Recuperación de contraseña de `ADMIN` (TEST / PROD) |
