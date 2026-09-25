# Contrato Hub ↔ PostgreSQL

Cruce **de solo lectura** entre el catálogo de PROD y `apps/api/src` (sin modificar `apps/api`). Método: extracción por expresión regular de `FROM/JOIN/INSERT INTO/UPDATE/DELETE FROM <schema.objeto>` en archivos `.ts` no `.spec`; se compara con los grants reales de `daubert_hub_app` en PROD. Es una **aproximación estática**: no ve SQL armado dinámicamente. Volver a [database](README.md).

## Resumen

- Todo acceso a la base del Hub está en archivos `*.repository.ts` (más helpers `automations/*`, `recent-activity/*`, `security/*`). **Ningún** repositorio llama funciones `fn_*`/`reservar_folios*` ni consulta vistas.
- Cada transacción de escritura fija `app.origin`, `app.request_id`, `app.user_id`, `app.user_email` con `set_config(..., true)` (local a la transacción) para que los triggers de [auditoría](triggers.md) atribuyan el cambio.
- El Hub **no** usa `SECURITY DEFINER`, `TRUNCATE` ni `DELETE` salvo `DELETE FROM core.alias_empresa` (`company-aliases.repository.ts`), coherente con el grant `D` de esa tabla.
- **1 brecha(s) de permisos en PROD** (ver abajo).

## Brechas detectadas

| objeto | archivo del Hub | operaciones que el código hace | grants `daubert_hub_app` en PROD |
| --- | --- | --- | --- |
| `core.direcciones` | `addresses/addresses.repository.ts` | RIU | - |

**`core.direcciones` en PROD**: el módulo `AddressesModule` está registrado en `app.module.ts` y `addresses.repository.ts` hace `SELECT/INSERT/UPDATE`, pero `daubert_hub_app` no tiene ningún privilegio (ni sobre la tabla ni sobre su sequence) en `daubert_global`. En TEST `daubert_hub_test_user` sí. D1 ([roles-permissions](roles-permissions.md)) cita la migración `20260902_002` como origen del grant: **la base no lo refleja**. Estado: CONFIRMED (grant ausente) / UNKNOWN (si la migración se aplicó en PROD, si el módulo está en uso en PROD, si alguien revocó). No se corrigió.

## Objetos con grant al Hub sin uso detectado en código

Ninguno: todo grant del Hub tiene uso estático en `apps/api/src`.

## Uso por archivo

| archivo | capa | objeto | ops | grants PROD | estado | services/controllers del mismo directorio |
| --- | --- | --- | --- | --- | --- | --- |
| `addresses/addresses.repository.ts` | repository | `core.direcciones` | RIU | - | GAP (RIU) | `addresses.controller.ts`, `addresses.service.ts` |
| `addresses/addresses.repository.ts` | repository | `core.empresas` | R | RIU | OK | `addresses.controller.ts`, `addresses.service.ts` |
| `aliases/aliases.repository.ts` | repository | `core.alias_empresa` | R | RID | OK | `aliases.controller.ts`, `aliases.service.ts` |
| `aliases/aliases.repository.ts` | repository | `core.empresas` | R | RIU | OK | `aliases.controller.ts`, `aliases.service.ts` |
| `automations/document-series.repository.ts` | repository | `operacion.ajustes_series` | RI | RI | OK | `automations.controller.ts`, `automations.service.ts` |
| `automations/document-series.repository.ts` | repository | `operacion.remisiones` | R | R | OK | `automations.controller.ts`, `automations.service.ts` |
| `automations/document-series.repository.ts` | repository | `operacion.reservas_folios` | R | R | OK | `automations.controller.ts`, `automations.service.ts` |
| `automations/document-series.repository.ts` | repository | `operacion.series_documentales` | RU | RU | OK | `automations.controller.ts`, `automations.service.ts` |
| `automations/document-series.repository.ts` | repository | `ops.automatizacion_series_proceso` | R | R | OK | `automations.controller.ts`, `automations.service.ts` |
| `automations/document-series.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `automations.controller.ts`, `automations.service.ts` |
| `automations/overview/automation-overview.types.ts` | otro | `ops.automatizaciones` | R | R | OK | `automations-overview.controller.ts`, `automations-overview.service.ts` |
| `automations/overview/automations-overview.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `automations-overview.controller.ts`, `automations-overview.service.ts` |
| `automations/overview/automations-overview.repository.ts` | repository | `ops.ejecuciones_automatizacion` | R | R | OK | `automations-overview.controller.ts`, `automations-overview.service.ts` |
| `automations/overview/automations-overview.service.ts` | service | `ops.automatizaciones` | R | R | OK | `automations-overview.controller.ts`, `automations-overview.service.ts` |
| `automations/payment-notifications/payment-notifications.repository.ts` | repository | `core.correos_notificacion_pago` | R | R | OK | `payment-notifications.controller.ts`, `payment-notifications.service.ts` |
| `automations/payment-notifications/payment-notifications.repository.ts` | repository | `core.empresas` | R | RIU | OK | `payment-notifications.controller.ts`, `payment-notifications.service.ts` |
| `automations/payment-notifications/payment-notifications.repository.ts` | repository | `core.resultados_notificacion_pago` | R | R | OK | `payment-notifications.controller.ts`, `payment-notifications.service.ts` |
| `automations/remisiones-audi/audi-executions.repository.ts` | repository | `operacion.remisiones` | R | R | OK | `audi-executions.controller.ts`, `audi-executions.service.ts` |
| `automations/remisiones-audi/audi-executions.repository.ts` | repository | `operacion.series_documentales` | R | RU | OK | `audi-executions.controller.ts`, `audi-executions.service.ts` |
| `automations/remisiones-audi/audi-executions.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `audi-executions.controller.ts`, `audi-executions.service.ts` |
| `automations/remisiones-audi/audi-executions.repository.ts` | repository | `ops.ejecuciones_automatizacion` | R | R | OK | `audi-executions.controller.ts`, `audi-executions.service.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `core.documentos` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `operacion.remision_detalle` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `operacion.remisiones` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `operacion.reservas_folios` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `operacion.series_documentales` | R | RU | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | `ops.ejecuciones_automatizacion` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-process-labels.ts` | otro | `operacion.series_documentales` | R | RU | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | `core.empresas` | R | RIU | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | `operacion.series_documentales` | R | RU | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | `ops.automatizacion_series_proceso` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `caterpillar-executions.service.ts`, `caterpillar-routing.service.ts`, `caterpillar.controller.ts` |
| `automations/review/review-acknowledgements.repository.ts` | repository | `ops.automation_review_acknowledgements` | RI | RI | OK | `review-acknowledgements.controller.ts`, `review-acknowledgements.service.ts` |
| `automations/trigger-requests/automation-trigger-requests.repository.ts` | repository | `ops.automation_trigger_requests` | I | I | OK | — |
| `clients/clients.repository.ts` | repository | `core.empresa_roles` | RIU | RIU | OK | `clients.controller.ts`, `clients.service.ts` |
| `clients/clients.repository.ts` | repository | `core.empresas` | RIU | RIU | OK | `clients.controller.ts`, `clients.service.ts` |
| `clients/clients.repository.ts` | repository | `core.empresas_fiscales` | RIU | RIU | OK | `clients.controller.ts`, `clients.service.ts` |
| `companies/companies.repository.ts` | repository | `core.alias_empresa` | R | RID | OK | `companies.controller.ts`, `companies.service.ts` |
| `companies/companies.repository.ts` | repository | `core.empresas` | R | RIU | OK | `companies.controller.ts`, `companies.service.ts` |
| `companies/companies.repository.ts` | repository | `core.empresas_fiscales` | R | RIU | OK | `companies.controller.ts`, `companies.service.ts` |
| `companies/company-aliases.repository.ts` | repository | `core.alias_empresa` | RID | RID | OK | `companies.controller.ts`, `companies.service.ts` |
| `contact-directory/contact-directory.repository.ts` | repository | `core.alias_empresa` | R | RID | OK | `contact-directory.controller.ts`, `contact-directory.service.ts` |
| `contact-directory/contact-directory.repository.ts` | repository | `core.contactos` | R | RIU | OK | `contact-directory.controller.ts`, `contact-directory.service.ts` |
| `contact-directory/contact-directory.repository.ts` | repository | `core.empresas` | R | RIU | OK | `contact-directory.controller.ts`, `contact-directory.service.ts` |
| `contact-directory/contact-directory.repository.ts` | repository | `core.medios_contacto` | R | RIU | OK | `contact-directory.controller.ts`, `contact-directory.service.ts` |
| `contact-methods/contact-methods.repository.ts` | repository | `core.contactos` | R | RIU | OK | `contact-methods.controller.ts`, `contact-methods.service.ts` |
| `contact-methods/contact-methods.repository.ts` | repository | `core.empresas` | R | RIU | OK | `contact-methods.controller.ts`, `contact-methods.service.ts` |
| `contact-methods/contact-methods.repository.ts` | repository | `core.medios_contacto` | RIU | RIU | OK | `contact-methods.controller.ts`, `contact-methods.service.ts` |
| `contacts/contacts.repository.ts` | repository | `core.contactos` | RIU | RIU | OK | `contacts.controller.ts`, `contacts.service.ts` |
| `contacts/contacts.repository.ts` | repository | `core.empresas` | R | RIU | OK | `contacts.controller.ts`, `contacts.service.ts` |
| `contacts/contacts.repository.ts` | repository | `core.medios_contacto` | I | RIU | OK | `contacts.controller.ts`, `contacts.service.ts` |
| `providers/providers.repository.ts` | repository | `core.alias_empresa` | R | RID | OK | `providers.controller.ts`, `providers.service.ts` |
| `providers/providers.repository.ts` | repository | `core.empresa_roles` | RIU | RIU | OK | `providers.controller.ts`, `providers.service.ts` |
| `providers/providers.repository.ts` | repository | `core.empresas` | RIU | RIU | OK | `providers.controller.ts`, `providers.service.ts` |
| `providers/providers.repository.ts` | repository | `core.empresas_fiscales` | RIU | RIU | OK | `providers.controller.ts`, `providers.service.ts` |
| `recent-activity/document-series-activity.repository.ts` | repository | `operacion.ajustes_series` | R | RI | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/document-series-activity.repository.ts` | repository | `operacion.series_documentales` | R | RU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/document-series-activity.repository.ts` | repository | `security.users` | R | RIU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/payment-notification-activity.repository.ts` | repository | `core.correos_notificacion_pago` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/payment-notification-activity.repository.ts` | repository | `core.resultados_notificacion_pago` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/recent-activity.repository.ts` | repository | `audit.cambios` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/recent-activity.repository.ts` | repository | `core.contactos` | R | RIU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/recent-activity.repository.ts` | repository | `core.empresa_roles` | R | RIU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/recent-activity.repository.ts` | repository | `core.empresas` | R | RIU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/recent-activity.repository.ts` | repository | `security.users` | R | RIU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/recent-activity.service.ts` | service | `security.users` | R | RIU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-audi-activity.repository.ts` | repository | `operacion.remisiones` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-audi-activity.repository.ts` | repository | `operacion.series_documentales` | R | RU | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-audi-activity.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-audi-activity.repository.ts` | repository | `ops.ejecuciones_automatizacion` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | `core.documentos` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | `operacion.remisiones` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | `operacion.reservas_folios` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | `ops.automatizacion_series_proceso` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | `ops.automatizaciones` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | `ops.ejecuciones_automatizacion` | R | R | OK | `recent-activity.controller.ts`, `recent-activity.service.ts` |
| `security/sessions.repository.ts` | repository | `security.sessions` | RIU | RIU | OK | `auth.controller.ts`, `auth.service.ts`, `login-rate-limiter.service.ts`, `password.service.ts`, `sessions.service.ts`, `users.controller.ts`, `users.service.ts` |
| `security/sessions.repository.ts` | repository | `security.users` | R | RIU | OK | `auth.controller.ts`, `auth.service.ts`, `login-rate-limiter.service.ts`, `password.service.ts`, `sessions.service.ts`, `users.controller.ts`, `users.service.ts` |
| `security/users.repository.ts` | repository | `security.sessions` | U | RIU | OK | `auth.controller.ts`, `auth.service.ts`, `login-rate-limiter.service.ts`, `password.service.ts`, `sessions.service.ts`, `users.controller.ts`, `users.service.ts` |
| `security/users.repository.ts` | repository | `security.users` | RIU | RIU | OK | `auth.controller.ts`, `auth.service.ts`, `login-rate-limiter.service.ts`, `password.service.ts`, `sessions.service.ts`, `users.controller.ts`, `users.service.ts` |

Nota: la relación exacta repository → service → controller se define por inyección de dependencias; aquí se listan los `*.service.ts`/`*.controller.ts` del mismo directorio como aproximación. Detalle de módulos: [hub docs](../hub/README.md).

## Objetos de base de datos que el Hub **no** usa

- Vistas: ninguna de las 10 (incluida `core.vw_empresas_hub`, cuyo nombre sugiere lo contrario).
- Funciones: ninguna de las 13 (salvo indirectamente los 25 triggers).
- Tablas: `core.borradores_notificacion_pago`, `core.empresas_notificacion_pago`, `core.snapshot_carga_empresas_inicial`, `core.stg_contactos_notificacion_pago` y todo `staging.*`.
