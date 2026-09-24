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
| Directorio externo `…/Dropbox/Pruebas/BASE DE DATOS/MIGRACIONES` (en el `README.md` raíz aparece como ruta WSL `/mnt/c/Users/06/Documents/Dropbox/Pruebas/BASE DE DATOS/MIGRACIONES`) | Resto de migraciones PROD (`*_prod.*`) y TEST (`daubert_hub_test/` y `*_test.*`), paquete `daubert_global/caterpillar_pg_20260921/` | ✘ (fuera del repositorio) |

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
