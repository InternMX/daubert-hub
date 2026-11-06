# Daubert Hub 1.1.1 — Nota de release

Estado: preparado para revisión; despliegue pendiente después del merge.

Corrige la presentación de errores largos de Caterpillar (PR #22): la tabla
«Ejecuciones recientes» limita la vista previa a dos líneas y «Ver error» abre
un diálogo con el mensaje completo, saltos de línea, desplazamiento y copia.
El diálogo se adapta a pantalla móvil y el detalle existente conserva los
saltos de línea.

Este release sincroniza la versión raíz, API, Web, lockfile y
`DEFAULT_APP_VERSION` en **1.1.1**, sin cambiar dependencias ni añadir cambios
funcionales a la corrección ya fusionada. No requiere migraciones ni cambios
en PostgreSQL, n8n, Docker, Compose, API funcional, Pagos, Audi o folios.

El despliegue posterior reutiliza `scripts/deploy/Deploy-DaubertHub.ps1` y
`scripts/deploy/Set-EntryClosure.ps1`, conforme al procedimiento de 1.1.0 en
`docs/deployments/2026-10-28-hub-v1.1.0-prod.md`. Se conserva como referencia
de rollback **v1.1.0 / 6909dc8**.
