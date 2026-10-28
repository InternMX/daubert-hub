# Despliegue conjunto Daubert Hub + Notificaciones de Pago + Remisiones Caterpillar – PROD (2026-10-27)

Release: commit **`f099e310625ab5220654276b9b862ab86dfdebfa`** (`f099e31`, merge del PR #18 `feat/caterpillar-remission-controls`), tag anotado **`release-2026-10-27-hub-pagos-cat`** (objeto `65aea0d`, publicado en `origin`, apunta a `f099e31`). Sin secretos en esta nota.

> **Versión mostrada.** Este release se construyó con `package.json` en `1.0.6`, así que `/api/health` y el pie de la interfaz siguen mostrando `v1.0.6` aunque el Hub contiene funciones nuevas. No es un fallo del despliegue: nadie subió la versión antes de construir (ver [Versionado](#versionado-por-qué-seguía-en-106)). La corrección (`1.1.0`) se preparó en una rama aparte; no se movió ni se re-etiquetó el commit/tag publicados.
>
> **Actualización 2026-10-28:** `1.1.0` ya está desplegado en PRODUCCIÓN (commit `6909dc8`, tag `v1.1.0`); ver [hub-v1.1.0-prod](2026-10-28-hub-v1.1.0-prod.md). El punto 8 de «Riesgos y verificaciones operativas pendientes» queda resuelto; los demás siguen vigentes (en especial la validación de negocio de los puntos 1 y 2). Este documento se conserva como registro del 27 de octubre.

## Estado: despliegue completado vs. seguimiento operativo pendiente

| | Estado |
| --- | --- |
| **Despliegue completado** | Hub API + Web en `f099e31`; migraciones SQL aplicadas; workflows de Pagos y Caterpillar 016 promovidos y publicados; Nginx **OPEN** con la configuración externa montada y su hash verificado; producción abierta. |
| **Seguimiento operativo pendiente** | Ver [Riesgos y verificaciones pendientes](#riesgos-y-verificaciones-operativas-pendientes). No se debe leer este documento como cierre de la supervisión inicial. |

## Datos del release

| Elemento | Valor |
| --- | --- |
| Fecha | 2026-10-27 (ventana de mantenimiento conjunta, W0–W7 del [plan conjunto](../automations/caterpillar/joint-deployment-plan.md#6-procedimiento-definitivo-de-la-ventana)) |
| Commit / tag | `f099e310625ab5220654276b9b862ab86dfdebfa` / `release-2026-10-27-hub-pagos-cat` |
| Hub en PROD antes | `6370753` (`1.0.6`); ancla de rollback `daubert-hub-{api,web}:rollback-6370753` |
| Método Hub | `scripts/deploy/Deploy-DaubertHub.ps1 -Deploy` con la ventana cerrada (previsto como un único despliegue de API y Web en el [plan conjunto](../automations/caterpillar/joint-deployment-plan.md)) |
| Proyecto Compose / puerto Web | `daubert-hub` / `8082` |
| Versión mostrada por el Hub | `1.0.6` (esperada para este commit; ver arriba) |

## Qué se desplegó

| Capa | Cambio |
| --- | --- |
| Hub API + Web | Reconstruidas y recreadas desde `f099e31`: Caterpillar (controles de remisión, admisión atómica 016, reproceso) y Pagos (recuperación de archivos, PR #17). |
| PostgreSQL `daubert_global` | Migraciones conjuntas (siguiente sección). |
| n8n | Pagos: hijo nuevo + padre actualizado. Caterpillar: workflow 016 nuevo; el anterior queda inactivo. |
| Nginx | Cierre de entradas durante la ventana; reabierto (`OPEN`) con configuración externa montada y hash verificado. |

## Migraciones PostgreSQL aplicadas

Orden y resultado en la ventana (`Invoke-JointMigrations.ps1 -Apply`, marcador final **`JOINT_SQL_COMPLETE`**):

| Orden | Migración | Resultado |
| --- | --- | --- |
| 1 | `20261023_019_payment_file_recovery_prod` (Pagos) | aplicada |
| 2 | `20261020_013_caterpillar_cancellation` | aplicada (`POSTCHECK_013_PASS`) |
| 3 | rol `n8n_cat_prod` (plantilla `…worker_role_prod.template.sql`) | creado; la contraseña vive fuera del repositorio |
| 4 | `20261024_016_caterpillar_atomic_admission_prod` | aplicada (`PRECHECK_016_PASS`, `POSTCHECK_016_PASS`) |

No se aplicaron las migraciones `*_test` (014/015/017 Caterpillar, 018 Pagos). Evidencia: `%LOCALAPPDATA%\DaubertHub\release-artifacts\joint-deploy-20261027\joint-migrations-prod.txt` (fuera del repositorio). Estado general: [migrations](../database/migrations.md).

## Workflows n8n promovidos (n8n PRODUCCIÓN `127.0.0.1:5678`)

| Workflow | ID | Nodos | Estado final |
| --- | --- | --- | --- |
| Pagos – padre (actualizado por PATCH, ID, webhook y credenciales conservados) | `pagosProdAsignaciones01` | 111 (antes 108) | publicado |
| Pagos – hijo de recuperación (nuevo, ID fijo) | `pagosProdRecuperacion01` | 106 | publicado |
| Caterpillar 016 (nuevo, 7 nodos PostgreSQL con la credencial `Postgres produccion CAT (n8n_cat_prod)`) | `catProd016Remisiones01` | 62 | publicado; Webhook POST `cat-reprocess` habilitado y Schedule cada 10 min |
| Caterpillar anterior | `9Ngnrpi16b6GtOAX` | – | **inactivo, conservado** (no archivar ni borrar) |
| Audi PRODUCCIÓN | – | – | activo, **sin modificaciones** |

Artefactos aprobados (SHA-256 de los bytes del archivo): hijo `a63f2f4c…92a9a`, padre `e4726245…d5f9`, candidato CAT 016 (copia CRLF de trabajo) `d9804950…67c7`. El SHA-256 de un archivo CRLF no es el hash del blob Git (LF). Fuente de Pagos previa (108 nodos): `47e15801…6295`.

Cómo se hizo el W4: preflight de solo lectura (W4-A v2: 50 GET, 0 escrituras, **GO**) y staging inactivo mediante el procedimiento aprobado, ejecutado manualmente desde DevTools con sesión del operador; la publicación fue posterior y por separado. Procedimiento: ver `n8n-promotion-procedure-20261027.md` (fuera del repositorio).

## Respaldos y referencias de recuperación (no eliminar)

| Referencia | Detalle |
| --- | --- |
| Respaldo n8n de la ventana | `n8n_ON_CHANGE_20261027_135851.age` |
| Respaldo PostgreSQL de la ventana | `daubert_global_FREQUENT_20261027_140142.age` |
| Dumps previos | `respaldos-postgres-prod\daubert_global_pre_caterpillar_016_20261023_220606.dump` y `…_20261026_221246.dump` |
| Anclas Docker | `daubert-hub-{api,web}:rollback-6370753` (y `docker save` verificado) |
| Exports n8n previos | `exports-n8n\prod-20261023.json` |
| Historial de versiones de n8n | **No es fuente de rollback** del padre de Pagos: solo conserva una entrada y no contiene la versión publicada anterior (`38dcf262…`). El rollback de n8n depende del respaldo `.age` y del export previo. |
| Reglas de rollback | [plan conjunto §8](../automations/caterpillar/joint-deployment-plan.md#8-fallas-y-recuperación-por-componente-sin-restaurar-postgresql-globalmente-sin-perder-operaciones-legítimas-sin-reiniciar-folios) |

## Evidencias de validación W1–W7

| Fase | Resultado / evidencia |
| --- | --- |
| W1 | Nginx `CLOSED`; Pagos y Caterpillar despublicados; sin ejecuciones `running`. |
| W2 | Respaldos `n8n_ON_CHANGE_20261027_135851.age` y `daubert_global_FREQUENT_20261027_140142.age` verificados; anclas de rollback comprobadas. |
| W3 | `JOINT_SQL_COMPLETE` (019 → 013 → rol → 016). |
| W4 | Ensayo B1 de la API de n8n en TEST 2.27.4: GO con limpieza completa. W4-A v2 en PROD: GO (50 GET, 0 escrituras). Staging inactivo de los tres workflows. |
| W5 | Hub `f099e31` desplegado; API y Web actualizadas, PostgreSQL conectado. |
| W6 | Pagos publicado (hijo y padre): última ejecución comprobada **`11402`, `success`**. |
| W7 | Caterpillar 016 publicado, Schedule de 10 min y Webhook POST habilitados. Nginx `OPEN`. |

Los detalles de W5–W7 (logs, salida de `Deploy-DaubertHub.ps1`, sondas por LAN/Tailscale) están en la evidencia externa de la ventana; **la ruta y los hashes de esos archivos deben registrarse aquí por el responsable** (no se reprodujeron en este cierre documental).

## Ejecuciones protegidas de Caterpillar (no tocar)

Cinco ejecuciones históricas permanecen en `waiting` (verificadas antes del staging y confirmadas conservadas): pertenecen a workflows **archivados** (esperado).

| Ejecución | Workflow propietario |
| --- | --- |
| 672, 681, 686, 689 | `qe21HhdBcyjpYA67` (CAT 03, archivado) |
| 685 | `G6DvdBTwqsQd3GPD` (CAT 01, archivado) |

No se reanudan, reintentan ni borran. También se preservan los correos de Pagos 44, 38 y 45 y las evidencias TEST 237/238/239.

## Versionado: por qué seguía en `1.0.6`

- `/api/health` devuelve `config.app.version`, que sale de la variable `APP_VERSION`; el pie de la web (`VersionFooter` en `AppShell`) solo muestra lo que devuelve `/api/health`. No hay otra fuente.
- `Deploy-DaubertHub.ps1` toma `APP_VERSION` del `version` del `package.json` raíz y `GIT_COMMIT` de `HEAD` (7 caracteres), y valida que `/api/health` coincida.
- El `package.json` raíz se subió por última vez en `cd388a4` (`chore(release): bump version to 1.0.6`, 2026-10-12). Los PR de Pagos (#14, #17) y Caterpillar (#18) no incluyeron un commit `chore(release)`, por lo que el build del 2026-10-27 produjo `1.0.6`. Tampoco hay un control que avise de que un release despliega la misma versión que PROD.
- Defectos secundarios: `DEFAULT_APP_VERSION` valía `0.8.0-pilot.1` y los `package.json` de `apps/api` y `apps/web` seguían en `0.1.0`.

**Corrección preparada (rama `chore/release-1.1.0-versioning-closeout`)**: raíz, `apps/api`, `apps/web`, `package-lock.json` y `DEFAULT_APP_VERSION` en `1.1.0`, más una prueba (`apps/api/test/environment.spec.ts`) que falla si dejan de coincidir. No se creó tag nuevo ni se desplegó.

## Riesgos y verificaciones operativas pendientes

| # | Pendiente | Responsable / nota |
| --- | --- | --- |
| 1 | **Supervisión inicial de los Schedules**: observar los primeros ciclos de 10 min de Caterpillar y el Schedule de Pagos (ejecuciones, errores, folios contiguos, PDFs válidos, `SKIPPED_HISTORICAL` para históricos). | operador |
| 2 | **Primera emisión real de Caterpillar** y **primer ZIP real de Pagos** validados de punta a punta; registrar el resultado en este documento. | operador / negocio |
| 3 | Confirmar que no hay doble Schedule ni dos workflows Caterpillar activos (`9Ngnrpi16b6GtOAX` debe seguir inactivo). | operador |
| 4 | Duplicados inactivos conocidos de ruta/webhookId de Pagos: `3Dh72JJYROHtaw1X` (deprecated) e `iETuJtCkQUYmSe0R` (TEST antiguo). Están despublicados y no se tocan; **no activarlos**. Revisión de conflictos antes de cualquier publicación futura. | operador |
| 5 | El workflow CAT nuevo conserva el nombre del candidato (`… (CANDIDATE, INACTIVE)`) salvo que se haya renombrado; renombrarlo en una ventana tranquila si procede. | operador |
| 6 | Las 5 ejecuciones `waiting` de CAT: decidir su destino operativamente (hoy se conservan). | responsable CAT |
| 7 | Sin rollback por historial de versiones en n8n (ver Respaldos). Conservar los `.age` y el export hasta cerrar la supervisión. | responsable |
| 8 | Pie de la interfaz muestra `v1.0.6`: pendiente desplegar `1.1.0` ([plan](2026-10-27-post-release-cleanup-plan.md#plan-de-aplicación-de-110-a-producción)). | responsable |
| 9 | Limpieza posterior al release: [plan](2026-10-27-post-release-cleanup-plan.md); nada se elimina sin autorización. | responsable |
| 10 | Correos de Pagos 44/38/45 y reservas de folios: estado de base de datos, no verificado en este cierre documental. | operador |

## Advertencias de dependencias npm

`npm audit` (ejecutado el 2026-10-27 sobre `package-lock.json` del commit `f099e31`; la base de avisos cambia con el tiempo): **14 vulnerabilidades** (3 críticas, 8 altas, 3 moderadas) en todo el árbol; **4 en dependencias de producción** (3 altas, 1 moderada):

| Paquete | Severidad | Alcance | Aviso |
| --- | --- | --- | --- |
| `multer` (vía `@nestjs/platform-express`) | alta | producción (API) | DoS con `fileFilter` asíncrono pendiente tras cerrar la petición ([GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)) |
| `body-parser` | alta | producción (API) | DoS con bytes tras un cuerpo comprimido ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)) |
| `@nestjs/platform-express` | alta | producción (API) | afectado por lo anterior; la corrección sugerida es `12.3.2` (**cambio mayor**, NestJS 11 → 12) |
| `qs` | moderada | producción (API) | DoS en `qs.stringify` con `arrayFormat: 'comma'` ([GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)) |
| `vitest`, `@vitest/*`, `tinypool`, `vite`, `shell-quote`, `js-yaml`, `brace-expansion`, `fast-uri`, `source-map-js` | crítica/alta/moderada | solo desarrollo y pruebas (no se incluyen en la imagen de producción) | actualizar con una ventana de mantenimiento de dependencias |

Decisión: **no** se ejecutó `npm audit fix` (ni `--force`) ni se actualizó ninguna dependencia. Hay una [propuesta con evidencia](2026-10-27-npm-prod-vulnerabilities-proposal.md): actualizar el lock (`body-parser` 2.4.0, `qs` 6.17.0) y fijar `multer` 2.5.0 con un `override` elimina las 4 vulnerabilidades de producción sin saltar a NestJS 12; va en un PR propio. Ver también el PR #5 / v1.0.6 como precedente de parcheo de dependencias de la API.
