# Caterpillar — Runbook de PROD

Fuentes: [nota de despliegue 12C](../../deployments/2026-09-24-caterpillar-12c-prod.md), migración 009 (repo), paquete Caterpillar 2026-09-21 (externo), código del Hub. **Sin secretos.** Los hechos "al 2026-09-24" son el estado registrado en la nota; verifica el estado actual antes de actuar.

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

> **Esto refleja el estado actual, no una regla permanente.** Habilitar más procesos es una decisión operativa que involucra (a) la lista `PROCESOS_HABILITADOS_PROD` del workflow (*Descripción de proyecto*), (b) el `estatus` de la serie en PostgreSQL (`ACTIVA`/`INACTIVA`; el seed de PROD dejó activas sólo P2, P5 y P6) y (c) un `folio_minimo_ajustable`/contador verificados. El reproceso sigue **el mismo gating** que el pipeline automático: procesos no habilitados no se pueden reprocesar.

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
