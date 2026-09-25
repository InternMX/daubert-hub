# Notificaciones de pago — Pruebas

## Qué hay en el repositorio

| Capa | Archivos | Cubre |
| --- | --- | --- |
| API (unitarias) | `payment-notifications.controller.spec.ts`, `payment-notifications.service.spec.ts`, `payment-notifications.repository.spec.ts`, `payment-notifications-webhook.client.spec.ts`, `payment-notification-status.spec.ts`, `payment-notification-reason.spec.ts` | Listado/detalle, elegibilidad de reproceso del Hub, cliente del webhook (sin interpretar la respuesta), estados y motivos |
| API (integración con BD de TEST) | `payment-notifications.integration.runner.cjs` (**incluido** en `npm run test:integration`) | Consultas sobre las tablas de notificaciones |
| Frontend | `PaymentNotificationsPage.test.tsx`, `PaymentNotificationExecutionDetailPage.test.tsx`, `paymentNotifications.test.ts`, `paymentNotificationPresentation.test.ts` | Dashboard y detalle (incluye errores de archivo) |
| Configuración por empresa (API/Web/integración) | Ver [Entrega de configuración por empresa](#entrega-de-configuración-por-empresa-2026-09-25) | Ajustes, readiness, invariante del último PARA, sugerencia de ruta Dropbox, flags de destinatario, ayudas contextuales |
| **Workflow n8n** | **Ninguna prueba automatizada** | Sólo manual en TEST |

## Entrega de configuración por empresa (2026-09-25)

Evidencia final de pruebas de la feature [company-configuration](company-configuration.md) (código en `main`, commits `c7e3991`, `c4a9cf3`/`36de43f`, `815507e`). Es evidencia de código y de la base de **TEST**; el workflow n8n no cambió.

**API**

| Comprobación | Resultado |
| --- | --- |
| Vitest | 115 archivos, **1455 tests** pasaron |
| typecheck / lint / build | PASS |

**Integración** — `payment-notification-settings.integration.runner.cjs` (`npm run test:integration:payment-notification-settings`):

- El runner valida explícitamente que la base activa sea `daubert_hub_test` y se niega a ejecutarse contra otra.
- Los checks pasaron.
- Se verificó la limpieza de los datos de negocio creados (empresas, contactos, medios, alias, configuración).
- Por diseño, `security.users` y `security.sessions` requieren **limpieza administrativa**: el rol de aplicación no tiene `DELETE` sobre ellas, así que los usuarios sintéticos de integración pueden quedar en TEST hasta que un rol administrativo los retire. Es una tarea operativa de TEST, no una deuda funcional del módulo.

**Web**

| Comprobación | Resultado |
| --- | --- |
| Suite completa | 73 archivos |
| `ProviderDropboxPath` aislado | 10/10 PASS |
| `NewUserPage` aislado | 8/8 PASS |
| typecheck / lint / build | PASS |

Flakiness/timeouts observados bajo carga en la suite completa (timeouts ocasionales de 5 s en tests de UI), con los casos afectados pasando al ejecutarse aisladamente; no hubo fallos de aserción funcionales asociados. Otros casos inestables observados durante la misma tanda también pasaron aislados. No se modificaron timeouts ni se aplicó ninguna otra mitigación: queda como deuda técnica menor de la suite Web.

Validación funcional posterior en PROD: [nota de despliegue](../../deployments/2026-09-25-payment-notification-config-prod.md#final-functional-validation-prod).

## Prueba manual en TEST (checklist)

> ⚠️ **TEST comparte** la credencial de Outlook y la firma con PROD, y lee la **programación semanal real**. Además TEST está **detrás de PROD** en el resumen por correo. Extremar cuidado: usar carpeta de buzón y remitente de pruebas (el filtro de TEST es un dominio interno) y destinatarios de prueba (el resumen de TEST sólo va al correo de pruebas). El **mismo `path` de webhook** existe en TEST y PROD.

| Caso | Esperado |
| --- | --- |
| Correo de prueba con ZIP de comprobantes de 1 proveedor | Correo `PROCESADO`; PDF en la carpeta del proveedor de `Pruebas\NOTIFICACIONES DE PAGO`; **borrador** en Outlook con adjuntos y firma; resultado `LISTO`; correo resumen |
| Mismo correo otra vez | No se reprocesa (estado ≠ `NUEVO`) |
| PDF cuyo alias no está en el catálogo | Resultado `ERROR`/`MANUAL`, PDF en `04_ERRORES\PDF`, correo `ERROR`; resumen con el motivo |
| Proveedor con `notificaciones_activas = false` | Resultado `OMITIDO` (`NOTIFICACION_DESACTIVADA`), sin borrador |
| Sin programación semanal | Continúa con `SIN_FACTURAS_PROGRAMACION` (resultado `MANUAL`) |
| PDF duplicado | `ARCHIVO_DUPLICADO` |
| **Reproceso** desde el Hub de un correo en `ERROR` | 202; el correo pasa a `PENDIENTE` y se reintentan sólo empresas/archivos con problema; borrador actualizado o recreado |
| Reproceso de un correo `PROCESADO` sin problemas | El Hub responde 409 (`NOT_ELIGIBLE`) |
| Reproceso de un correo `PENDIENTE` con resultados `MANUAL` | El Hub responde 202 pero **n8n no hace nada** (discrepancia documentada) |
| Sin token / token incorrecto | n8n rechaza (403); el Hub muestra `UPSTREAM_ERROR` |

## Validación del resultado (manual)

1. Borrador: destinatarios PARA/CC/CCO según catálogo; asunto; adjuntos (comprobantes + facturas); firma.
2. PDFs en la carpeta de proveedor correcta y sin duplicados.
3. Filas en `correos`, `borradores` y `resultados` coherentes (un resultado por proveedor).
4. Resumen recibido con el detalle por proveedor.

## Promoción TEST → PROD

- [ ] Verificar el filtro de remitente, la carpeta y el límite de `Obtener correos Outlook`, `MODO = PRODUCCION`, credenciales PG y Header Auth de PROD.
- [ ] Destinatarios del resumen (`Send a message`) correctos para PROD.
- [ ] Confirmar el **Error Workflow** de PROD (hoy sin export).
- [ ] **Paridad TEST/PROD:** llevar a TEST lo que PROD ya tiene (p. ej. `Preparar resumen Sofi`).
- [ ] Un solo workflow activo por `path` de webhook.
- [ ] Decidir el versionado del export (ver [security-notes](../../../n8n/security-notes.md)).
