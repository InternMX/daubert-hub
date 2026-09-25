# Caterpillar — Pruebas

Fuentes: `apps/api/test/*`, `apps/web/src/**/*.test.*`, `apps/api/package.json`, nota de despliegue 12C. **No se citan cifras** de casos o cobertura: ejecuta `npm run test` para obtenerlas.

## Mapa de pruebas

| Capa | Archivos (ejemplos verificados) | Qué cubre | Cómo correr |
| --- | --- | --- | --- |
| **API — unitarias** (Vitest, sin BD) | `caterpillar.controller.spec.ts`, `caterpillar-executions.service.spec.ts`, `caterpillar-reprocess-webhook.client.spec.ts`, `reprocess-caterpillar-execution.dto.spec.ts`, `caterpillar-executions.repository.spec.ts`, `caterpillar-routing.*.spec.ts`, `caterpillar-process-labels.spec.ts`, `automation-trigger-requests.repository.spec.ts`, `remisiones-caterpillar-activity.repository.spec.ts` | Controlador (roles, un solo `POST`, mapeo HTTP, ID BIGINT-safe), servicio (mapeo de resultados, sólo `executionId`/`reason` al webhook, auditoría best-effort), cliente webhook (contrato, 2xx flexible, códigos desconocidos → `INVALID_RESPONSE`, timeout, red, `NOT_CONFIGURED`, el token nunca aparece), DTO (`reason`) | `npm run test:api` |
| **Ajuste de folio** | `adjust-document-series.dto.spec.ts`, `document-series.repository.spec.ts`, `automations.service.spec.ts`, `document-series-folio-adjustment.integration.runner.cjs` | Reglas de ajuste seguro | ídem / runner |
| **Frontend** (Vitest + Testing Library) | `CaterpillarRemissionsPage.test.tsx`, `CaterpillarReprocessDialog.test.tsx`, `caterpillarPresentation.test.ts`, `caterpillarRemissions.test.ts`, `AdjustNextFolioDialog.test.tsx` | Página, visibilidad de **Reprocesar** por rol/estado, diálogo, mensajes por resultado, validación de forma de respuestas | `npm run test:web` |
| **Integración PostgreSQL (TEST)** | `caterpillar-model`, `caterpillar-execution-finalization`, `caterpillar-remision-persistence`, `caterpillar-completion-integrity` (`*.integration.runner.cjs`) | Modelo y ruteo, reservas (contiguas, idempotentes, concurrentes, rollback), ownership, series inactivas, finalización, persistencia de remisiones e integridad de completitud, permisos de roles (Hub vs `n8n_cat_test`), BIGINT como string | `npm run test:integration:caterpillar-model` (y análogos) |
| **E2E TEST** | Manual (n8n TEST + Hub TEST) | Flujo completo, reproceso por `webhook-test`, PDFs | Ver abajo |

Reglas de las pruebas de integración: requieren variables `TEST_DATABASE_URL` (y variantes `TEST_DATABASE_URL_MIGRATOR`, `TEST_DATABASE_URL_N8N_CAT_TEST`, `TEST_DATABASE_ADMIN_URL`) que **deben decodificar a `daubert_hub_test`**; el runner rechaza cualquier otra base antes de tocar datos. Nunca apuntan a `daubert_global`.

> ⚠️ `npm run test:integration` (y por tanto `npm run validate`) **no incluye** los runners `caterpillar-*` ni `document-series-folio-adjustment`; hay que correrlos por su script individual ([inconsistencia #7](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).
> ⚠️ No existe en el repo un runner que pruebe directamente los objetos de la 009 (resolver, índice único, `ALREADY_REPROCESSED`) — [inconsistencia #8](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración). Su verificación en PROD se hizo con el `precheck`/`postcheck` y smoke tests.

## E2E en TEST (manual)

Es un **checklist de referencia** con los resultados esperados según el contrato verificado en código/SQL. Los resultados históricos de corridas E2E ya realizadas no están registrados en el repositorio (PENDIENTE: registrar evidencia en `docs/deployments/` en futuras promociones).

Prerrequisitos: Hub TEST (`environment = TEST`), workflow n8n TEST, `CATERPILLAR_REPROCESS_WEBHOOK_URL` apuntando a `/webhook-test/cat-test-reprocess` y **n8n en modo "Execute workflow"** (esa URL sólo responde mientras el editor escucha).

| Caso | Esperado |
| --- | --- |
| Archivo nuevo procesable | Ejecución `COMPLETADA`, reservas `APLICADA`, remisiones `GENERADA`, PDFs generados, `siguiente_folio` avanzó exactamente `cantidad` |
| Mismo archivo en el siguiente ciclo | Sin nueva ejecución (`ALREADY_COMPLETED`); folios sin cambio |
| Falla forzada (p. ej. archivo inválido) | Reintentos hasta `max_intentos`, luego `ERROR`, reservas `ABANDONADA` |
| **Reproceso** de la ejecución en `ERROR` (desde Hub como `ADMIN`) | `REPROCESS_CREATED`; hija con `reproceso_de_id`; **folios nuevos**; original sin cambios |
| Repetir el reproceso | `ALREADY_REPROCESSED` (o `ALREADY_PROCESSING` si la hija sigue en curso); no hay segunda hija |
| Doble clic / concurrentes | Una sola hija |

### Casos negativos

| Caso | Esperado |
| --- | --- |
| `executionId` inexistente | 404 `NOT_FOUND` |
| Ejecución `COMPLETADA` | 409 `NOT_ELIGIBLE_STATE` |
| Archivo origen eliminado | 409 `SOURCE_FILE_MISSING` |
| Proceso fuera del ámbito | 409 `OUTSIDE_TEST_SCOPE` (TEST) / `OUTSIDE_ALLOWED_SCOPE` (PROD) |
| Usuario `GENERAL` | 403 |
| Sin sesión | 401 |
| `reason` vacío, >500 caracteres o campos extra | 400 |
| Token incorrecto / webhook inactivo / n8n caído | 502 (o 504 si excede 10 s) |
| Ejecución de Audi usada como `executionId` | 404 (el resolver sólo ve Caterpillar) |

### Validación de PDFs (manual)

No hay verificación automática del contenido de PDFs en el repo (el Hub sólo guarda `pdf_path` como texto). Checklist manual por remisión:

1. El archivo de `pdf_path` existe en la carpeta de salida y abre.
2. El folio del PDF coincide con `remisiones.folio` y la serie es la esperada.
3. Los renglones (código interno, part number, descripción, cantidad) coinciden con `remision_detalle`.
4. No hay PDFs para folios que no existen en BD, ni folios duplicados.
5. Tras un reproceso, los PDFs de la hija tienen folios **nuevos** y los de la original no se sobrescribieron.

## Promoción TEST → PROD (checklist)

Derivada de la promoción 12C ([nota](../../deployments/2026-09-24-caterpillar-12c-prod.md)) y del [proceso de migraciones](../../database/migrations.md#proceso-recomendado):

- [ ] Comportamiento validado en TEST (unitarias, integración y E2E anteriores).
- [ ] Migración PROD preparada con guard de base, `precheck`, `postcheck` y `down` con guards.
- [ ] `precheck` ejecutado; **línea base** registrada (folios, conteos, huellas).
- [ ] Backup verificado.
- [ ] Migración aplicada; `postcheck` en verde; folios y conteos sin cambio.
- [ ] Hub PROD desplegado; variables `CATERPILLAR_REPROCESS_WEBHOOK_URL/TOKEN` presentes en `pilot.prod.env` (ver [inconsistencia #2](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).
- [ ] Credencial Header Auth **propia de PROD** en n8n; workflow PROD importado/activado; el anterior queda **inactivo** como rollback (nunca ambos activos).
- [ ] Smoke tests **no destructivos**: `executionId` inexistente → 404; ejecución `COMPLETADA` → 409.
- [ ] Schedule de 10 min confirmado tras activar.
- [ ] Series/folios sin cambios frente a la línea base.
- [ ] Nota de despliegue creada en `docs/deployments/`.
