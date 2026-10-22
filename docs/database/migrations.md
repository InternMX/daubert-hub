# Migraciones

Fuentes: `database/migrations/daubert_global/*`, `README.md` raíz, nota de despliegue 12C, directorio externo de migraciones (lectura), `README_DEPLOY.md` y `SOURCE_MAP.md` del paquete Caterpillar 2026-09-21.

## Principios

- Las migraciones se aplican **manualmente**, con `psql`, por un operador. **Nunca** las ejecuta el arranque de la API, `npm run dev`, `npm run build` ni CI.
- El DDL se ejecuta con un rol administrativo (`postgres`); **nunca** con `daubert_hub_app` ni con `n8n_app`/`n8n_cat_test` (esos son credenciales de runtime).
- TEST es la fuente de verdad funcional; PROD recibe el estado final correcto ([environments](../00-overview/environments.md#fuente-de-verdad-funcional-durante-el-desarrollo)).

## Ubicación actual

| Ubicación | Contenido | En el repo |
| --- | --- | --- |
| `database/migrations/daubert_global/` | **Sólo** la migración `20260923_009` (PROD) con `up`, `down`, `precheck`, `postcheck` | ✔ |
| Directorio externo `…/Dropbox/Pruebas/BASE DE DATOS/MIGRACIONES` (en el `README.md` raíz aparece como ruta WSL `/mnt/c/Users/<WINDOWS_USER>/Documents/Dropbox/Pruebas/BASE DE DATOS/MIGRACIONES`) | Resto de migraciones PROD (`*_prod.*`) y TEST (`daubert_hub_test/` y `*_test.*`), paquete `daubert_global/caterpillar_pg_20260921/` | ✘ (fuera del repositorio) |

**Pendiente (Fase D2):** versionar en `database/migrations/` el resto, o definir formalmente la referencia al directorio externo.

## Naming

`YYYYMMDD_NNN_<descripcion>_<entorno>.<tipo>.sql`

| Parte | Significado |
| --- | --- |
| `YYYYMMDD` | Fecha de la migración |
| `NNN` | Secuencia del día/serie (p. ej. `009`) |
| `<entorno>` | `prod` o `test` (p. ej. `…_caterpillar_manual_reprocess_prod`) |
| `<tipo>` | `up`, `down`, `precheck`, `postcheck` |

Existen excepciones históricas en el directorio externo (archivos TEST sin sufijo de entorno, o sin `down`, p. ej. `20260918_005/006/007` y `20260921_008`; el paquete Caterpillar usa numeración `000…013` + `999_POSTCHECK`). Para nuevas migraciones, seguir el formato de la 009.

## Estructura de una migración (patrón de la 009)

| Archivo | Rol |
| --- | --- |
| `.precheck.sql` | **Sólo lectura** (`BEGIN TRANSACTION READ ONLY … ROLLBACK`). Verifica base, rol, objetos requeridos, que los objetos del delta **no** existan, integridad de datos previa, y **registra una línea base** (huellas md5 de series y funciones, conteos). |
| `.up.sql` | Transaccional (`BEGIN … COMMIT`). Empieza con `SET LOCAL lock_timeout = '10s'` y un bloque `DO` de guards. Termina con un `SELECT` de validación. |
| `.postcheck.sql` | **Sólo lectura**. Recibe la línea base por `psql -v baseline_*=…` y comprueba objetos nuevos, permisos y que **nada más cambió**; resumen `ALL_CHECKS_PASS`. |
| `.down.sql` | Rollback transaccional con sus propios guards; **aborta** si revertir sería inseguro. |

### Guards típicos en `up`

- `current_database() <> 'daubert_global'` → `RAISE EXCEPTION` (una migración PROD no corre en otra base).
- Rol requerido existe (`n8n_app`), tablas/columnas requeridas existen.
- Objetos del delta **no** existen aún (evita reaplicar).
- Huella (`md5`, ignorando CR) del cuerpo de funciones que se van a reemplazar: si no coincide con la versión esperada, **se niega a sobrescribir** una versión desconocida.
- Precheck de datos (p. ej. padres con más de un hijo antes de crear el índice único). **Nunca limpia datos**: sólo aborta indicando qué revisar.
- `CREATE UNIQUE INDEX` sin `CONCURRENTLY` (no cabe en transacción); aceptado porque `ops.ejecuciones_automatizacion` es pequeña.

## Proceso recomendado

1. **Precheck** (`.precheck.sql`, solo lectura) contra la base objetivo. Todo booleano como se anota; **registrar la línea base** (sección 8).
2. **Backup** confirmado y punto de restauración verificado *antes* de cualquier DDL (`README_DEPLOY.md` del paquete Caterpillar lo exige). Procedimiento exacto: [backup-restore](../operations/backup-restore.md) — PENDIENTE.
3. **Aplicar** `.up.sql` con `psql … -v ON_ERROR_STOP=1`, en ventana de bajo tráfico.
4. **Postcheck** (`.postcheck.sql`) pasando la línea base con `-v`. Esperado: `ALL_CHECKS_PASS = true`.
5. **Rollback** (`.down.sql`) sólo si procede y sólo si sus guards lo permiten; si ya hay datos creados con la nueva infraestructura, tratarlo como corrección hacia adelante, no como rollback.
6. Documentar la promoción en `docs/deployments/` ([ejemplo](../deployments/2026-09-24-caterpillar-12c-prod.md)).

Ejemplo de invocación del postcheck (los `-v` reales son los valores de la línea base del precheck):

```text
psql -h localhost -p 5432 -d daubert_global -U postgres -X -w \
  -v baseline_series_fp=<md5> -v baseline_functions_fp=<md5> \
  -v baseline_ejecuciones=<n> -v baseline_remisiones=<n> \
  -v baseline_remision_detalle=<n> -v baseline_reservas=<n> \
  -f 20260923_009_caterpillar_manual_reprocess_prod.postcheck.sql
```

## Migración 009 PROD (Caterpillar reproceso manual)

Ya **aplicada** en `daubert_global` (postcheck OK; ver [nota de despliegue](../deployments/2026-09-24-caterpillar-12c-prod.md)). Versionada en `database/migrations/daubert_global/`:

- `20260923_009_caterpillar_manual_reprocess_prod.up.sql`
- `20260923_009_caterpillar_manual_reprocess_prod.down.sql`
- `20260923_009_caterpillar_manual_reprocess_prod.precheck.sql`
- `20260923_009_caterpillar_manual_reprocess_prod.postcheck.sql`

Entrega **sólo el delta** que faltaba en PROD:

1. `ops.fn_resolver_ejecucion_para_reproceso(bigint)` — `SECURITY DEFINER`, `search_path = pg_catalog, ops`, sólo `REMISIONES_CATERPILLAR`; `EXECUTE` revocado a `PUBLIC` y concedido a `n8n_app`.
2. Índice único parcial `uq_ejecuciones_automatizacion_reproceso_unico` sobre `(reproceso_de_id) WHERE reproceso_de_id IS NOT NULL`.
3. `ops.fn_crear_ejecucion_automatizacion(...)` reemplazada (misma firma) para devolver `ALREADY_REPROCESSED` ante un reproceso repetido del mismo padre.

Ya existían en PROD (no se reaplican): columna `reproceso_de_id` con FK/CHECK, estado de reintentos, finalización, persistencia de remisiones, `core.documentos` con hash, `ops.automation_trigger_requests` con `REPROCESS` y los permisos de lectura del Hub.

Guards del `down`: aborta si existe **cualquier** ejecución de reproceso (`reproceso_de_id IS NOT NULL`) y si `fn_crear_ejecucion_automatizacion` no está exactamente en el estado que dejó el `up` (huella md5 esperada).

> El encabezado de estos `.sql` aún dice "DO NOT APPLY TO daubert_global YET" (plantilla previa a la aplicación). Es una nota obsoleta; el estado real es **aplicada**. Ver [inconsistencia #5](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración).

## Qué se sabe y qué no (resumen D3)

| nivel | afirmación |
| --- | --- |
| **CONFIRMED** | No existe tabla de migration history en ninguna de las dos bases. Solo la migración `20260923_009` está versionada en Git. La 009 está aplicada en PROD (cuerpo verificado por `md5`) y el mismo cuerpo está en TEST. Todos los objetos actuales existen en ambas bases con la misma estructura. |
| **INFERRED** | Que las migraciones externas (`20260827…`, `20260910`, `20260911`, `20260921`, `20260922`) se aplicaron en PROD: se deduce de que sus objetos y grants existen, no de un registro de aplicación. |
| **UNKNOWN** | Cuáles migraciones se aplicaron realmente, en qué orden y cuándo; el origen de `staging.*` y de las tablas de carga inicial; el motivo de las columnas eliminadas de `core.empresas` en PROD; si `20260902_002` se aplicó en PROD. |

Que solo la 009 esté en Git **no significa que sea la única migración aplicada**: gran parte del schema actual proviene de migraciones externas al repositorio, sin versionar. No se creó ninguna tabla de migraciones (recomendación futura, no aplicada).

## Estado de aplicación

No se encontró una tabla de control de migraciones. El estado de PROD se infiere de: la nota 12C (009 aplicada), el precheck de la 009 (declara que el resto de la infraestructura Caterpillar ya está materializada, tras una auditoría de sólo lectura) y el paquete `caterpillar_pg_20260921`. **Inventario formal de migraciones aplicadas por base: PENDIENTE.**

Migraciones conocidas relacionadas con automatizaciones (directorio externo; las de PROD, sufijo `_prod`):

| Migración | Tema |
| --- | --- |
| `20260827_002…005` | Remisiones Audi v1, seed, permisos n8n (`n8n_app`), permisos Hub |
| `20260910_001` | Acuses de revisión de automatizaciones |
| `20260911_001…003` | Modelo Caterpillar, permisos n8n, `automation_trigger_requests` |
| `20260921` (paquete `000…013`) | Cutover Caterpillar PROD (modelo, seed, finalización, persistencia, integridad, hash de documentos, último estado terminal, reintentos) |
| `20260922_001…004` | Permisos de lectura Hub Caterpillar, piso de folio ajustable, seed del piso, mapeo Audi en `automatizacion_series_proceso` |
| `20260923_009` | Reproceso manual Caterpillar (PROD, versionada en el repo) |
| `20261019_012` … `20261021_014` | Asignación puntual de archivos de Notificaciones de pago — **solo `daubert_hub_test`** (cada archivo aborta en otra base) |
| `20261022_015` … `20261022_017` (`_prod`) | Asignación puntual de archivos — **PROD**, aplicadas a `daubert_global` el 2026-10-21 (tablas de archivos y asignaciones, funciones de registro/consulta/elegibilidad, permisos mínimos). Ver [production-rollout](../automations/payment-notifications/production-rollout.md) |

## Comparación con la base real (D3)

Fecha de verificación: 2026-09-24, catálogo de PROD y TEST (solo lectura). Leyenda: **CONFIRMED** = demostrado por el catálogo de PostgreSQL o por un archivo del repo; **INFERRED** = deducido de varios indicios; **UNKNOWN** = no demostrable con `daubert_docs_ro` o sin fuente en el repo. Un objeto presente en la base **no** prueba qué migración lo creó ni que se aplicó "completa".

### Migraciones y objetos

| Migración (fuente) | Objetos que deberían existir | Evidencia en PostgreSQL | Estado |
| --- | --- | --- | --- |
| `20260923_009` (repo) | `ops.fn_resolver_ejecucion_para_reproceso`, índice `uq_ejecuciones_automatizacion_reproceso_unico`, cuerpo nuevo de `ops.fn_crear_ejecucion_automatizacion`, `REVOKE PUBLIC` + `GRANT n8n_app` | Los 3 objetos existen en PROD **y** TEST; `md5` del cuerpo de `fn_crear_ejecucion_automatizacion` (CR ignorado) = `929939dcc7cd3ef0e09b7b2a868b9616`, exactamente el valor que el `postcheck`/`down` de la 009 esperan; `EXECUTE` de la nueva función solo `postgres` + `n8n_app` (PROD), sin `PUBLIC` ni `daubert_hub_app` | **CONFIRMED** (aplicada en PROD; el mismo cuerpo está en TEST) |
| `20260827_002…005` (externa) — Remisiones Audi v1, permisos `n8n_app` y Hub | `operacion.remisiones`, `remision_detalle`, `series_documentales`; grants de `n8n_app` | Tablas existen; grants reales de `n8n_app` coinciden con los descritos en D1 (`SELECT/INSERT` `core.documentos`; `SELECT` `ops.automatizaciones`; `SELECT/INSERT/UPDATE` `ops.ejecuciones_automatizacion`; `SELECT/UPDATE` `series_documentales`; `SELECT/INSERT/UPDATE` `remisiones`; `SELECT/INSERT` `remision_detalle`) | Objetos y grants **CONFIRMED**; "migración aplicada" **INFERRED** (archivo fuera del repo) |
| `20260910_001` (externa) — acuses de revisión | `ops.automation_review_acknowledgements` | Existe con FK `SET NULL` a `security.users`, `UNIQUE (automation_code, source_type, source_reference)`, trigger de auditoría `INSERT` | Objeto **CONFIRMED**; migración **INFERRED** |
| `20260911_001…003` (externa) — modelo Caterpillar, permisos, `automation_trigger_requests` | `ops.*`, funciones `fn_resolver_ruta_automatizacion`, `fn_crear_o_resolver_documento`, `fn_crear_ejecucion_automatizacion`, `reservar_folios_para_ejecucion`, `ops.automation_trigger_requests` (`RUN`/`REPROCESS`) | Todo existe; `CHECK` de `action_type` = `RUN`/`REPROCESS`; `n8n_app` con `EXECUTE`; Hub solo `INSERT` en `automation_trigger_requests` | Objetos y grants **CONFIRMED** |
| Paquete `20260921` (`000…013`) — cutover Caterpillar PROD | `fn_finalizar_ejecucion_automatizacion`, `fn_registrar_remision_generada`, `fn_registrar_fallo_ejecucion`, reintentos, hash de documentos, índices únicos de ejecución | Existen; columnas `intentos_fallidos/max_intentos/ultimo_fallo_*`; índices `uq_documentos_empresa_ruta_*`, `uq_ejecuciones_automatizacion_completada_original/procesando` | Objetos **CONFIRMED** |
| `20260922_001` (externa) — permisos de lectura Hub Caterpillar | `SELECT` del Hub en rutas, reservas, detalle, documentos | `daubert_hub_app`: `SELECT` en `ops.automatizacion_series_proceso`, `operacion.reservas_folios`, `operacion.remision_detalle`, `core.documentos` | **CONFIRMED** |
| `20260922_002/003` (externa) — piso de folio ajustable | Columna `operacion.series_documentales.folio_minimo_ajustable` + `CHECK > 0` | Existe, con `COMMENT` que cita "Phase 12B.2" y `ck_series_documentales_folio_minimo_ajustable` | Estructura **CONFIRMED**; valores sembrados **UNKNOWN** (sin `SELECT`) |
| `20260922_004` (externa) — mapeo Audi | Fila de ruta Audi en `ops.automatizacion_series_proceso` | Solo se puede comprobar la tabla, no sus filas | **UNKNOWN** |
| `20260925_011` (repo, `database/migrations/daubert_global/`) — permisos del Hub sobre configuración de Notificaciones de pago | `GRANT SELECT, INSERT, UPDATE ON core.empresas_notificacion_pago TO daubert_hub_app` (sin `DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`, sin secuencias, sin cambios para `n8n_app`/`daubert_docs_ro`/roles TEST) | Posterior a la verificación D3 (2026-09-24). Verificada operativamente en PROD el 2026-09-25: el PRECHECK pasó (la tabla existía, `daubert_hub_app` no tenía privilegios previos y `n8n_app` seguía leyendo `core.vw_catalogo_notificacion_pago_n8n`); se aplicó el UP; el POSTCHECK pasó y `daubert_hub_app` quedó solo con `SELECT`, `INSERT` y `UPDATE` (`DELETE`, `TRUNCATE`, `REFERENCES` y `TRIGGER` siguen en false); no cambiaron privilegios de `n8n_app`, `daubert_docs_ro` ni roles TEST, no se añadieron privilegios de secuencia y el baseline de permisos ajenos a `daubert_hub_app` permaneció sin cambios ([deployments](../deployments/2026-09-25-payment-notification-config-prod.md)) | **CONFIRMED** en PROD (2026-09-25). **Deuda documental:** las fichas y matrices del inventario D3 (`permissions-matrix`, `tables/core.empresas_notificacion_pago`, etc.) se generaron el 2026-09-24 y llevan una nota de actualización, pero no se han regenerado desde el catálogo; esto no es una duda sobre el estado operativo de PROD |
| `20260902_002` (citada por D1) — grants de `core.direcciones` al Hub | `INSERT/UPDATE` + sequence a `daubert_hub_app` | **No** hay ningún grant de `daubert_hub_app` sobre `core.direcciones` en PROD (sí de `daubert_hub_test_user` en TEST) | **Contradicción**: la base no refleja la migración citada; si se aplicó en PROD: **UNKNOWN** |
| `20260918_004` y `20260918_007` (nombradas en comentarios de funciones y en la 009) | Corrección de ambigüedad `remision_id`; cuerpo previo de `fn_crear_ejecucion_automatizacion` (md5 `9b5ede68…`) | Los comentarios de TEST citan `20260918_004`; el cuerpo previo a la 009 ya no existe (fue reemplazado) | **INFERRED** |

### Objetos presentes en la base sin migración versionada en Git

Solo **una** migración está en el repo (`20260923_009`). Por tanto **todo** lo demás no tiene DDL de creación en Git (existe, según D1/D2, en el directorio externo):

| Categoría | En PROD/TEST | Con migración en Git |
| --- | --- | --- |
| Tablas | 31 | 0 |
| Vistas | 10 | 0 |
| Funciones | 13 | 1 (`fn_resolver_ejecucion_para_reproceso`) + reemplazo de cuerpo de `fn_crear_ejecucion_automatizacion` |
| Triggers | 25 | 0 |
| Índices | 89 | 1 (`uq_ejecuciones_automatizacion_reproceso_unico`) |
| Constraints | 342 | 0 |

**Origen desconocido o histórico** (no aparece en ninguna migración citada por D1/D2): `core.snapshot_carga_empresas_inicial`, `core.stg_contactos_notificacion_pago`, `core.vw_carga_empresas_inicial` y todo `staging.*` (**UNKNOWN**; por su nombre, cargas iniciales). Las 8 vistas restantes de `core` y el modelo de notificaciones de pago tampoco tienen migración citada en D1/D2 (**UNKNOWN**; probablemente el DDL base `001_daubert_hub_base_v2.sql`, **INFERRED**).

**Historia distinta entre bases**: `core.empresas` en PROD tiene 2 columnas eliminadas (huecos de `attnum` 7 y 11) que TEST no tiene: PROD sufrió `ALTER TABLE … DROP COLUMN` que no está versionado (**CONFIRMED** el hecho, **UNKNOWN** el motivo).

### Tabla de control de migraciones

**No existe** (CONFIRMED): no hay ninguna tabla con ese propósito en los 6 schemas propios ni en `public`, y no hay extensiones (solo `plpgsql`). Consecuencia: el estado de aplicación solo puede establecerse por evidencia indirecta, como la de la tabla de arriba, y las migraciones aplicadas no se pueden listar. Recomendación futura (no aplicada): registrar en una tabla de control cada migración con hash y fecha, o mantener un inventario firmado por entorno.
