# Daubert Hub 1.2.0 — Nota de release

Estado: preparado para revisión.

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
La referencia de rollback es **v1.1.1 / 16153a8**. Esta nota no autoriza el
despliegue ni la creación de etiquetas.
