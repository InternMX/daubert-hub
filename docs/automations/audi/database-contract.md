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

## Verificación contra PostgreSQL (Fase D3)

Contrastado el 2026-09-24 con el catálogo real de PROD y TEST (solo lectura). Contraste automático workflow ↔ grants: [n8n-contract](../../database/n8n-contract.md#audi-prod-rol-n8n_app-base-daubert_global) (0 brechas de privilegio). Detalle del allocator: [audi-legacy-allocator](../../database/audi-legacy-allocator.md).

### Confirmado

| Afirmación previa | Resultado |
| --- | --- |
| Solo `operacion.reservar_folios(text,integer)` como función | **CONFIRMED** en ambos workflows (PROD/TEST) |
| Grants de `n8n_app` = patrón de la migración `20260827_004` | **CONFIRMED**: `core.documentos` `I/R`; `ops.automatizaciones` `R`; `ops.ejecuciones_automatizacion` `I/R/U`; `operacion.series_documentales` `R/U`; `operacion.remisiones` `I/R/U`; `operacion.remision_detalle` `I/R`; más `core.empresas` `R` (lo usa `Leer cliente Audi PG`) |
| Audi no usa reservas, `reproceso_de_id` ni reintentos | **CONFIRMED** (no hay llamadas a las funciones del modelo Caterpillar ni `INSERT` en `reservas_folios`) |
| Crea y cierra ejecuciones por SQL directo | **CONFIRMED** (`INSERT` con estado `PROCESANDO` y `UPDATE … COMPLETADA`) |

### Precisiones de la base

1. **Tablas que lee/escribe (verificado en los nodos):** lee `ops.automatizaciones`, `operacion.series_documentales`, `core.empresas`, `core.documentos`, `ops.ejecuciones_automatizacion`, `operacion.remisiones`; escribe `core.documentos` (INSERT), `ops.ejecuciones_automatizacion` (INSERT, UPDATE), `operacion.remisiones` (INSERT), `operacion.remision_detalle` (INSERT). `n8n_app` tiene además `UPDATE` sobre `operacion.remisiones` que **ningún nodo usa**.
2. **Allocator legado:** `SECURITY INVOKER`, sin reserva ni ownership; por eso necesita `UPDATE` directo sobre `series_documentales`. Rechaza rangos que choquen con remisiones activas, pero no deja rastro del rango. Ver [comparación](../../database/audi-legacy-allocator.md).
3. **Restricciones que sí aplican a Audi:** `uq_ejecuciones_automatizacion_procesando` (una `PROCESANDO` por automatización+documento), `uq_ejecuciones_automatizacion_completada_original`, `uq_remisiones_serie_folio_no_cancelada` (un folio activo por serie), `ck_ejecuciones_automatizacion_*`, `chk_documentos_*` e índices únicos de documento por ruta (el workflow inserta sin `hash_archivo`, así que se rige por `uq_documentos_empresa_ruta_sin_hash_normalizada`).
4. **Funciones que Audi podría llamar pero no llama:** `fn_crear_ejecucion_automatizacion`, `fn_finalizar_ejecucion_automatizacion`, `fn_registrar_fallo_ejecucion` (todas con `EXECUTE` para `n8n_app` en PROD); en TEST el `n8n_app` **no** tiene `EXECUTE` de ellas (solo `n8n_cat_test`), así que migrar Audi a funciones exigirá un `GRANT` en TEST o un rol propio.
5. **`PROCESANDO` y recuperación:** en la base **no** existe ningún mecanismo de recuperación (sin `pg_cron` ni otra extensión —solo `plpgsql—, sin función/trigger de expiración), y los 3 sub-workflows compartidos de Audi (`generacion-hojas-identificacion`, `generacion-pdfs`, `manejador-errores`) **no contienen nodos con credencial `postgres`**: ningún componente versionado marca `ERROR` una ejecución que falló tras `Crear ejecución PG`. Efecto: esa ejecución queda `PROCESANDO` y el índice único bloquea un nuevo `INSERT` para el mismo documento (`23505`) hasta intervención manual. Si existen filas en ese estado: **UNKNOWN** (requiere `SELECT`; ver [troubleshooting](../../database/troubleshooting.md#ejecución-en-procesando)).
6. **Series:** el código de serie `REMISION_AUDI` es un dato (no se pudo leer `siguiente_folio`); ver [folios](../../database/folios.md).
7. **TEST vs PROD:** mismas consultas, mismo `n8n_app` con los mismos privilegios de tabla; sin drift estructural.
