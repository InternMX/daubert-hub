# Notificaciones de pago

Documentado en la Fase D2 **a partir de los exports reales**. Los JSON **no están versionados** (DO_NOT_VERSION por contener correos y firma corporativa: [n8n/security-notes](../../../n8n/security-notes.md)); la lectura se hizo directamente sobre los originales de Dropbox (sin modificarlos): `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO\Produccion Notificacion de pagos a Proveedores.json` (PROD) y `PRUEBAS\NOTIFICACIONES DE PAGO\Test Notificacion de pagos a Proveedores.json` (TEST). **Manda el export.**

| | |
| --- | --- |
| Código de automatización | `PAYMENT_NOTIFICATIONS` |
| Workflow PROD | `Produccion Notificacion de pagos a Proveedores` — activo, 100 nodos |
| Workflow TEST | `Test Notificacion de pagos a Proveedores` — inactivo al exportar, 100 nodos |
| Disparos | **Automático:** `Schedule Trigger` → `Obtener correos Outlook` (sondeo del buzón; intervalo sin valor explícito en el export) · **Manual:** `Reprocesar correo manual` · **Hub:** webhook `POST daubert-hub/notificaciones-pago/reprocesar` |
| Credenciales | `Postgres produccion` / `Postgres pruebas`; `Outlook LOGIN OAUT2` (**la misma en TEST y PROD**); `Daubert Hub - n8n PROD` / `… TEST` (Header Auth del webhook) |
| Error Workflow | PROD: referencia un workflow **sin export** (dependencia ausente). TEST: ninguno |
| Hub | Dashboard, detalle, **reproceso** (`POST /api/automations/payment-notifications/:executionId/reprocess`, sin restricción de rol), acuses de revisión y **configuración por empresa** ([company-configuration](company-configuration.md)) |

## Propósito

Lee correos de Outlook que traen **comprobantes de pago en un ZIP** (del administrador de pagos), extrae cada PDF, lo **clasifica por proveedor** con un catálogo en PostgreSQL, guarda el PDF en la **carpeta del proveedor** en Dropbox, cruza con la **programación semanal de CXP** y **crea en Outlook un borrador** de notificación por proveedor (con comprobantes y facturas adjuntos y la firma corporativa). Al terminar envía un **correo resumen** interno. **No envía nada a los proveedores automáticamente**: sólo crea borradores; sólo el resumen se envía.

## Trigger actual (verificado)

- **Sí existe** un disparador automático: el `Schedule Trigger` sondea la carpeta configurada del buzón de Outlook (`getAll`, límite 10 en PROD y 4 en TEST) — **no** es un trigger por evento de correo de n8n. El valor del intervalo no está explícito en el export (`{"field":"minutes"}`); el catálogo del Hub indica 5 min. **Sin verificar en n8n.**
- Procesa **un correo por ejecución** (`Tomar un correo por ejecución`).
- Existe además el disparo manual y el webhook del Hub para **reprocesar**.

## Mapa de documentos

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Componentes y responsabilidades |
| [workflow.md](workflow.md) | Flujo principal, reproceso y errores (Mermaid); reglas verificadas |
| [nodes-reference.md](nodes-reference.md) | Referencia de nodos |
| [company-configuration.md](company-configuration.md) | **Configuración por empresa desde el Hub** (ruta Dropbox, destinatarios PARA/CC/CCO, readiness, migración 011) |
| [database-contract.md](database-contract.md) | Contrato PostgreSQL |
| [reprocessing.md](reprocessing.md) | Reproceso, contrato con el Hub, **seguridad** |
| [testing.md](testing.md) | Pruebas y promoción |
| [production-runbook.md](production-runbook.md) | Operación en PROD |
| [troubleshooting.md](troubleshooting.md) | Guía de fallos |
| Comparación TEST/PROD | [n8n-test-prod-drift](../n8n-test-prod-drift.md#notificaciones-de-pago) |

## Categorías de proveedor

Las categorías **FLETES**, **PROVEEDORES** y **PROVEEDOR DE SERVICIOS** **no están escritas en el workflow**: llegan del catálogo de PostgreSQL (vista `core.vw_catalogo_notificacion_pago_n8n`, campo `tipo_empresa`) junto con alias del PDF, plantilla de ruta destino, destinatarios PARA/CC/CCO y el indicador `notificaciones_activas`. En TEST existen carpetas `FLETES`, `PROVEEDORES` y `PROVEEDOR DE SERVICIOS` bajo `Pruebas\NOTIFICACIONES DE PAGO`. Tratamiento especial visible en el workflow: importes de **DHL** (`IMPORTES_DHL`, `SIN_IMPORTES_DHL`).

## Configuración de empresas desde el Hub

Desde 2026-09-25 la configuración necesaria para que una empresa participe (ruta Dropbox, destinatarios PARA/CC/CCO, "Procesa comprobantes" y "Generar borradores") se hace **desde el Hub, sin SQL manual**. PostgreSQL sigue siendo la fuente de verdad y n8n (sin cambios) consume el catálogo `core.vw_catalogo_notificacion_pago_n8n`. Detalle, reglas, endpoints y procedimiento: [company-configuration](company-configuration.md).

## Errores de archivo vs resultados por empresa

El Hub separa dos universos:

- **Resultados por empresa** (`core.resultados_notificacion_pago`: `LISTO`/`MANUAL`/`ERROR`/`OMITIDO`). `totalResults` y los contadores por estado cuentan **solo** estos.
- **Errores de archivo**: PDFs que n8n no pudo asociar a ninguna empresa (no tienen `empresa_id`). n8n los registra en `core.correos_notificacion_pago.detalle_error` con el formato `<archivo>: <CODIGO> - <detalle> | HASH=<sha256>`.

Comportamiento del Hub:

- El API los parsea y los expone como `fileErrors` (conteo, en el listado y el detalle) y `fileErrorDetails` (`fileName`, `errorCode`, `detail`, `fileHash`, solo en el detalle). **No** suman a `totalResults` ni se convierten en filas por empresa.
- Se muestran por separado: columna **"Errores archivo"** en el listado y sección **"Archivos que requieren atención"** en el detalle. El hash es un dato técnico y no se muestra.
- Si `detalle_error` trae varios registros (por salto de línea o inline separados por `" | "`), cada uno con un `HASH=` válido se parsea individualmente; lo que no cumple el formato se omite.
- n8n sigue siendo dueño del reproceso selectivo por `correo_id`/hash; este contrato no cambió.
