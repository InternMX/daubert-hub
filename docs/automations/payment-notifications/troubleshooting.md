# Notificaciones de pago — Troubleshooting

Formato: **síntoma → causa probable → qué revisar → acción segura → qué NO hacer**. Causas derivadas del export real. SQL sólo de lectura. Plataforma: [operations/troubleshooting](../../operations/troubleshooting.md).

## 1. El workflow no dispara / no llegan correos

- **Causa probable:** workflow inactivo; n8n detenido; el correo no cumple el filtro (remitente distinto del dominio configurado, sin adjuntos, asunto sin "PAGO" y "PROVEEDOR"); el correo no está en la carpeta configurada; el límite de 10 correos por sondeo; credencial OAuth de Outlook vencida.
- **Qué revisar:** *Active*; historial; el correo en el buzón (carpeta, remitente, asunto); credencial `Outlook LOGIN OAUT2`.
- **Acción segura:** activar/renovar la credencial y esperar el siguiente ciclo.
- **Qué NO hacer:** no cambiar el filtro de remitente para "probar" en PROD; no activar el workflow de TEST.

## 2. Webhook 404 / 502 al reprocesar desde el Hub

- **Síntoma:** el Hub muestra error al reprocesar (`UPSTREAM_ERROR`, 502).
- **Causa probable:** workflow inactivo (webhook no registrado); token incorrecto (n8n responde 403); URL/token no configurados en la API (en el piloto Docker **no se pasan**: [inconsistencia #13](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)); n8n caído; el **mismo `path`** publicado por dos workflows.
- **Qué revisar:** *Active* del workflow PROD y que TEST esté inactivo; variables de la API (sin imprimir valores); credencial Header Auth.
- **Acción segura:** corregir y reintentar una vez.
- **Qué NO hacer:** no imprimir el token; no activar TEST y PROD a la vez.

## 3. El Hub dice "iniciado" pero no pasó nada

- **Síntoma:** el Hub responde 202 (`TRIGGERED`), pero el correo sigue igual.
- **Causa probable:** n8n contesta 202 **antes** de evaluar. `Preparar correo para reproceso` no encontró filas: el correo está `PENDIENTE` (regla del Hub más laxa que la de n8n), ya lo tomó otra solicitud (`SKIP LOCKED`), o dejó de ser elegible.
- **Qué revisar:** estado del correo y de sus resultados; ejecuciones recientes del webhook en n8n.
- **Acción segura:** si está `PENDIENTE` sin actividad, ver el caso 4.
- **Qué NO hacer:** no repetir el clic en bucle; no editar estados por SQL.

## 4. Un correo queda `PENDIENTE`

- **Síntoma:** `core.correos_notificacion_pago.estado = 'PENDIENTE'` por mucho tiempo.
- **Causa probable:** la ejecución se interrumpió (n8n reiniciado o error no controlado) después de `Registrar correo pendiente`. El sondeo ya no lo toma (`¿Correo nuevo?` exige `NUEVO`) y el reproceso de n8n tampoco (exige `ERROR` o `PROCESADO`).
- **Qué revisar:** log en `03_LOGS`, ejecuciones de n8n, resultados/borradores ya creados (¿hay borradores en Outlook?).
- **Acción segura:** escalar; **procedimiento formal PENDIENTE**. La vía prevista es dejarlo en `ERROR` de forma controlada para poder reprocesarlo, con aprobación y respaldo, verificando antes qué borradores ya existen para evitar duplicados.
- **Qué NO hacer:** no borrar el correo ni sus resultados; no reprocesar sin revisar borradores existentes.

## 5. PDF no clasificado (`ALIAS_NO_CATALOGADO` / `ALIAS_AMBIGUO`)

- **Causa probable:** el alias del PDF no está en el catálogo o coincide con más de un proveedor.
- **Qué revisar:** el resumen por correo (motivo por archivo), `04_ERRORES\PDF`, el catálogo (`core.vw_catalogo_notificacion_pago_n8n`). En el Hub, el detalle de la ejecución lista estos archivos en "Archivos que requieren atención".
- **Acción segura:** corregir el catálogo **desde el Hub** (alias de la empresa, [company-configuration](company-configuration.md)) y **reprocesar** el correo.
- **Qué NO hacer:** no mover el PDF a mano a la carpeta del proveedor (queda fuera del control de duplicados).

> Si el problema es de **alta o configuración de una empresa** (no permite activar, no permite quitar un destinatario, ruta Dropbox), ver [company-configuration → troubleshooting](company-configuration.md#troubleshooting-breve). Los errores de archivo (PDFs sin empresa) se explican en el [README](README.md#errores-de-archivo-vs-resultados-por-empresa).

## 6. Errores de ruta (`RUTA_PROVEEDOR_FUERA_DE_ROOT`, `CARPETA_PROVEEDOR_NO_EXISTE`, `RUTA_FUERA_DE_DROPBOX`, `PLANTILLA_RUTA_INVALIDA`, `RUTA_DESTINO_VACIA`)

- **Causa probable:** ruta destino del catálogo inválida, carpeta del proveedor inexistente o fuera de la raíz permitida.
- **Qué revisar:** `ruta_destino` en el catálogo; que la carpeta exista en Dropbox.
- **Acción segura:** crear la carpeta / corregir el catálogo y reprocesar.
- **Qué NO hacer:** no ampliar la raíz permitida ni desactivar la contención de rutas.

## 7. `FECHA_PAGO_NO_ENCONTRADA` / programación semanal

- **Causa probable:** el PDF no trae "Fecha de aplicación: dd/mm/aaaa"; el Excel de la semana no existe (`ARCHIVO_PROGRAMACION_NO_ENCONTRADO`, `CARPETA_ANIO_NO_ENCONTRADA`) o hay varios (`VARIOS_ARCHIVOS_PROGRAMACION`).
- **Qué revisar:** el PDF; `CXP\CXP\PROGRAMACIÓN SEMANAL\<año>`.
- **Acción segura:** corregir el archivo/carpeta y reprocesar. Sin programación el flujo continúa sin facturas (resultado `MANUAL`).
- **Qué NO hacer:** no dejar dos programaciones de la misma semana.

## 8. Borrador no creado o incompleto (`ERROR_CREANDO_BORRADOR`, `BORRADOR_INCOMPLETO`, `ERROR_ADJUNTANDO_ARCHIVO`)

- **Causa probable:** credencial de Outlook, límites de Graph, adjunto demasiado grande o archivo no legible, destinatarios inválidos (`CORREOS_INVALIDOS`, `SIN_DESTINATARIOS_PARA`).
- **Qué revisar:** `04_ERRORES\OUTLOOK`; el resumen; los borradores del buzón; destinatarios en el catálogo.
- **Acción segura:** corregir la causa y reprocesar (el flujo actualiza o recrea el borrador).
- **Qué NO hacer:** no enviar manualmente un borrador incompleto; no crear borradores duplicados a mano.

## 9. El resumen no llegó

- **Causa probable:** falló `Send a message` (`Registrar error resumen`, campo `detalle_error_resumen`); credencial de Outlook.
- **Qué revisar:** `core.correos_notificacion_pago.resumen_enviado` y `detalle_error_resumen`.
- **Acción segura:** el reproceso vuelve a poner `resumen_enviado = FALSE`; resolver la causa y reprocesar.
- **Qué NO hacer:** no marcar `resumen_enviado` por SQL.

## 10. Notificaciones "omitidas"

- **Causa probable:** el proveedor tiene `notificaciones_activas = false` (`NOTIFICACION_DESACTIVADA`) → resultado `OMITIDO`, sin borrador (es intencional).
- **Acción segura:** activar "Generar borradores" desde el Hub si el negocio lo requiere (exige ruta Dropbox, "Procesa comprobantes" y al menos un PARA; ver [company-configuration](company-configuration.md)) y reprocesar.

## 11. Duplicados

- **Causa probable:** `ARCHIVO_DUPLICADO` (PDF ya registrado en `archivos_procesados.json` o ya existe en destino); o borradores repetidos si se recrearon a mano.
- **Qué revisar:** `05_ARCHIVOS AUXILIARES\archivos_procesados.json` (no editar) y la carpeta destino.
- **Qué NO hacer:** no editar el JSON de procesados.

## 12. El Error Workflow falla

- **Síntoma:** errores no registrados.
- **Causa probable:** PROD referencia un workflow de errores **sin export** (dependencia ausente); puede haber sido eliminado o inactivo.
- **Qué revisar:** en n8n, la configuración del workflow (*Error Workflow*) y que el workflow referenciado exista y esté activo.
- **Acción segura:** identificarlo, exportarlo y versionarlo ([n8n-dependencies](../n8n-dependencies.md)).

## 13. PostgreSQL sin conexión / credencial incorrecta

- **Causa probable:** PostgreSQL caído; credencial `Postgres pruebas` en PROD o viceversa.
- **Qué revisar:** las credenciales de los nodos `postgres`.
- **Acción segura:** restablecer y reasignar la credencial correcta; reprocesar los correos afectados.

## 14. TEST funciona y PROD no (o al revés)

- **Causa probable:** filtro de remitente/carpeta/límite distintos; `MODO`; PROD tiene el resumen con errores por archivo que TEST no; TEST comparte Outlook/firma/programación con PROD.
- **Qué revisar:** [n8n-test-prod-drift](../n8n-test-prod-drift.md#notificaciones-de-pago).
- **Qué NO hacer:** no probar en TEST con el buzón de PROD sin aislar la carpeta/remitente.
