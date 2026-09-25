# Auditoría de privilegios de `n8n_app`

D2 señaló una posible amplitud excesiva de `n8n_app` (rol **compartido** entre Audi, Caterpillar y Notificaciones, [ADR-002](../decisions/ADR-002-n8n-app-rol-compartido-prod.md)). Este documento la mide contra la base real (PROD) y contra los workflows versionados. **No se revocó nada.** Volver a [database](README.md).

> Qué credencial n8n respalda qué rol no es demostrable desde el JSON del workflow. Se **infiere** (D1/D2 + patrón de grants) que `Postgres produccion` = `n8n_app`, `cat_test` = `n8n_cat_test` y `Postgres pruebas` = `n8n_app` en TEST.

## Cómo leer este documento

Cada privilegio se describe con cuatro etiquetas de evidencia, independientes entre sí. Las clasificaciones de las tablas (`LEAST_PRIVILEGE_OK`, `POSSIBLY_EXCESSIVE`, `REVIEW`) se corresponden así:

| etiqueta | significado | equivale a |
| --- | --- | --- |
| **PERMISO CONFIRMADO** | El grant existe en el catálogo de PROD (`relacl`/`proacl`). | Todas las filas de las tablas de abajo. |
| **USO CONFIRMADO** | Un workflow versionado (export D2) o una función lo utiliza. | `LEAST_PRIVILEGE_OK` |
| **POSIBLE EXCESO** | El grant existe y ningún workflow **versionado** lo usa, o permite más de lo que el patrón exige. **No** es una orden de retirarlo. | `POSSIBLY_EXCESSIVE` |
| **REQUIERE REVISIÓN** | Depende de información que no se puede demostrar desde aquí (decisión humana o export no versionado). | `REVIEW` |

Advertencias: (1) **no se declara que ningún permiso deba eliminarse**; esta auditoría solo mide. (2) Audi y Notificaciones pueden depender de **SQL directo** (nodos Postgres con `INSERT/UPDATE/SELECT`, y el allocator `INVOKER` `operacion.reservar_folios`); el export de Notificaciones **no está versionado**, así que un «no usado» solo significa «no demostrado en los exports disponibles». (3) Retirar cualquier grant sin migrar antes Audi a funciones y probarlo en TEST con el rol reducido puede romper producción.

## Resumen ejecutivo

- **Tablas/vistas con privilegios (PROD): 12**; `DELETE`: **0**; `TRUNCATE`: **0**; `CREATE` en schemas: **0**; sin acceso a `security`, `audit`, `staging`.
- **3 privilegios `POSSIBLY_EXCESSIVE`**: `UPDATE` en `operacion.series_documentales`, `INSERT/UPDATE` en `ops.ejecuciones_automatizacion`, `UPDATE` en `operacion.remisiones`. **1 `REVIEW`**: `SELECT` de tabla completa en `core.empresas`. El resto es mínimo para el patrón que usa cada workflow.
- **TEST no es representativo del mínimo real de Caterpillar**: en TEST `n8n_cat_test` opera con **0** grants de tabla y pasa; en PROD Caterpillar corre con `n8n_app` (12 objetos). Reducir `n8n_app` a lo que Audi/Notificaciones necesitan es viable pero exige antes migrar Audi a funciones (deuda técnica).

## Tablas y vistas

| objeto | privilegios (PROD) | clasificación | motivo |
| --- | --- | --- | --- |
| `core.borradores_notificacion_pago` | RIU | **LEAST_PRIVILEGE_OK** | Notificaciones: `INSERT/UPDATE/SELECT` sin `DELETE`. |
| `core.correos_notificacion_pago` | RIU | **LEAST_PRIVILEGE_OK** | Notificaciones (D2). Sin `DELETE`. |
| `core.documentos` | RI | **LEAST_PRIVILEGE_OK** | Audi inserta documento origen con SQL directo; sin `UPDATE`/`DELETE`. |
| `core.empresas` | R | **REVIEW** | Audi (`to_jsonb(e)::text ILIKE …`) y Notificaciones leen la tabla completa. Bastaría una vista o `SELECT` por columna (`empresa_id`, `nombre_comercial`, `tipo_empresa`). |
| `core.resultados_notificacion_pago` | RIU | **LEAST_PRIVILEGE_OK** | Notificaciones (upsert). Sin `DELETE`. |
| `core.vw_catalogo_notificacion_pago_n8n` | R | **LEAST_PRIVILEGE_OK** | Único punto de acceso al catálogo; evita `SELECT` en contactos/medios/alias. |
| `core.vw_contactos_notificacion_pago_n8n` | R | **LEAST_PRIVILEGE_OK** | Igual; expone correos y RFC por diseño. |
| `operacion.remision_detalle` | RI | **LEAST_PRIVILEGE_OK** | Audi `INSERT` + lectura de existencia. |
| `operacion.remisiones` | RIU | **POSSIBLY_EXCESSIVE** | `UPDATE` no lo usa ningún workflow exportado (Audi solo `INSERT`/`SELECT`; Caterpillar usa función). Permite reescribir estado/`pdf_path`/`folio` de remisiones. |
| `operacion.series_documentales` | RU | **POSSIBLY_EXCESSIVE** | `UPDATE` de tabla completa: necesario **solo** para el allocator `INVOKER` de Audi; expone `siguiente_folio`, `estatus`, `codigo`, `folio_minimo_ajustable` a escritura directa (Caterpillar no lo necesita). |
| `ops.automatizaciones` | R | **LEAST_PRIVILEGE_OK** | Audi lee la fila de la automatización. |
| `ops.ejecuciones_automatizacion` | RIU | **POSSIBLY_EXCESSIVE** | `INSERT/UPDATE` directo (patrón Audi) permite cambiar estado/reservas fuera de `fn_finalizar…`, que aplica integridad. Afecta también a ejecuciones de Caterpillar. |

TEST: `n8n_app` tiene **exactamente los mismos** 12 objetos y privilegios que en PROD (sin drift de tabla).

## Funciones (`EXECUTE`)

| función | workflows que la llaman (D2) | clasificación | nota |
| --- | --- | --- | --- |
| `core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `operacion.reservar_folios(text,integer)` | Audi PROD, Audi TEST | **LEAST_PRIVILEGE_OK** | Legado Audi. |
| `operacion.reservar_folios_para_ejecucion(bigint,text,integer)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `ops.fn_resolver_ejecucion_para_reproceso(bigint)` | Caterpillar PROD, Caterpillar TEST | **LEAST_PRIVILEGE_OK** | Caterpillar (D2). |
| `ops.fn_resolver_ruta_automatizacion(text,text)` | ninguno demostrable | **REVIEW** | Sin uso en workflows: retirable/`REVOKE` opcional. |

PROD: `n8n_app` tiene `EXECUTE` sobre las 9 funciones de negocio (8 definer + `reservar_folios`). TEST: `n8n_app` solo sobre `reservar_folios`; las 8 definer están en `n8n_cat_test`. **PERMISSION_DRIFT esperado** (ver [test-prod-drift](test-prod-drift.md#permisos)).

## Sequences

PROD: `USAGE` (y `SELECT` en `correos_notificacion_pago_correo_id_seq`) sobre las sequences de `correos_notificacion_pago`, `documentos`, `remisiones`, `remision_detalle`, `ejecuciones_automatizacion`. Como son columnas `IDENTITY`, esos grants no son necesarios para insertar (vestigiales, inocuos).

## Schemas y default privileges

`USAGE` en `core`, `operacion`, `ops` (+ `public`). Sin `CREATE`. `pg_default_acl` vacío: objetos futuros no serán accesibles sin `GRANT` explícito.

## Relación con automatizaciones

| automatización | privilegios que realmente necesita (según exports/D2) | exceso respecto de `n8n_app` |
| --- | --- | --- |
| Audi | `SELECT` ops.automatizaciones, operacion.series_documentales, core.empresas; `INSERT/SELECT` core.documentos, operacion.remisiones, remision_detalle; `INSERT/UPDATE/SELECT` ops.ejecuciones_automatizacion; `EXECUTE` reservar_folios (+ `UPDATE` implícito en series por ser INVOKER) | `UPDATE` en remisiones; `EXECUTE` de las 8 definer |
| Caterpillar | `EXECUTE` de 7 funciones definer (D2; el rol tiene además la 8.ª, `fn_resolver_ruta_automatizacion`, sin uso); **0** privilegios de tabla | Todos los grants de tabla (12 objetos) y `reservar_folios` |
| Notificaciones (D2) | `INSERT/UPDATE/SELECT` correos, borradores, resultados; `SELECT` core.empresas y la vista de catálogo (que a su vez depende de la vista de contactos) | `documentos`, `operacion.*`, `ops.*`, funciones |

## Recomendaciones (no aplicadas; candidatas a fase de seguridad)

1. Separar credenciales/roles por automatización (p. ej. `n8n_audi`, `n8n_cat`, `n8n_notif`), como ya ocurre en TEST con `n8n_cat_test`.
2. Migrar Audi a `fn_crear/fn_finalizar/fn_registrar_*` y `reservar_folios_para_ejecucion`; luego retirar `UPDATE` de `series_documentales`, `remisiones` y `ejecuciones_automatizacion`.
3. Sustituir `SELECT` de `core.empresas` por una vista mínima.
4. Verificar antes de cualquier `REVOKE` con una prueba en TEST usando el rol reducido (la lección de `n8n_cat_test`).
