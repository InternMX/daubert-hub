# Notificaciones de pago — Referencia de nodos

Workflow PROD `Produccion Notificacion de pagos a Proveedores` (100 nodos; TEST idéntico en estructura). Nombres **exactos**. Sin copiar JavaScript. Los nodos "(PG)" usan `Postgres produccion` (TEST: `Postgres pruebas`); los de Outlook, `Outlook LOGIN OAUT2`. Flujo: [workflow.md](workflow.md).

## 1. Disparadores

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Schedule Trigger` | scheduleTrigger | Sondeo periódico (intervalo no explícito en el export) |
| `Reprocesar correo manual` | manualTrigger | Reproceso manual |
| `Hub - Reprocesar notificación` | webhook | `POST daubert-hub/notificaciones-pago/reprocesar`, Header Auth, responde 202 |

## 2. Selección y registro del correo

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Obtener correos Outlook` | microsoftOutlook (getAll) | Lista mensajes de la carpeta configurada (límite 10 PROD / 4 TEST) |
| `¿Correo válido de pagos?` | if | Remitente del dominio configurado + con adjuntos + asunto "PAGO(S)" y "PROVEEDOR(ES)" |
| `Verificar correo procesado` | postgres | Estado del correo por `outlook_message_id` (`NUEVO` si no existe) |
| `¿Correo nuevo?` | if | Sólo estado `NUEVO` |
| `Tomar un correo por ejecución` | code | Toma el primero |
| `Registrar correo pendiente` | postgres | `INSERT … ON CONFLICT DO NOTHING` con estado `PENDIENTE` |
| `Contexto correo` | set | Fija el contexto del correo (incluye `es_reproceso`, `empresas_reintentar`, `archivos_reintentar` en reproceso) |
| `BASELINE CORREOS` | postgres | **Suelto**: inserta correos como `PROCESADO` (herramienta manual de línea base) |

## 3. Adjuntos, ZIP y catálogo

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Obtener adjuntos del correo` | microsoftOutlook | Adjuntos del mensaje |
| `¿Es ZIP?` | if | Detecta ZIP no inline |
| `Download an attachment` | microsoftOutlook | Descarga el ZIP |
| `Consultar catálogo BD` | postgres | `SELECT * FROM core.vw_catalogo_notificacion_pago_n8n` |
| `Empaquetar catalogo` | code | Empaqueta el catálogo en un ítem |
| `Sincronizar ZIP y catálogo` | merge | Une ZIP y catálogo |
| `Preparar metadatos ZIP` | code | Valida el binario y nombre |
| `Compression` | compression | Descomprime el ZIP |
| `Separar archivos descomprimidos` | code | Un ítem por archivo; error si el ZIP está vacío |

## 4. PDF: texto, fecha y clasificación

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Extraer texto PDF` | extractFromFile | Texto del PDF |
| `Extraer fecha de pago` | code | `Fecha de aplicación: dd/mm/aaaa` |
| `Configurar entorno` | code | **`MODO` = `PRODUCCION` o `PRUEBAS`**, raíces y carpetas (crea las carpetas de logs/errores/auxiliares/firma) |
| `Calcular identidad PDF` | code | Identidad/hash del PDF |
| `Clasificar con catalogo` | code | Alias → proveedor; arma `ruta_destino` desde la plantilla del catálogo con contención en la raíz; códigos de error de clasificación |
| `¿Procesar en esta ejecución?` | if | En reproceso, sólo empresas/archivos a reintentar |
| `Verificar duplicados` | code | `archivos_procesados.json` + destino; `ARCHIVO_DUPLICADO` |
| `¿Archivo listo?` / `¿Es un error?` / `¿Archivo ya existe?` | if | Ramificación listo / error / ya existe |
| `Guardar en proveedor` | readWriteFile (write) | Escribe el PDF en la carpeta del proveedor (salida de error habilitada) |
| `Guardar en errores` | readWriteFile (write) | Escribe PDFs con error en `04_ERRORES\PDF` (salida de error habilitada) |
| `Preparar error de escritura` | code | `ERROR_AL_ESCRIBIR_PDF` |
| `Unir archivos listos` | merge | Une listos y ya existentes |
| `Registrar log` | code | Añade al log diario (`03_LOGS\<año>`) |
| `Registrar procesados` | code | Actualiza `archivos_procesados.json` sólo con lo ya guardado |

## 5. Programación semanal y facturas

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Buscar programación semanal` | code | Localiza el Excel de la semana ISO en `CXP\CXP\PROGRAMACIÓN SEMANAL\<año>` |
| `¿Programación disponible?` | if | Sí → leer; no → sin programación |
| `Leer programación semanal` → `Extraer programación XLSX` → `Normalizar programación semanal` → `Agrupar facturas por empresa` | readWriteFile / extractFromFile / code | Lee y normaliza facturas por proveedor (salidas de error habilitadas en lectura/extracción) |
| `Sin programación disponible` | code | Marca `NO_ENCONTRADA` y continúa sin facturas |
| `Agrupar comprobantes por empresa` | code | Agrupa por proveedor; valida destinatarios PARA/CC/CCO |
| `Sincronizar comprobantes y facturas` (merge) → `Integrar facturas con comprobantes` | merge / code | Cruza comprobantes con facturas |

## 6. Borrador y estado por proveedor

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Preparar vista previa del correo` | code | Asunto/cuerpo HTML (con firma), PARA/CC/CCO, estado `VISTA_PREVIA_GENERADA`, validaciones |
| `¿Puede crear borrador?` | if | Estado `VISTA_PREVIA_GENERADA` + adjuntos > 0 + `notificaciones_activas` |
| `¿Notificación desactivada?` | if | `notificaciones_activas = false` |
| `Reservar borrador` | postgres | Inserta o recupera en `core.borradores_notificacion_pago` (`reservado`) |
| `¿Reserva nueva?` / `¿Reutilizar borrador?` / `¿Error para reprocesar?` / `¿Tiene borrador de error?` | if | Lógica de reproceso de borradores |
| `Sincronizar reserva y vista previa` | merge | Une reserva y vista previa |
| `Microsoft Outlook: Crear borrador` | microsoftOutlook (draft) | Crea el borrador (`to/cc/bcc`, asunto, HTML) |
| `Guardar datos del borrador` / `Merge` | set / merge | Conserva `draft_id` |
| `Preparar firma Outlook` → `Agregar firma al borrador` → `Validar firma Outlook` | code / httpRequest (Graph) / code | Inserta la firma inline |
| `Separar comprobantes` → `Leer comprobante para Outlook` → `Merge1` → `Preparar adjunto Graph` → `Agregar adjunto al borrador` | splitOut / readWriteFile / merge / code / httpRequest (Graph) | Adjunta cada comprobante |
| `Validar resultados Outlook` | code | Verifica adjuntos (`BORRADOR_CREADO`) |
| `Marcar borrador creado` | postgres | `UPDATE … estado 'CREADO', outlook_draft_id` |
| `¿Borrador completo?` | if | Información completa → `LISTO`, si no → `MANUAL` |
| `Actualizar borrador existente` / `Eliminar borrador con error` | httpRequest (Graph) | Reproceso de borradores |
| `Recuperar contexto borrador reutilizado` / `Recuperar contexto borrador con error` | code | Contexto tras reutilizar/eliminar |
| `Preparar recreación de borrador` | postgres | Deja el borrador `PENDIENTE` y sin `outlook_draft_id` |
| `Registrar pendiente de notificación` | code | Motivos por los que no hay borrador (`SIN_ZIP`, `SIN_EMPRESA`, `SIN_COMPROBANTES`, `CORREOS_INVALIDOS`…) |
| `Registrar notificación omitida` / `Preparar procesados omitidos` | code | `NOTIFICACION_DESACTIVADA` |
| `Registrar resultado Outlook` | code | Registro local del resultado |
| `Preparar error Outlook` | code | Errores de Outlook a `04_ERRORES\OUTLOOK` |

## 7. Resultados y cierre del correo (PG)

| Nodo | Propósito |
| --- | --- |
| `Registrar resultado LISTO` / `MANUAL` / `ERROR` / `OMITIDO` / `Registrar resultado reproceso` | Upsert en `core.resultados_notificacion_pago` |
| `Marcar borrador con error`, `Marcar correo con error`, `Marcar correo con error1` | Marcan `ERROR` en borrador y correo (con detalle) |
| `Evaluar cierre del correo` | Calcula si todos los proveedores esperados tienen resultado (`cierre_completo`) |
| `¿Terminó el correo?` | Sí → `Finalizar correo procesado` |
| `Finalizar correo procesado` | `PROCESADO` o `ERROR` con detalle |

## 8. Resumen por correo

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Consultar resultados para resumen` | postgres | Resultados del correo (`resumen_enviado = FALSE`) |
| `Preparar resumen Sofi` | code | Arma asunto/cuerpo del resumen (PROD incluye errores por archivo con código, detalle y hash) |
| `Send a message` | microsoftOutlook (send) | Envía el resumen (**único envío real**; salida de error habilitada) |
| `Marcar resumen enviado` / `Registrar error resumen` | postgres | `resumen_enviado` o `detalle_error_resumen` |

## 9. Reproceso (nodos propios)

`Hub - Reprocesar notificación`, `Preparar solicitud Hub reproceso`, `Reprocesar correo manual`, `Seleccionar correo a reprocesar`, `Preparar correo para reproceso` (ver [reprocessing](reprocessing.md)).

## Notas adhesivas

`Sticky Note` (contiene el dominio del remitente esperado) y `Sticky Note1` ("En caso de algún error, corregir los problemas y modificar este nodo con el correo_id a reprocesar").

## 10. Nodos de la versión v2 (asignación puntual)

Workflow `pagosProdAsignaciones01` (108 nodos) = el anterior de 100 + 8 nodos nuevos (los de PostgreSQL usan `Postgres produccion`; los «Aplicar…» son Code que interpretan el resultado estructurado): `Registrar archivo (identidad)`, `Aplicar registro de archivo`, `Resolver asignacion puntual`, `Aplicar asignacion puntual`, `Registrar archivo (incidencia)`, `Aplicar registro de incidencia`, `Tomar archivo (inicio de procesamiento)`, `Aplicar toma de archivo`. Modificados: `Preparar metadatos ZIP`, `Separar archivos descomprimidos`, `Calcular identidad PDF`, `Clasificar con catalogo`, `Verificar duplicados`, `¿Procesar en esta ejecución?`, `Registrar correo pendiente`, `Preparar correo para reproceso`, `Configurar entorno` (política de zona). Ver [production-rollout §B](production-rollout.md#b-implementación-técnica).
