# Notificaciones de pago — Contrato de base de datos (desde el workflow)

Verificado en el export PROD (credencial `Postgres produccion`) y TEST (`Postgres pruebas`): **mismas consultas**. Todo es **SQL directo** desde nodos `postgres`; no se llama a ninguna función `SECURITY DEFINER`. D3 documentará PostgreSQL objeto por objeto.

## Resumen

| Concepto | Detalle |
| --- | --- |
| Funciones llamadas | **Ninguna** |
| Vista leída | `core.vw_catalogo_notificacion_pago_n8n` (catálogo de proveedores) |
| Tablas leídas | `core.correos_notificacion_pago`, `core.resultados_notificacion_pago`, `core.borradores_notificacion_pago`, `core.empresas` (nombre comercial en el resumen) |
| Tablas escritas | `core.correos_notificacion_pago` (INSERT/UPDATE), `core.borradores_notificacion_pago` (INSERT/UPDATE), `core.resultados_notificacion_pago` (INSERT … ON CONFLICT DO UPDATE) |
| Base | TEST `daubert_hub_test` / PROD `daubert_global` (por el nombre de la credencial) |
| Relación con folios/series | **Ninguna** (no usa `operacion.*` ni `ops.*`) |
| Hub | Lee las mismas tres tablas (`payment-notifications.repository.ts`) y sólo inserta en `ops.automation_trigger_requests` |

## Consultas por nodo

| Nodo | Operación |
| --- | --- |
| `Consultar catálogo BD` | `SELECT * FROM core.vw_catalogo_notificacion_pago_n8n ORDER BY nombre_comercial, alias_pdf` |
| `Verificar correo procesado` | Estado por `outlook_message_id` (`LEFT JOIN`; `NUEVO` si no existe) |
| `Registrar correo pendiente` | `INSERT … VALUES (…, 'PENDIENTE') ON CONFLICT (outlook_message_id) DO NOTHING` |
| `BASELINE CORREOS` (suelto) | `INSERT … 'PROCESADO' … ON CONFLICT DO NOTHING` |
| `Preparar correo para reproceso` | CTE `FOR UPDATE OF c SKIP LOCKED` + `UPDATE` a `PENDIENTE` (limpia `detalle_error`, `resumen_enviado`, fechas) y devuelve `empresas_reintentar` / `archivos_reintentar` |
| `Reservar borrador` | `INSERT INTO core.borradores_notificacion_pago … ON CONFLICT (correo_id, empresa_id) DO NOTHING` (o lee el existente) → `reservado` |
| `Marcar borrador creado` | `UPDATE … estado='CREADO', outlook_draft_id` |
| `Marcar borrador con error` | `UPDATE … estado='ERROR', detalle_error` |
| `Preparar recreación de borrador` | `UPDATE … estado='PENDIENTE', outlook_draft_id=NULL` |
| `Registrar resultado LISTO/MANUAL/ERROR/OMITIDO/reproceso` | `INSERT … ON CONFLICT (correo_id, empresa_id) DO UPDATE` |
| `Evaluar cierre del correo` | Conteo de resultados por estado vs empresas actuales |
| `Finalizar correo procesado` | `UPDATE … estado = 'ERROR'/'PROCESADO'` según resultados con error |
| `Marcar correo con error` / `error1` | `UPDATE … estado='ERROR', detalle_error` concatenado |
| `Consultar resultados para resumen` | Join correos/resultados/empresas/borradores con `resumen_enviado = FALSE` |
| `Marcar resumen enviado` / `Registrar error resumen` | `UPDATE … resumen_enviado`, `fecha_resumen_enviado`, `detalle_error_resumen` |

## Estados

| Entidad | Valores observados |
| --- | --- |
| Correo (`estado`) | `PENDIENTE`, `PROCESADO`, `ERROR` (más `NUEVO` sintético en la lectura) |
| Borrador | `PENDIENTE`, `CREADO`, `ERROR` |
| Resultado | `LISTO`, `MANUAL`, `ERROR`, `OMITIDO` |

## Observaciones para D3

1. Sin funciones intermedias: las reglas de estado viven en SQL embebido en n8n; el rol `n8n_app` (si es el de la credencial) necesita permisos de tabla sobre `core.*` de notificaciones (no se revisaron sus grants).
2. La vista `core.vw_catalogo_notificacion_pago_n8n` es una dependencia crítica (alias, `tipo_empresa`, `ruta_destino`, `correos_para/cc/cco`, `notificaciones_activas`): documentar su definición.
3. Un correo en `PENDIENTE` (registrado pero sin cerrar) **no** vuelve a ser tomado por el sondeo (`¿Correo nuevo?` sólo acepta `NUEVO`) ni es elegible para el reproceso de n8n: ver [troubleshooting](troubleshooting.md#4-un-correo-queda-pendiente).
4. `archivos_procesados.json` (fuera de PostgreSQL) duplica el control de PDFs.
