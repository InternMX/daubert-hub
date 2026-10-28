# Caterpillar — Runbook de PROD

## Estado vigente (2026-10-28, Hub 1.1.0)

> Esta sección manda sobre el resto del documento, que describe el estado del **2026-09-24** (despliegue 12C) y se conserva como **histórico** para el rollback y la verificación de 12C.

| Elemento | Estado vigente | Evidencia |
| --- | --- | --- |
| Workflow activo en PROD | `catProd016Remisiones01` (62 nodos): Schedule cada 10 min y Webhook POST `cat-reprocess`; credencial PostgreSQL dedicada `Postgres produccion CAT (n8n_cat_prod)` (rol `n8n_cat_prod`, creado el 2026-10-27) | [despliegue conjunto](../../deployments/2026-10-27-hub-pagos-caterpillar-joint-prod.md) |
| Workflows anteriores | `9Ngnrpi16b6GtOAX` (12C) inactivo y **conservado como rollback; nunca activo a la vez que el 016**. Los workflows `qe21HhdBcyjpYA67` y `G6DvdBTwqsQd3GPD` están archivados | ídem |
| Hub | `1.1.0` / `6909dc8`: series, historial, detalle, errores, ajuste de folio (fase **12B**, ADMIN, con bitácora `operacion.ajustes_series`), reproceso, regeneración comercial y cancelación individual (todos `ADMIN`) | [hub/authorization](../../hub/authorization.md) · [nota 1.1.0](../../deployments/2026-10-28-hub-v1.1.0-prod.md) |
| Migraciones en PROD | 009 (reproceso), 013 (cancelación) y 016 (admisión atómica, `SKIPPED_HISTORICAL`); **no** se aplicaron las `*_test` (014, 015, 017) | [database/migrations](../../database/migrations.md) |
| Folios y duplicados | `UNIQUE(ejecucion_id, serie_id)`, reservas contiguas con `reservar_folios_para_ejecucion`, rechazo `PROGRAM_ALREADY_EMITTED` y omisión de históricos ya emitidos sin detener el lote; sin duplicados (validado en TEST y por las pruebas) | [database-contract](database-contract.md) · [automatic-admission](automatic-admission.md) |
| Actividad reciente | **Implementada y verificada** (API, web, pruebas y verificación visual en PROD tras 1.1.0); ya no es un pendiente | [hub/automations](../../hub/automations.md) |
| Validado en TEST, **no** en PROD | Admisión atómica con snapshot, reproceso con hijo único, regeneración comercial, cancelación individual e histórico B1 (E2E reales en n8n TEST, 2026-10-23/26). En PROD no hay aún uso real de ninguno | [integration-runbook-test-015](integration-runbook-test-015.md) §10-§15 |
| **Primera emisión real tras 016** | **Pendiente de validación de negocio.** Los ciclos del Schedule terminan en «success», pero no hay evidencia de que haya emitido remisiones. Verificar con `apps/api/scripts/caterpillar-015-verify.cjs` (solo lectura) | [pendientes P-03](../../00-overview/pending-and-roadmap.md#3-implementado-pero-pendiente-de-validación-real-en-producción) |
| **Error Workflow** | **No configurado** en el workflow de PRODUCCIÓN (Audi y Pagos sí lo tienen). Un fallo solo es visible en la ejecución de n8n y en el Hub | P-04 |
| Procesos / plantas habilitados | **No reconfirmado.** Último estado verificado (2026-09-24): P2, P5 y P6 habilitados; P3, P4, NL FINSA 1/3 y Torreón/Planta 2 no. Depende de `PROCESOS_HABILITADOS_PROD` (duplicado en `Detectar archivos CAT1` y `Validar elegibilidad reproceso CAT`) y de `ops.automatizacion_series_proceso`. No dar por habilitada una ruta sin comprobarlo | P-13 |
| TEST vs PROD | Difieren en rutas, credenciales, webhook y ámbito; la paridad funcional nodo a nodo **no está verificada** | [n8n-test-prod-drift](../n8n-test-prod-drift.md) |
| Ejecuciones protegidas | Cinco ejecuciones `waiting` (672, 681, 685, 686, 689) de workflows archivados: no reanudar, reintentar ni borrar | nota conjunta |

Seguimiento: [pendientes y hoja de ruta](../../00-overview/pending-and-roadmap.md).

---

# Histórico: despliegue 12C (2026-09-24)

Fuentes: [nota de despliegue 12C](../../deployments/2026-09-24-caterpillar-12c-prod.md), migración 009 (repo), paquete Caterpillar 2026-09-21 (externo), código del Hub. **Sin secretos.** Los hechos "al 2026-09-24" son el estado registrado en la nota; verifica el estado actual antes de actuar.

> **Corte 015 → PROD (016):** el paquete (migración, rol dedicado, candidato n8n, inspección, ensayo y procedimiento de corte/recuperación) está en [prod-cutover-016.md](prod-cutover-016.md) y **ya se aplicó el 2026-10-27**. Esta sección describe el estado hasta ese corte (**histórico**).

## Componentes en PROD

| Elemento | Valor |
| --- | --- |
| Base | `daubert_global` |
| Rol Hub | `daubert_hub_app` |
| Rol n8n | `n8n_app` (compartido con Remisiones Audi; sin rol dedicado) |
| Webhook de reproceso | `POST /webhook/cat-reprocess` — Header Auth `X-Daubert-Automation-Token`, credencial **específica de PROD** |
| Workflow activo | `Remisiones CAT Produccion PG` (incluye la rama de reproceso) |
| Workflow previo a 12C | Inactivo temporalmente, **rollback**. Nunca activo a la vez que el nuevo (mismo schedule) |
| Schedule | Cada 10 minutos (validado tras activar) |

## Procesos habilitados hoy

| Proceso | Estado (al 2026-09-24) | Serie |
| --- | --- | --- |
| **P2** | Habilitado | `REMISION_CAT_P2` |
| **P5** | Habilitado | `REMISION_CAT_P5` |
| **P6** | Habilitado | `REMISION_CAT_P6` |
| P3 | No habilitado | `REMISION_CAT_P3` |
| P4 | No habilitado | `REMISION_CAT_P4` |
| NL FINSA 1 | No habilitado | `REMISION_CAT_NL_FINSA_1` |
| NL FINSA 3 | No habilitado | `REMISION_CAT_NL_FINSA_3` |
| Torreón (y Planta 2) | No habilitado | `REMISION_CAT_TORREON` |

> **Esto refleja el estado actual, no una regla permanente.** Habilitar más procesos es una decisión operativa que involucra (a) la lista `PROCESOS_HABILITADOS_PROD` del workflow (verificada en el export; está **duplicada** en `Detectar archivos CAT1` y `Validar elegibilidad reproceso CAT`, y ambas copias deben editarse juntas), (b) el `estatus` de la serie en PostgreSQL (`ACTIVA`/`INACTIVA`; el seed de PROD dejó activas sólo P2, P5 y P6) y (c) un `folio_minimo_ajustable`/contador verificados. El reproceso sigue **el mismo gating** que el pipeline automático: procesos no habilitados no se pueden reprocesar.

## Migración 009

Aplicada; postcheck pasó. Contenido, guards y archivos: [database/migrations](../../database/migrations.md#migración-009-prod-caterpillar-reproceso-manual). Resumen de lo que se verificó con **precheck/postcheck** (ambos de sólo lectura):

- Precheck: base correcta, rol `n8n_app`, objetos requeridos existentes, delta **no** existente, huella md5 esperada de `fn_crear_ejecucion_automatizacion` (versión previa), **cero** padres con más de un hijo, cero reprocesos/en curso, y línea base (huellas de series y funciones, conteos de ejecuciones/remisiones/detalle/reservas).
- Postcheck: resolver `SECURITY DEFINER` con `search_path` controlado, `PUBLIC` sin `EXECUTE`, `n8n_app` con `EXECUTE`, **Hub sin `EXECUTE`**; índice único válido con la definición esperada; `fn_crear_ejecucion_automatizacion` con la huella de la 009; **nada más cambió** (series/folios, otras funciones y ACLs, conteos); `ALL_CHECKS_PASS`.

## Verificación posterior (registrada en la nota)

| Prueba | Resultado |
| --- | --- |
| Smoke: `executionId` inexistente | **404** |
| Smoke: ejecución `COMPLETADA` | **409** |
| Schedule cada 10 min | Confirmado tras la activación |
| Folios (línea base post-promoción) | P2 = 85, P5 = 124, P6 = 8 — **sin cambios** por la promoción |
| Ejecuciones Caterpillar | #10 y #11, ambas `COMPLETADA` |
| Reservas / remisiones | 2 reservas, 6 remisiones |
| Reprocesos sintéticos | **Ninguno** creado en PROD |

Estos smoke tests son **no destructivos** (404 y 409 no crean nada).

## Primer reproceso real (diferido)

El primer `REPROCESS_CREATED` real en PROD se **difiere** hasta que exista una ejecución **real** en `ERROR`/`CANCELADA`. No se fabricó ninguna. Cuando ocurra, verificar:

1. Antes: anotar `siguiente_folio` de la serie afectada y el estado de la original.
2. Ejecutar **Reprocesar** desde el Hub como `ADMIN` con un motivo claro.
3. Respuesta `REPROCESS_CREATED` con `executionId` de la hija.
4. Hija con `reproceso_de_id` = original, estado final `COMPLETADA`.
5. Reservas nuevas `APLICADA` (rango posterior al anterior) y remisiones `GENERADA` con PDFs válidos.
6. Original sin cambios (`ERROR`/`CANCELADA`, sus reservas `ABANDONADA`).
7. Repetir la solicitud → `ALREADY_REPROCESSED`.
8. Registrar el resultado en una nueva nota en `docs/deployments/`.

## Workflows

- Un solo workflow activo con el schedule de Caterpillar. **Si dos están activos** ambos procesan los mismos archivos: ver [troubleshooting](troubleshooting.md#15-dos-workflows-activos-accidentalmente).
- Decisión pendiente: cuándo eliminar el workflow pre-12C (se conserva inactivo mientras el nuevo no se considere estable).

## Rollback

| Capa | Acción | Cuidado |
| --- | --- | --- |
| n8n | Desactivar `Remisiones CAT Produccion PG` y reactivar el workflow pre-12C | Nunca ambos activos. Pierde el webhook de reproceso (el Hub devolverá 502) |
| PostgreSQL | `…_prod.down.sql` | **Aborta** si existe cualquier reproceso; no borra datos. Con reprocesos existentes, tratar como corrección hacia adelante |
| Hub | Redesplegar la versión anterior (Compose) | El botón de reproceso no debe quedar apuntando a un webhook inexistente |

## Checklist operativo diario/semanal (sugerido)

- Hub → Caterpillar: sin ejecuciones `PROCESANDO` viejas ni `ERROR` sin atender.
- Folios de P2/P5/P6 avanzando sólo cuando hay remisiones nuevas.
- Un solo workflow activo.

## Operación (Fase D2, verificada contra el export)

> **Histórico en cuanto al workflow:** los nombres y rutas de esta sección corresponden al workflow 12C `Remisiones CAT Produccion PG`. Desde el 2026-10-27 el activo es `catProd016Remisiones01`; las tareas de revisión (salud, input, output, reproceso, detener/reactivar) siguen siendo válidas sustituyendo ese nombre, y el riesgo «sin Error Workflow» sigue vigente.

Workflow: `Remisiones CAT Produccion PG` ([export](../../../n8n/workflows/remisiones-caterpillar/prod/workflow.json)). Instancia n8n **compartida con TEST** (mismo `instanceId` en todos los exports): distingue siempre el nombre del workflow y su credencial.

| Tarea | Cómo |
| --- | --- |
| **Revisar salud** | Hub → Caterpillar: última ejecución reciente (ciclo de 10 min), sin `PROCESANDO` viejas ni `ERROR` sin atender. En n8n: el workflow `Remisiones CAT Produccion PG` está **Active** y tiene ejecuciones cada 10 min. |
| **Identificar la ejecución** | Hub → detalle: `n8nExecutionId` enlaza con el editor de n8n; `latestErrorNode` = nodo que falló. |
| **Verificar el input** | Carpeta del cliente (`…\Dropbox\CLIENTES\<planta>\…\SOLICITUD DE MATERIAL[\<año>]`): nombre con `PROGRAMACION DE ENTREGA`, Excel, posterior al corte 2026-09-22, proceso habilitado ([troubleshooting #19](troubleshooting.md#19-un-archivo-nuevo-de-programación-de-entrega-no-se-procesa)). Copia de trabajo en `01_ENTRADA`. |
| **Verificar el output** | PDFs en `…\REMISIONES CAT\02_SALIDAS\<cliente_grupo>[\<planta/subplanta>]`; coinciden con `remisiones.pdf_path` (Hub → detalle) y con [testing → PDFs](testing.md#validación-de-pdfs-manual). Logs de error en `04_ERRORES`. |
| **Revisar n8n** | Historial de ejecuciones del workflow (nodo con error), y el webhook `cat-reprocess` sólo responde si el workflow está activo. |
| **Revisar PostgreSQL** | Consultas de sólo lectura sobre `ops.ejecuciones_automatizacion`, reservas y remisiones ([troubleshooting](troubleshooting.md#reglas-generales)). |
| **Reprocesar** | Hub → detalle de la ejecución en `ERROR`/`CANCELADA` → **Reprocesar** (`ADMIN`). Ver [reprocessing](reprocessing.md). |
| **Detener de forma segura** | Desactivar el workflow en n8n **entre ciclos** (sin ejecución en curso). Una ejecución en curso que se interrumpe queda `PROCESANDO` y se retomará al reactivar (ver troubleshooting #11 y #17). Al desactivar también se deshabilita el webhook de reproceso (el Hub devolverá 502). |
| **Reactivar** | Activar el workflow; confirmar que corre en el siguiente ciclo y que no hay `PROCESANDO` huérfanas. |
| **Rollback de workflow** | Ver abajo. |
| **Comprobar que sólo un PROD está activo** | En n8n, filtrar por "Active" y verificar que **sólo un** workflow de Caterpillar (nombre `Remisiones CAT …`) está activo. Los exports muestran que `MANUAL TEST REMISIONES CAT` y el candidato PG están inactivos. |

### Rollback: aclaración importante (D2)

La nota 12C habla de un "workflow previo a 12C, inactivo, como rollback". En los exports hay **dos** candidatos que encajan y **ninguno se puede confirmar como el que está en n8n**:

1. `Remisiones CAT Produccion PG CANDIDATE` — PostgreSQL **sin** rama de reproceso; usa la credencial `Postgres produccion`; inactivo; sin `id` (carpeta `PROMOCION_PROD` de pruebas). Versionado como [histórico](../../../n8n/workflows/remisiones-caterpillar/historical/pg-pre-reprocess-candidate.json).
2. `Remisiones CAT Produccion` — versión **anterior a PostgreSQL** (contadores JSON), con el **mismo `id`** que el workflow PROD actual (es una versión previa del mismo workflow, no un segundo workflow).

⚠️ **No usar (2) como rollback**: los folios están controlados por PostgreSQL y esa versión usa contadores JSON obsoletos: emitiría folios que colisionan con los de la base. Antes de cualquier rollback, confirmar en n8n cuál es el workflow inactivo real.

### Riesgos operativos específicos (de los nodos)

- `PROCESOS_HABILITADOS_PROD` y `RUTAS_REALES` duplicados en dos nodos.
- Sin Error Workflow: los fallos fuera de los dos nodos con salida de error no se registran en PostgreSQL.
- El mapeo planta → serie está hardcodeado; PostgreSQL sólo lo valida (ruta activa, serie activa).
- Los scripts PowerShell se ejecutan con `-ExecutionPolicy Bypass` desde `05_ARCHIVOS AUXILIARES\SCRIPTS` (sincronizada por Dropbox): quien pueda escribir ahí ejecuta código en el servidor.
