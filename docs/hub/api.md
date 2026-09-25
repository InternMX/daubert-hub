# Catálogo de la API

Prefijo global: `/api`. Fuente: decoradores de `apps/api/src/**/*.controller.ts` (verificado en Fase D1). "Auth" = requiere sesión válida y `mustChangePassword = false`, salvo donde se indique.

## Convenciones

- Respuestas de éxito: normalmente `{ data: … }` (y `meta` en listados paginados: `page`, `pageSize`, `total`, `totalPages`).
- Errores 4xx: `{ statusCode, message, code? }`. 5xx: siempre mensaje genérico ([architecture](architecture.md)).
- IDs `BIGINT` como string; un ID mal formado devuelve `400`.
- Métodos `POST/PUT/PATCH/DELETE` desde navegador pasan por la protección de Origin ([authentication](authentication.md)).

## Público

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/health` | `status`, `database` (`connected`/`unavailable`), `environment` (`TEST`/`PRODUCTION`/`UNKNOWN`), `version`, `commit`. No expone host, base ni credenciales. Lo usa el `HEALTHCHECK` de Docker. |
| POST | `/api/auth/login` | Login (público; con rate limit). |
| POST | `/api/auth/logout` | Logout idempotente (público). |

## Sesión

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/auth/me` | Auth (permitido aun con cambio de contraseña pendiente) |
| POST | `/api/auth/change-password` | Auth (permitido con cambio pendiente) |

## Usuarios — sólo `ADMIN` (clase completa)

| Método | Ruta |
| --- | --- |
| GET | `/api/users`, `/api/users/:userId` |
| POST | `/api/users` (crear; 201) |
| PATCH | `/api/users/:userId` |
| POST | `/api/users/:userId/deactivate`, `/reactivate`, `/reset-password` |

## Datos maestros — Auth (ADMIN y GENERAL)

| Módulo | Rutas |
| --- | --- |
| Proveedores | `GET/POST /api/providers`, `GET/PATCH /api/providers/:id`, `POST …/:id/deactivate`, `…/:id/reactivate` |
| Clientes | `GET/POST /api/clients`, `GET/PATCH /api/clients/:clientId`, `POST …/deactivate`, `…/reactivate` |
| Contactos | `POST /api/contacts`, `PATCH /api/contacts/:id`, `POST …/deactivate`, `…/reactivate`; `POST /api/contacts/:id/methods`; `PATCH /api/contact-methods/:id`, `POST …/deactivate`, `…/reactivate` |
| Directorio | `GET /api/contact-directory/companies`, `GET /api/contact-directory/companies/:id` |
| Empresas | `GET /api/companies/search`, `GET /api/companies/dropbox-path-suggestion` (solo cálculo) |
| Config. Notificaciones de pago | `GET/PATCH /api/companies/:companyId/payment-notification-settings` — [company-configuration](../automations/payment-notifications/company-configuration.md) |
| Alias | `GET/PATCH /api/companies/:companyId/aliases` |
| Direcciones | `GET/POST /api/companies/:companyId/addresses`, `PATCH /api/addresses/:addressId`, `POST …/deactivate`, `…/reactivate` |
| Actividad reciente | `GET /api/recent-activity` |

> Reglas de negocio de estos módulos (unicidad de dirección principal, exclusión de filas fiscales, etc.): ver el `README.md` raíz y el código. Documentación detallada: PENDIENTE.

## Automatizaciones

| Método | Ruta | Acceso | Notas |
| --- | --- | --- | --- |
| GET | `/api/automations/overview` | Auth | Tarjetas del centro de automatizaciones |
| GET | `/api/automations/:automationCode/document-series/:seriesCode` | Auth | Configuración y ajustes de una serie |
| PATCH | `/api/automations/:automationCode/document-series/:seriesCode` | **ADMIN** | Ajuste seguro de `siguiente_folio` — [document-series](../database/document-series.md) |
| POST | `/api/automations/:automationCode/review-acknowledgements` | Auth | Acuse de revisión de un problema |
| GET | `/api/automations/remissions/audi/executions` | Auth | Historial Audi |
| GET | `/api/automations/remissions/caterpillar/series` | Auth | Rutas y series Caterpillar |
| GET | `/api/automations/remissions/caterpillar/executions` | Auth | Historial paginado |
| GET | `/api/automations/remissions/caterpillar/executions/:executionId` | Auth | Detalle (documento, reservas, remisiones) |
| POST | `/api/automations/remissions/caterpillar/executions/:executionId/reprocess` | **ADMIN** | Reproceso manual — [reprocessing](../automations/caterpillar/reprocessing.md) |
| GET | `/api/automations/payment-notifications` | Auth | Listado |
| GET | `/api/automations/payment-notifications/:executionId` | Auth | Detalle |
| POST | `/api/automations/payment-notifications/:executionId/reprocess` | Auth (**sin** restricción de rol) | Reproceso de Notificaciones de pago |

### Contrato HTTP del reproceso Caterpillar (resumen)

| HTTP | Resultado |
| --- | --- |
| 202 | `REPROCESS_CREATED` o `ALREADY_PROCESSING` |
| 200 | `ALREADY_REPROCESSED` |
| 404 | `NOT_FOUND` |
| 409 | `NOT_ELIGIBLE_STATE`, `SOURCE_FILE_MISSING`, `OUTSIDE_TEST_SCOPE`, `OUTSIDE_ALLOWED_SCOPE` |
| 502 | Fallo/respuesta inválida o webhook no configurado |
| 504 | Timeout (10 s) hacia n8n |
| 400 / 401 / 403 | ID o `reason` inválidos / sin sesión / no `ADMIN` |

Detalle completo, cuerpo de respuesta y fallos en [reprocessing.md](../automations/caterpillar/reprocessing.md).

## Códigos de error de negocio (`code`) relevantes

`PASSWORD_CHANGE_REQUIRED` (403), `ROLE_NOT_ALLOWED` (403), `CSRF_ORIGIN_NOT_ALLOWED` (403), `LOGIN_RATE_LIMITED` (429), `USER_EMAIL_CONFLICT` (409), `USER_VALIDATION_ERROR` (400) y, en ajuste de folios: `SERIES_FOLIO_STALE`, `DOCUMENT_SERIES_FOLIO_UNCHANGED`, `BACKWARD_ACKNOWLEDGEMENT_REQUIRED`, `SERIES_FOLIO_FLOOR_UNCONFIGURED`, `SERIES_FOLIO_BELOW_FLOOR`, `SERIES_FOLIO_REMISSION_CONFLICT`, `SERIES_FOLIO_RESERVATION_CONFLICT`.
