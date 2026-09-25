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
| Hub | Lee las tablas de correos/resultados (`payment-notifications.repository.ts`), inserta en `ops.automation_trigger_requests` y, desde 2026-09-25, **administra `core.empresas_notificacion_pago`** (`SELECT/INSERT/UPDATE`) y los flags de `core.medios_contacto` ([company-configuration](company-configuration.md)) |

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

## Verificación contra PostgreSQL (Fase D3)

Contrastado el 2026-09-24 con el catálogo real (solo metadata; **no se leyeron correos, contactos ni destinatarios**). El export de este workflow **no está versionado**, así que lo que sigue verifica la **base** contra lo descrito arriba (D2); el uso real por nodo sigue siendo el que D2 documentó (INFERRED para D3). Contraste de grants: [n8n-contract](../../database/n8n-contract.md#notificaciones-de-pago).

### Metadata verificada

| Objeto | Estructura real | Ficha |
| --- | --- | --- |
| `core.correos_notificacion_pago` | PK `correo_id`; `UNIQUE (outlook_message_id)`; `estado` ∈ `PENDIENTE/PROCESADO/ERROR`; columnas de resumen (`resumen_enviado`, `fecha_resumen_enviado`, `detalle_error_resumen`) | [ficha](../../database/tables/core.correos_notificacion_pago.md) |
| `core.borradores_notificacion_pago` | PK `borrador_id`; `UNIQUE (correo_id, empresa_id)`; `estado` ∈ `PENDIENTE/CREADO/ERROR`; FK `NO ACTION` a correos y empresas | [ficha](../../database/tables/core.borradores_notificacion_pago.md) |
| `core.resultados_notificacion_pago` | PK (`correo_id`, `empresa_id`); `estado` ∈ `LISTO/MANUAL/ERROR/OMITIDO`; FK `CASCADE` a correos, `NO ACTION` a empresas | [ficha](../../database/tables/core.resultados_notificacion_pago.md) |
| `core.empresas_notificacion_pago` | Configuración 1:1 por empresa (`notificaciones_activas`, `procesa_comprobantes_pago`, `ruta_destino`); en D3 (2026-09-24) **sin grants directos** para ningún rol de aplicación; desde la migración `20260925_011` el Hub (`daubert_hub_app`) tiene `SELECT/INSERT/UPDATE` | [ficha](../../database/tables/core.empresas_notificacion_pago.md) |
| `core.vw_catalogo_notificacion_pago_n8n` | Vista de catálogo (alias, `ruta_destino`, `rfc`, correos `PARA/CC/CCO`); depende de `vw_contactos_notificacion_pago_n8n`, `alias_empresa`, `empresas_notificacion_pago`; **idéntica en TEST y PROD** | [ficha](../../database/views/core.vw_catalogo_notificacion_pago_n8n.md) |
| `core.vw_contactos_notificacion_pago_n8n` | Base de la anterior | [ficha](../../database/views/core.vw_contactos_notificacion_pago_n8n.md) |
| `core.medios_contacto` / `core.contactos` | Origen de los correos (`recibe_notificacion_pago`, `tipo_destinatario_pago` `PARA/CC/CCO`; `chk_medios_contacto_notificacion`) | [medios](../../database/tables/core.medios_contacto.md) · [contactos](../../database/tables/core.contactos.md) |

### Contraste con D2

1. **Estados**: los valores de D2 coinciden exactamente con los `CHECK` (`chk_correos_notificacion_pago_estado`, `chk_borrador_notificacion_estado`, `chk_resultado_estado`). El estado `NUEVO` de D2 es **sintético** (no está permitido en la tabla).
2. **Permisos de `n8n_app`**: `INSERT/SELECT/UPDATE` en las tres tablas (sin `DELETE`), `SELECT` en `core.empresas` y en las dos vistas `_n8n`. Coherente con "SQL directo desde n8n" y con el mínimo necesario. No tiene acceso a `contactos`/`medios_contacto`/`alias_empresa` (los ve solo a través de las vistas, que corren con los privilegios del propietario).
3. **Corrección a D2 sobre el Hub**: D2 dice que el Hub "lee las mismas tres tablas". En realidad `payment-notifications.repository.ts` lee `core.correos_notificacion_pago`, `core.resultados_notificacion_pago` y `core.empresas`; **no** consulta `core.borradores_notificacion_pago` (y `daubert_hub_app` no tiene `SELECT` sobre ella).
4. **Idempotencia**: `uq_correos_notificacion_pago_message` (correo), `uq_borrador_notificacion_correo_empresa` (borrador) y la PK compuesta de resultados sostienen los `ON CONFLICT` descritos en D2; **ninguna función** interviene.
5. **Sin trigger `updated_at`** en las cuatro tablas de notificaciones aunque tienen la columna; el workflow debe fijarla ([triggers](../../database/triggers.md)).
6. **Sin auditoría por trigger** en correos/borradores/resultados.
7. **Reproceso**: el reproceso de correos es una operación de n8n sobre `core.correos_notificacion_pago` (`UPDATE` a `PENDIENTE`); la base no lo modela (no hay `reproceso_de_id` ni función). El Hub solo dispara y registra en `ops.automation_trigger_requests`.
8. **Catálogo**: cualquier cambio en `core.alias_empresa`, `empresas_notificacion_pago`, `contactos` o `medios_contacto` altera lo que ve n8n a través de la vista (la vista filtra `procesa_comprobantes_pago`, empresa `ACTIVO`, contacto/medio `ACTIVO`, `recibe_notificacion_pago` y posición `PARA/CC/CCO`).
9. **TEST vs PROD**: estructura, vistas y grants de `n8n_app` **idénticos** en las tablas de notificaciones.

### No verificable con `daubert_docs_ro`

Contenido de correos/contactos/resultados, número de correos `PENDIENTE` sin cerrar, si `archivos_procesados.json` (fuera de PostgreSQL) discrepa. Ver [troubleshooting](../../database/troubleshooting.md).

## Configuración administrada desde el Hub (2026-09-25)

Posterior a D3: el Hub escribe `core.empresas_notificacion_pago` (upsert, sin `DELETE`), `core.empresas.ruta_dropbox` y `recibe_notificacion_pago`/`tipo_destinatario_pago`/`es_principal` de `core.medios_contacto`. **El contrato de lectura de n8n no cambió**: sigue leyendo `core.vw_catalogo_notificacion_pago_n8n`, cuya definición no se modificó. Reglas (readiness, invariante del último PARA, `ruta_destino`), endpoints y migración 011: [company-configuration](company-configuration.md).
