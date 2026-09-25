# Notificaciones de pago — Runbook de PROD

Workflow: `Produccion Notificacion de pagos a Proveedores` (export no versionado; [README](README.md)). Sin secretos. Instancia n8n **compartida con TEST**.

## Componentes

| Elemento | Valor |
| --- | --- |
| Base | `daubert_global` (credencial `Postgres produccion`) |
| Buzón | Carpeta de Outlook configurada en `Obtener correos Outlook` (credencial `Outlook LOGIN OAUT2`) |
| Origen de comprobantes | ZIP adjunto de correos del administrador de pagos |
| Destino | Carpetas de proveedores en Dropbox (rutas del catálogo) |
| Programación semanal | `Dropbox\CXP\CXP\PROGRAMACIÓN SEMANAL\<año>` |
| Sistema | `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO` (`03_LOGS\<año>`, `04_ERRORES\PDF`, `04_ERRORES\OUTLOOK`, `05_ARCHIVOS AUXILIARES`) |
| Webhook Hub | `POST daubert-hub/notificaciones-pago/reprocesar` (Header Auth `Daubert Hub - n8n PROD`) |
| Error Workflow | ID referenciado **sin export** |

## Operación

| Tarea | Cómo |
| --- | --- |
| **Revisar salud** | n8n: workflow **Active** y ejecuciones periódicas. Hub → Notificaciones de pago: correos recientes; ninguno en `ERROR`/`PENDIENTE` antiguo. |
| **Identificar la ejecución** | Hub: `executionId` = `correo_id`; detalle por proveedor (LISTO/MANUAL/ERROR/OMITIDO). En SQL (sólo lectura): `core.correos_notificacion_pago` por `outlook_message_id`. |
| **Verificar el input** | El correo cumple el filtro (remitente, adjuntos, asunto con "PAGO" y "PROVEEDOR") y está en la carpeta configurada; el ZIP contiene PDFs con "Fecha de aplicación". |
| **Revisar n8n** | Historial del workflow (nodo con error). Los errores de PDF en `04_ERRORES\PDF`, los de Outlook en `04_ERRORES\OUTLOOK`, log diario en `03_LOGS\<año>`. |
| **Revisar PostgreSQL** | Estados de correo/borrador/resultados (ver [troubleshooting](troubleshooting.md)). |
| **Verificar el output** | PDFs en la carpeta del proveedor; **borrador** en Outlook; correo resumen recibido. Recordar: los borradores **no se envían** solos. |
| **Reprocesar** | Hub (cualquier usuario autenticado) o manual en n8n ([reprocessing](reprocessing.md)). Sólo procede si el correo está `ERROR` o `PROCESADO` con resultados `MANUAL`/`ERROR`. |
| **Detener de forma segura** | Desactivar el workflow entre ciclos; también deshabilita el webhook de reproceso (el Hub mostrará error upstream). |
| **Reactivar** | Activar; confirmar el siguiente ciclo. Un correo que quedó `PENDIENTE` por interrupción **no** se retoma solo (ver troubleshooting #4). |
| **Rollback de workflow** | No hay otra versión exportada. Usar el historial de versiones de n8n (no verificado). |
| **Comprobar un solo PROD activo** | Sólo `Produccion Notificacion de pagos a Proveedores` activo. El webhook de TEST tiene el **mismo `path`**: no activar `Test Notificacion…` a la vez. |

## Riesgos operativos

- **Reproceso sin restricción de rol** en el Hub y sin identidad en n8n ([reprocessing → seguridad](reprocessing.md#seguridad)).
- **Correo `PENDIENTE` atascado:** no se vuelve a tomar ni es elegible para el reproceso de n8n.
- **Control de PDFs en un JSON** (`archivos_procesados.json`), fuera de PostgreSQL.
- **Un solo correo por ejecución**: si llegan muchos, se procesan uno por ciclo.
- **Credencial de Outlook, firma y programación semanal compartidas** con TEST.
- **Error Workflow de PROD ausente** del inventario: si falla, no se sabe qué hace.
- Dependencia de la vista `core.vw_catalogo_notificacion_pago_n8n` y de los alias del PDF.
