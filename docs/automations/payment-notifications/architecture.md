# Notificaciones de pago — Arquitectura

Fuente: export real (no versionado; ver [README](README.md)). Vista general: [00-overview/architecture](../../00-overview/architecture.md).

## Componentes

| Componente | Responsabilidad | No hace |
| --- | --- | --- |
| **n8n — workflow principal** | Sondea Outlook, descomprime ZIP, extrae texto/fecha de cada PDF, clasifica con el catálogo, guarda PDFs, cruza programación semanal, crea borradores en Outlook, registra estado en PostgreSQL, envía el resumen, expone el webhook de reproceso. | No envía correos a proveedores (sólo borradores). Sin subworkflows. |
| **Microsoft Outlook / Graph** | Nodo `microsoftOutlook` y `HTTP Request` a `https://graph.microsoft.com/v1.0/me/messages/…` (adjuntos, firma, actualizar/eliminar borrador) con la credencial OAuth2 `Outlook LOGIN OAUT2`. | — |
| **PostgreSQL** | Estado por correo, por borrador y por proveedor; catálogo (`core.vw_catalogo_notificacion_pago_n8n`). | — |
| **Dropbox** | Origen: programación semanal `CXP\CXP\PROGRAMACIÓN SEMANAL`; destino: carpetas de proveedores (rutas del catálogo, con contención en la raíz); `archivos_procesados.json` (duplicados de PDF), logs y errores. | — |
| **Hub** | Dashboard/detalle y reproceso; llama al webhook con `correo_id`. | No ejecuta el pipeline. |
| **Error Workflow** | PROD referencia un workflow **sin export** (dependencia ausente). | — |

## Estado y idempotencia (por capas)

| Capa | Mecanismo |
| --- | --- |
| Correo | `core.correos_notificacion_pago` (único por `outlook_message_id`): estados `PENDIENTE` → `PROCESADO` / `ERROR`; `resumen_enviado`. `Verificar correo procesado` + `¿Correo nuevo?` impiden reprocesar un correo ya procesado. |
| Borrador | `core.borradores_notificacion_pago` (único por `correo_id`+`empresa_id`): `PENDIENTE` → `CREADO` / `ERROR`; `Reservar borrador` evita crear dos borradores para el mismo proveedor y correo. |
| Resultado | `core.resultados_notificacion_pago` (único por `correo_id`+`empresa_id`): `LISTO`, `MANUAL`, `ERROR`, `OMITIDO`. |
| PDF | `archivos_procesados.json` en `05_ARCHIVOS AUXILIARES` + verificación del archivo destino (`ARCHIVO_DUPLICADO`). **Sigue en uso** (no migrado a PostgreSQL). |

## Seguridad y entornos

- TEST y PROD **comparten** la credencial de Outlook, la firma (carpeta de PROD) y la programación semanal real ([drift](../n8n-test-prod-drift.md#notificaciones-de-pago)).
- El webhook del Hub sólo se autentica con *Header Auth*; ver [reprocessing → seguridad](reprocessing.md#seguridad).
