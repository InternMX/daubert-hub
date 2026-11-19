# Daubert Hub 1.2.0 — Nota de release

Estado: **desplegado en PROD el 2026-11-19** (commit
`22d891640a10f0864a26294c269719e292a4308e`, `DEPLOYMENT CORRECTO`, exit 0). Detalle operativo,
evidencias e incidencias en la [nota de despliegue](2026-11-19-hub-v1.2.0-prod.md).
**Manufactura permanece deshabilitada.** El tag `v1.2.0` está pendiente de decisión y autorización.

Incluye el módulo Manufactura (PR #36) y las correcciones H1–H4 (PR #37),
entre ellas las guardas del DOWN de la migración 107 en TEST y la
estabilización de las pruebas web. El respaldo incorpora el parámetro
`--enable-row-security` de `pg_dump`.

Este release sincroniza la versión raíz, API, Web, lockfile y
`DEFAULT_APP_VERSION` en **1.2.0**, sin cambios de dependencias.

Las migraciones de producción 020–024 y 026 solo se ejecutan durante la
ventana documentada en [el cierre de bloqueantes de Manufactura, §3](../hub/manufactura-cierre-bloqueantes-6c3.md)
mediante `Invoke-ManufacturaMigrations.ps1`. Caterpillar (migración 025,
PR #25) queda excluido. El manifiesto de base de datos permanece sin cambios
(SHA-256 `d940964a19934af4d1dc0b2ec113a26d60d7c263f99f0c59942bce086c864619`).

La preparación parcial en PreDeploy es solo diagnóstica. La habilitación
requiere un PASS completo y reciente de PreEnable para el commit en ejecución.

## Resultado del despliegue (2026-11-19)

| Concepto | Resultado |
| --- | --- |
| Commit / versión en health | `22d8916` / `1.2.0`, `PRODUCTION`, `status=ok`, `database=connected` |
| Migraciones | 020, 021, 022, 023, 024 y 026 aplicadas; ocho marcadores obligatorios verificados; 025 excluida |
| Manufactura | 9 tablas, 33 políticas RLS, RLS activa; readiness PreDeploy `MANUFACTURA_READINESS_PARTIAL` (exit 2, esperado); **deshabilitada** |
| Respaldos | B3, B6, B9 y B13 verificados con restauración aislada; tareas Frequent, Daily y Monthly en `Ready` |
| Ventana | Cierre de entradas verificado; reapertura `CLOSURE OFF (verified)`, estado `OPEN` |
| Rollback | Anclas `rollback-de13370` (API/Web) verificadas; rollback real no ejecutado |

**Corrección de la referencia de rollback.** Esta nota indicaba antes «v1.1.1 / 16153a8». El
commit que estaba en PROD antes del despliegue era `de13370f1871e958e5da502deb671a44c68892f7`
(versión `1.1.1`, [piloto del 2026-11-11](2026-11-11-hub-cicd-pilot-prod.md)), y las anclas se
crearon como `rollback-de13370`. El tag histórico `v1.1.1` apunta a `16153a8`, no a `de13370`
([release-policy §7](../operations/release-policy.md#7-ejemplo-real-y-límite-histórico-piloto-de-2026-11-11)).

Esta nota no autoriza la habilitación de Manufactura ni la creación de etiquetas o GitHub Releases.
