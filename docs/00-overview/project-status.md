# Estado del proyecto y guía de mantenimiento

Actualizado el **2026-10-28** (Hub `1.1.0` desplegado; las secciones 3 a 7 conservan detalle del 2026-10-22 y pueden estar desactualizadas en lo que difiera de esta tabla; la lista vigente de pendientes y riesgos es [pending-and-roadmap](pending-and-roadmap.md)). Describe lo que existe **hoy en el código y en PRODUCCIÓN**; lo pendiente se marca como tal. Sin secretos.

| | |
| --- | --- |
| Hub en PRODUCCIÓN | **`1.1.0`**, commit `6909dc883e840bd64b6e9ee0b7bd23a3def9376d`, tag `v1.1.0` (desplegado el 2026-10-28; nota: [hub-v1.1.0-prod](../deployments/2026-10-28-hub-v1.1.0-prod.md)). El contenido funcional de Pagos y Caterpillar se desplegó el 2026-10-27 en `f099e31` (tag `release-2026-10-27-hub-pagos-cat`, que mostraba `1.0.6`; [despliegue conjunto](../deployments/2026-10-27-hub-pagos-caterpillar-joint-prod.md)). Rollback a `1.0.6` disponible (`rollback-f099e31`) |
| Migraciones aplicadas en `daubert_global` | hasta la `20261024_016` (Caterpillar, junto con 019 de Pagos y 013; ver la nota del 2026-10-27); antes: hasta la `20261022_017` (Notificaciones de pago); las `012`–`014` son TEST-only. El release 1.1.0 no aplicó migraciones |
| Workflows n8n PROD | Pagos `pagosProdAsignaciones01` (111 nodos) + hijo `pagosProdRecuperacion01` (106); Caterpillar `catProd016Remisiones01` (62); Audi `iHN2zXtam9u1Qsn3` (39); el CAT anterior `9Ngnrpi16b6GtOAX` y `3Dh72JJYROHtaw1X` (Pagos antiguo) están inactivos y no deben activarse. Schedules activos con ciclos «success» |
| **Pendiente destacado** | **Validación de negocio en PRODUCCIÓN, aún sin hacer:** primer ZIP real de Pagos con el workflow de 111 nodos, primera recuperación de Pagos (el hijo tiene 0 ejecuciones) y primera emisión real de Caterpillar 016. Además: Error Workflow de Caterpillar, restore drill con la llave age en otra estación y continuidad de n8n sin sesión de Windows. Detalle y prioridades: [pending-and-roadmap](pending-and-roadmap.md) |

## 1. Arquitectura en una página

React 19 + Vite (`apps/web`, servida por Nginx, que reenvía `/api`) → NestJS 11 (`apps/api`) → PostgreSQL (servicio de Windows, fuera de Docker). n8n (Windows, `:5678`, supervisado por la tarea `Daubert - n8n Supervisor`) ejecuta las automatizaciones y habla con la misma base; solo la API llama a n8n (webhooks server-to-server para reprocesar y para el estado de salud). TEST (`daubert_hub_test`) y PRODUCCIÓN (`daubert_global`) usan bases, roles, puertos y archivos de entorno distintos, pero **comparten la instancia de n8n** y la credencial de Outlook. Detalle: [architecture](architecture.md) · [environments](environments.md) · [system-map](system-map.md) · [docs/architecture](../architecture/README.md).

## 2. Módulos: qué está implementado

Criterio: existe código en `apps/api` y `apps/web` **con pruebas** en el repositorio. Esquemas PostgreSQL usados: `core`, `operacion`, `ops`, `security`, `audit`.

| Módulo | Estado | Notas | Documentación |
| --- | --- | --- | --- |
| Autenticación, usuarios y roles (`ADMIN`/`GENERAL`) | **Implementado, en PROD** | Sesiones en servidor, cookie, rate limit; gestión de usuarios y auditoría solo `ADMIN` | [hub/authentication](../hub/authentication.md) · [authorization](../hub/authorization.md) |
| Proveedores | **Implementado, en PROD** | Listado, alta, edición, detalle | [hub/api](../hub/api.md) (el comportamiento detallado está PENDIENTE de documentar) |
| Clientes | **Implementado, en PROD** (rutas, páginas y API con pruebas) | Mismo modelo común de empresas que proveedores | ídem |
| Contactos y medios de contacto, directorio | **Implementado, en PROD** | | ídem |
| Alias comerciales y direcciones | **Implementado, en PROD** | Alias permanentes: base del catálogo de Pagos | [hub/api](../hub/api.md) |
| Centro de automatizaciones (overview, series/folios, acuses de revisión) | **Implementado, en PROD** | Ajuste de folio solo `ADMIN` | [hub/automations](../hub/automations.md) · [document-series](../database/document-series.md) |
| Remisiones Caterpillar | **Implementado, en PROD** (workflow 016 desde 2026-10-27; **primera emisión real pendiente de validar**) | Monitoreo, reproceso manual, regeneración comercial y cancelación individual (`ADMIN`), ajuste de folio y admisión atómica (ya en `main` y PROD). Validados en TEST; sin Error Workflow en PROD | [automations/caterpillar](../automations/caterpillar/README.md) |
| Remisiones Audi | **Implementado, en PROD** | Historial y ajuste de folio; detalle de ejecuciones sin exponer diagnósticos crudos | [automations/audi](../automations/audi/README.md) |
| Notificaciones de pago | **Implementado, en PROD** | Dashboard, detalle, errores por archivo, alias permanente, configuración por empresa (2026-09-25), reproceso (sin restricción de rol) y **asignación puntual por archivo** (2026-10-22). **Primer ZIP real pendiente** | [automations/payment-notifications](../automations/payment-notifications/README.md) · [production-rollout](../automations/payment-notifications/production-rollout.md) |
| Actividad reciente y Auditoría | **Implementado, en PROD** | Actividad reciente integra Audi, **Caterpillar**, Notificaciones de pago y ajustes de series (API, web y pruebas en `main`); Auditoría solo `ADMIN` | [hub/automations](../hub/automations.md) |
| Estado de n8n (`/api/system/status`) | **Implementado, en PROD** | Depende del workflow `Daubert Hub - Health Check` | [hub/api](../hub/api.md) |
| Hojas de manufactura (COEX) | **Prototipo en desarrollo fuera de `main`** | No forma parte del Hub desplegado | — |

## 3. Funcionalidades parciales y pendientes conocidos

- **Notificaciones de pago — primer ZIP real** en PRODUCCIÓN con el workflow de 111 nodos (ingesta con registro de archivos, asignación y reproceso puntual con datos reales): **PENDIENTE**. Tampoco hay ejecuciones de la recuperación (`pagosProdRecuperacion01`) ni una emisión real de Caterpillar 016 ([pending-and-roadmap](pending-and-roadmap.md)).
- Documentación del comportamiento de Proveedores/Clientes/Contactos/Alias/Direcciones: solo catalogada ([hub/README](../hub/README.md)).
- Snapshots `pg_dump` de esquema y datos de configuración de la D3: [schema-snapshots](../database/schema-snapshots.md) (PENDIENTE).
- Restore drill con la clave privada de age en otra estación (DR completo): PENDIENTE ([postgresql-backup-automation](../operations/postgresql-backup-automation.md)).
- Verificar desde un cliente de la LAN el bloqueo de 3000/5432/5678 y la recuperación tras un reinicio completo ([architecture](../architecture/README.md)).
- Objetivos V1 no hechos: reserva DHCP, DNS interno, HTTPS (ver README raíz). Sin acceso desde Internet.
- Error Workflow de Pagos: el workflow `ERROR - NOTIFICACIONES DE PAGO` está activo, pero su export no está versionado ([n8n/security-notes](../../n8n/security-notes.md)). El workflow Caterpillar de PROD **no tiene** Error Workflow (auditoría 2026-10-28).

## 4. Riesgos técnicos abiertos

| Riesgo | Detalle | Mitigación / propuesta |
| --- | --- | --- |
| Instancia de n8n compartida TEST/PROD | Mismo proceso, misma credencial de Outlook; los workflows de prueba corren junto a los de producción | [n8n-test-prod-drift](../automations/n8n-test-prod-drift.md). Propuesta: instancia o perfil de TEST separado |
| Rol `n8n_app` compartido | Usado por Pagos, Caterpillar y Audi ([ADR-002](../decisions/ADR-002-n8n-app-rol-compartido-prod.md)); desde 2026-10-21 tiene dos `EXECUTE` más (registro y consulta de archivos de Pagos) | Propuesta: rol/credencial por automatización |
| n8n depende de la sesión de Windows | El supervisor arranca con el inicio de sesión del usuario; si la sesión se cierra o el equipo se suspende, las automatizaciones **no corren** (observado: sin ejecuciones de Pagos del 21/10 17:15 al 22/10 13:35) | Revisar energía/arranque con [diagnose-daubert-server](../operations/diagnose-daubert-server.md); considerar inicio sin sesión |
| `NODE_FUNCTION_ALLOW_EXTERNAL=fflate` | El workflow de Pagos v2 requiere esta variable de usuario en el proceso de n8n; si se pierde, el primer ZIP falla | Verificar tras reinstalar/reiniciar ([production-rollout](../automations/payment-notifications/production-rollout.md)) |
| Rama de manufactura sin copia remota | La rama `feat/manufacturing-sheets-coex-baseline` (checkout principal de desarrollo) conserva **57 commits locales sin ninguna copia remota** (2026-10-22); un fallo del equipo los perdería | Protegerlos en el remoto correspondiente (publicar la rama con su propio nombre) antes de continuar ese desarrollo, **sin fusionarlos con `main`** |
| Correo `PENDIENTE` 38 (Pagos) | Atascado desde 2026-09-14, sin ejecución activa; el flujo solo procesa correos `NUEVO` | No tocar; excluir de las comprobaciones de ventana |
| `compose.prod-temp.yaml` solo en el host de despliegue | Excluido de Git; pasa `AUTH_COOKIE_SECURE` (y, redundante, variables de Pagos) | [deployment-checklist](../operations/deployment-checklist.md#configuración-específica-de-la-máquina-no-se-versiona); respaldado en `_hub_rollback` |
| Reproceso de Pagos sin restricción de rol | Cualquier usuario autenticado puede reprocesar y asignar | [reprocessing](../automations/payment-notifications/reprocessing.md#seguridad) |
| `Deploy-DaubertHub.ps1 -Deploy` y las migraciones | Los releases con migraciones se despliegan con los comandos manuales del checklist o con `Invoke-JointMigrations.ps1` (como el 2026-10-27); el script admite reconocer migraciones ya aplicadas. En el release 1.1.0 se usó con `-RequireClosedWindow` y confirmación interactiva (frase `DEPLOY DAUBERT HUB`) | [deployment-checklist](../operations/deployment-checklist.md) |

## 5. Desarrollo, pruebas y migraciones (dónde está cada cosa)

- **Entorno local, scripts y variables:** [README raíz](../../README.md) (el launcher `npm run dev` solo arranca contra `daubert_hub_test`); variables y su efecto: [environments](environments.md). Ejemplos de entorno: `apps/api/.env.example`, `deploy/*.env.example`.
- **Pruebas:** `npm run test` (unitarias), `npm run test:integration` (requiere `TEST_DATABASE_URL` → `daubert_hub_test`), `npm run validate` (todo). Los runners de Caterpillar y folios tienen script propio ([caterpillar/testing](../automations/caterpillar/testing.md)). Las pruebas de `scripts/` son Pester ([backup](../operations/postgresql-backup-automation.md), [deploy](../operations/deployment-checklist.md)).
- **Migraciones:** `database/migrations/daubert_global/<AAAAMMDD>_<NNN>_<tema>[_test|_prod].{precheck,up,postcheck,down}.sql`. Se aplican **a mano** con un rol administrativo (precheck → up → postcheck), siempre con backup previo; cada archivo lleva una guarda de base (TEST-only o PROD-only). **Una migración aplicada no se edita**: se crea una nueva. No repetir el número `NNN` ya usado (la `015` ya existe). Ver [database/migrations](../database/migrations.md).
- **Despliegue y rollback del Hub:** [deployment-checklist](../operations/deployment-checklist.md) (anclas de imagen, sin `docker compose down`) y notas por release en [deployments](../deployments/README.md).

## 6. Operación y mantenimiento

| Tema | Dónde |
| --- | --- |
| Respaldos de PostgreSQL (Frequent cada 4 h, Daily, Monthly; cifrados con age) | [postgresql-backup-automation](../operations/postgresql-backup-automation.md) · restauración: [database-backup-restore](../operations/database-backup-restore.md) |
| Respaldos de n8n (Weekly programado; OnChange manual antes de cambiar workflows/credenciales) | [n8n-backup-automation](../operations/n8n-backup-automation.md) |
| Resumen de qué se respalda y cómo recuperar | [backup-restore](../operations/backup-restore.md) |
| Diagnóstico y configuración del servidor, supervisor de n8n | [diagnose-daubert-server](../operations/diagnose-daubert-server.md) · [configure-daubert-server](../operations/configure-daubert-server.md) |
| Logs | API/Web: `docker compose … logs api\|web` (nunca imprimir el entorno); n8n: ejecuciones en su interfaz y `~\.n8n\logs`; backups: `%ProgramData%\DaubertHub\Backup\logs`; supervisor: `%ProgramData%\DaubertHub\Server\logs` |
| Monitoreo básico | `GET /api/health` (`environment`, `commit`), `GET /api/system/status` (n8n), Actividad reciente y Automatizaciones en el Hub |
| Integración con n8n | [n8n/README](../../n8n/README.md) · [n8n-dependencies](../automations/n8n-dependencies.md) · [n8n-paths](../automations/n8n-paths.md) |
| Credenciales | Nunca en Git ni en la documentación: en `deploy/pilot.*.env` (no versionados) y en las credenciales de n8n. Inventario lógico: [n8n/credentials](../../n8n/credentials.md) |

**Archivos y configuraciones que no se modifican a mano** (cambios solo con procedimiento, respaldo y autorización):

- `deploy/pilot.prod.env` y `compose.prod-temp.yaml` (PROD): respaldar antes (`_hub_rollback`) y recrear solo el `api`/`web` afectado.
- Migraciones ya aplicadas, y datos de `daubert_global` (solo mediante migraciones o el Hub).
- La base SQLite de n8n y el archivo `config` de su carpeta de datos (contiene la clave de cifrado de credenciales): solo con la interfaz/CLI de n8n y respaldo OnChange previo.
- `%ProgramData%\DaubertHub\{Backup,Server}`: configuración generada por los instaladores (`scripts/backup`, `scripts/server`).
- Imágenes ancla de rollback (`daubert-hub-*:rollback-*`) y la carpeta `_hub_rollback`.

## 7. Revisión general de `main` (2026-10-22)

Resultado de revisar `apps/`, `database/`, `deploy/`, `scripts/`, `docs/` y la configuración del monorepo. **No se eliminó código ni migraciones**: no se encontró nada obsoleto con evidencia suficiente.

- **Verificado sin hallazgos:** ningún archivo generado, `.env`, log, volcado ni respaldo versionado; ningún archivo fuente de `apps/api` o `apps/web` sin importadores (salvo los puntos de entrada); `tsc --noUnusedLocals --noUnusedParameters` sin avisos en ambos workspaces; ninguna dependencia declarada sin uso real (las que parecen no referenciadas son pares de ejecución: `rxjs`, `@nestjs/platform-express`, `@emotion/*`, tipos y cobertura); unas 60 rutas HTTP en 21 controladores, sin rutas duplicadas; ningún `TODO`/`FIXME` pendiente.
- **Conservado a propósito:** los reportes de validación de los diagramas (`docs/architecture/*.json`) que cita su README y consume `export-svg.mjs`; el export histórico `n8n/workflows/remisiones-caterpillar/historical/`; todas las migraciones (incluidas las ya aplicadas y las TEST-only, necesarias para reconstruir); `compose.yaml` (desarrollo).
- **Corregido en esta revisión (documentación):** estado de los respaldos (`backup-restore.md` decía PENDIENTE aunque están automatizados), estado de `Deploy-DaubertHub.ps1` en el checklist, inconsistencias #9 y #13 de `environments.md`, pendientes desactualizados de `docs/README.md`, rutas de la asignación puntual en `hub/api.md` y `system-map.md`, variables de la asignación puntual en `apps/api/.env.example`; se añadió este documento.
- **Propuestas de la revisión del 2026-10-22 (estado al 2026-10-28: la 1 ya se hizo (`DEFAULT_APP_VERSION` es `1.1.0`); la 4 se hizo a medias (el script de despliegue admite migraciones ya aplicadas, pero no tiene modo `-Rollback`); la 7 sigue abierta como P-09):**
  1. Actualizar `DEFAULT_APP_VERSION` (`0.8.0-pilot.1`) o derivarla de `package.json`.
  2. Corregir los encabezados «DO NOT APPLY TO daubert_global YET» de las migraciones ya aplicadas (requiere una decisión sobre editar migraciones aplicadas; hoy solo está documentado en [environments](environments.md)).
  3. Añadir los runners de integración de Caterpillar y folios a `npm run validate` (hoy tienen script propio).
  4. Añadir un modo `-Rollback` a `Deploy-DaubertHub.ps1` y soporte para releases con migraciones ya aplicadas.
  5. Mover los `.json` de validación de `docs/architecture/` a una subcarpeta para despejar el directorio.
  6. Unificar la numeración de migraciones para que no se repita el mismo `NNN` entre ramas.
  7. Revisar la restricción de rol del reproceso y de la asignación puntual de Pagos ([reprocessing](../automations/payment-notifications/reprocessing.md#seguridad)).

## 8. Regla de mantenimiento

Al cambiar comportamiento, actualizar en el mismo PR el documento del módulo, [system-map](system-map.md), [hub/api](../hub/api.md) y este estado; registrar cada promoción a PROD en [deployments](../deployments/README.md).
