# Notificaciones de pago — Runbook de PROD

Workflow activo desde 2026-10-22: **`pagosProdAsignaciones01`** — «Produccion Notificacion de pagos a Proveedores - v2 asignaciones puntuales» (108 nodos). El workflow anterior `3Dh72JJYROHtaw1X` (100 nodos, versión `887c122b`) queda **inactivo** como rollback ([production-rollout](production-rollout.md#d-despliegue-y-rollback)). Exports no versionados ([README](README.md)). Sin secretos. Instancia n8n **compartida con TEST**.

> Las secciones de abajo describen el flujo original (v1), que el v2 conserva; las diferencias están en [production-rollout](production-rollout.md) y en [Asignación puntual de comprobantes](#asignación-puntual-de-comprobantes).

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

## Asignación puntual de comprobantes

Estado: fases A y B habilitadas el 2026-10-22; **sin validar aún con un ZIP real** (ver el [checklist](production-rollout.md#e-validación-y-pendientes)). Hasta completarlo, no usar la asignación ni el reproceso puntual con comprobantes reales.

**Cómo identificar un comprobante con `ALIAS_NO_CATALOGADO`.** Hub → Automatizaciones → Notificaciones de pago → abrir el correo en `ERROR`. El detalle lista cada PDF con error por separado (nombre, código de incidencia y alias detectado). Un PDF cuyo alias no está en el catálogo aparece como `ALIAS_NO_CATALOGADO` (o `ALIAS_AMBIGUO` si coincide con varias empresas).

**Asignar una empresa a un archivo específico.**
1. En el PDF con la incidencia, abrir el diálogo de asignación puntual.
2. Buscar la empresa (mínimo 2 caracteres) y seleccionar la correcta.
3. Confirmar y guardar. La interfaz muestra «Cambio guardado» y el archivo pasa a mostrar la empresa asignada.
4. Con esto **no** se crea ningún alias permanente: solo se vincula ese archivo de ese correo. Los otros PDF del correo (aunque tengan el mismo alias) quedan sin asignación y con su error original.

**Modificar o revocar.** En el mismo archivo se puede cambiar la empresa o revocar la asignación; cada cambio incrementa la versión de la asignación y la API exige la versión vigente: si otra persona la cambió, rechaza el cambio (`POINT_ASSIGNMENT_CHANGED`) y hay que recargar el detalle. Una asignación ya tomada por n8n (archivo `INICIADO`) no se puede cambiar.

**Quién puede asignar.** Cualquier usuario autenticado con acceso a Notificaciones de pago (igual que el reproceso). Las acciones quedan auditadas (`audit.cambios`).

**Cuándo se puede asignar un archivo** (si no, el control aparece bloqueado con el motivo):
- identidad individual del archivo **verificada** (registrada por el workflow; los correos anteriores a la actualización no tienen archivos registrados y no son asignables);
- estado operativo **`SIN_EFECTOS`** (no se puede descartar que haya efectos previos si está `INCIERTO` o `INICIADO`);
- el correo está en `ERROR` o `PROCESADO` y no tiene resultados ni borradores previos;
- la incidencia del Hub coincide con la registrada por el extractor.

**Cuándo se permite o se bloquea el reproceso del correo.**
- Sin asignaciones activas: se comporta como siempre (reproceso de empresas en `MANUAL`/`ERROR`/`OMITIDO` reactivado).
- Con asignaciones activas: el Hub consulta la elegibilidad por archivo; si todas son procesables o reintentables, el botón *Reprocesar* queda disponible. Si alguna no lo es (identidad ambigua o no verificada, efectos inciertos, archivo ya tomado sin evidencia de reintento, versión distinta), el reproceso se bloquea y el detalle indica el archivo y el motivo (`POINT_FILE_REPROCESS_BLOCKED`).
- Con `PROD_N8N_READY=false` (fase A) cualquier asignación activa bloquea el reproceso del correo (`POINT_FILE_N8N_NOT_READY`).
- Un fallo de consulta de elegibilidad también bloquea (nunca autoriza por defecto).

**Qué sucede con el resto del correo.** Al reprocesar, solo se procesa con la empresa asignada el archivo asignado; los demás PDF vuelven a clasificarse por el catálogo permanente (siguen en error si no coinciden). Si la empresa asignada no tiene configuración de notificación completa, el archivo queda en error con el motivo `EMPRESA_ASIGNADA_SIN_CONFIGURACION` y no cae al catálogo. Los archivos ya completados no se reprocesan y no se duplican resultados ni borradores (el reproceso reutiliza el borrador existente).

**Estados: procesamiento original vs. asignación.**

| Nivel | Valores | Significado |
| --- | --- | --- |
| Correo (`core.correos_notificacion_pago.estado`) | `NUEVO`, `PENDIENTE`, `PROCESADO`, `ERROR` | Avance del correo completo |
| Resultado por empresa (`resultados_notificacion_pago`) | `LISTO`, `MANUAL`, `ERROR`, `OMITIDO` | Resultado de cada empresa (la asignación **no** lo modifica; lo produce el reproceso) |
| Archivo (`archivos_notificacion_pago`) | identidad `NO_VERIFICADA`/`VERIFICADA`/`AMBIGUA`; operativo `INCIERTO`/`SIN_EFECTOS`/`REPROCESO_SOLICITADO`/`INICIADO` | Identidad individual del PDF y si ya tuvo efectos |
| Asignación (`asignaciones_archivo_notificacion_pago`) | `ACTIVA`, `REVOCADA` + `version` | Vínculo archivo → empresa |

**Cuando faltan facturas.** Si tras el reproceso la empresa queda en `MANUAL` con motivo de facturas, el comprobante sí se procesó y el borrador existe, pero falta completarlo: agregar las facturas (carpeta del proveedor / programación semanal), revisar el borrador en Outlook y, si hace falta, volver a pulsar *Reprocesar*; el reproceso actualiza el borrador existente sin crear otro. Los borradores **no se envían solos**.

**Deshabilitar sin detener Pagos:** ver [production-rollout §D](production-rollout.md#d-despliegue-y-rollback) (banderas del Hub + recrear solo el `api`).
