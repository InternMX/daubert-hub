# Audi — Contrato de base de datos (desde el workflow)

Verificado en el export PROD (`Remisiones AUDI PRODUCCION`, credencial `Postgres produccion`) y TEST (`Remisiones AUDI PRUEBAS`, credencial `Postgres pruebas`; **mismas consultas**). D3 documentará PostgreSQL objeto por objeto; aquí sólo lo que usa el workflow.

## Resumen

| Concepto | Detalle |
| --- | --- |
| **Funciones llamadas** | Una sola: `operacion.reservar_folios(text, integer)` (allocator legado de Audi) |
| **Tablas leídas** | `ops.automatizaciones`, `operacion.series_documentales` (`Leer automatización Audi`); `core.empresas` (`Leer cliente Audi PG`); `core.documentos` (`Registrar documento origen PG`, `Validar candidato PG`); `ops.ejecuciones_automatizacion` (`Validar candidato PG`, `Validar idempotencia PG`); `operacion.remisiones` (verificación de existencia al registrar) |
| **Tablas escritas** | `core.documentos` (INSERT), `ops.ejecuciones_automatizacion` (INSERT y UPDATE), `operacion.remisiones` (INSERT), `operacion.remision_detalle` (INSERT) |
| **Queries directos** | Todos los demás accesos: SQL armado en nodos Code (`sqlText`) o con `{{ }}` |
| **Roles/credenciales** | PROD: `Postgres produccion` (rol `n8n_app` según D1, no demostrable desde el JSON). Los grants directos de `n8n_app` de la migración `20260827_004` (SELECT/INSERT `core.documentos`; SELECT `ops.automatizaciones`; SELECT/INSERT/UPDATE `ops.ejecuciones_automatizacion`; SELECT/UPDATE `operacion.series_documentales`; SELECT/INSERT/UPDATE `operacion.remisiones`; SELECT/INSERT `operacion.remision_detalle`) **corresponden a este patrón** |
| **Base** | TEST `daubert_hub_test` / PROD `daubert_global` (inferido del nombre de credencial) |

## Consultas por nodo

| Nodo | Operación | Notas |
| --- | --- | --- |
| `Leer automatización Audi` | `SELECT … FROM ops.automatizaciones a CROSS JOIN operacion.series_documentales s WHERE a.codigo='REMISIONES_AUDI' AND s.codigo='REMISION_AUDI'` | Códigos fijos |
| `Leer cliente Audi PG` | `SELECT … FROM core.empresas e WHERE to_jsonb(e)::text ILIKE '%AUDI%' … LIMIT 2` | Búsqueda difusa; debe haber 1 |
| `Registrar documento origen PG` | CTE: reutiliza o `INSERT INTO core.documentos` (`PROGRAMACION_ENTREGA`, `DROPBOX`, `ACTIVO`, observación de texto fijo) | Sin `hash_archivo`; la observación dice "…V1 pruebas" también en PROD (texto obsoleto) |
| `Validar candidato PG` | `SELECT` que calcula `ya_completado_pg`/`ya_procesando_pg` por ruta | Sin filtro por hash |
| `Validar idempotencia PG` | `EXISTS` de ejecución `COMPLETADA` para (automatización, documento) | |
| `Crear ejecución PG` | `INSERT INTO ops.ejecuciones_automatizacion (…, estado 'PROCESANDO', iniciada_en now())` | **No** usa `fn_crear_ejecucion_automatizacion`; no hay `ALREADY_*` |
| `Reservar folios PostgreSQL` | `SELECT * FROM operacion.reservar_folios('REMISION_AUDI', {{cantidad}})` | Reserva **no** ligada a la ejecución ni a `operacion.reservas_folios` |
| `Registrar remisiones generadas PG` | CTE: `INSERT INTO operacion.remisiones (… 'GENERADA')` `WHERE NOT EXISTS` (serie+folio no cancelado) y `INSERT INTO operacion.remision_detalle` | Idempotente por (serie, folio); no valida contra una reserva |
| `Cerrar ejecución COMPLETADA PG` | `UPDATE ops.ejecuciones_automatizacion SET estado='COMPLETADA', finalizada_en=now(), error_*=NULL … AND estado='PROCESANDO'` | **No** usa `fn_finalizar_ejecucion_automatizacion` ni verifica integridad de completitud |
| `Execute a SQL query` | `SELECT current_database(), current_user` | Nodo suelto |

## Comparación con el modelo de Caterpillar

| Elemento | Audi | Caterpillar |
| --- | --- | --- |
| Reservas (`operacion.reservas_folios`) | No se usan | Una por (ejecución, serie) |
| `reproceso_de_id` | No se usa | Sí |
| `intentos_fallidos` / `max_intentos` | No se usan | Sí |
| `ops.automatizacion_series_proceso` | No se consulta (fila `AUDI` sembrada por migración `20260922_004`, usada por el ajuste de folio del Hub) | No se consulta desde el workflow (ruteo hardcodeado) |
| Idempotencia de documento | Por ruta, sin hash | Por ruta+hash (`fn_crear_o_resolver_documento`) |
| Integridad de finalización | Ninguna | `fn_finalizar…` la exige |

## Riesgos de contrato (para D3 / correcciones futuras)

1. Las remisiones de Audi **no quedan enlazadas a una reserva**; la integridad folio↔ejecución depende del workflow.
2. Un fallo tras `Crear ejecución PG` deja la ejecución `PROCESANDO` (no hay `fn_registrar_fallo…`).
3. SQL interpolado en texto (riesgo de inyección acotado por escape; patrón frágil).
4. `operacion.reservar_folios` consume folios aunque el proceso falle después (huecos).
5. La observación de `core.documentos` y varios textos dicen "pruebas"/"V1" en PROD.
