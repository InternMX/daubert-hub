# Caterpillar 12C – PROD promotion (2026-09-24)

Feature: **manual reprocess of Caterpillar remission executions from the Hub**
(Phase 12C). Status: promoted to PROD and verified.

## What was promoted

| Layer | Change |
| --- | --- |
| PostgreSQL (`daubert_global`) | Migration `20260923_009_caterpillar_manual_reprocess_prod` applied; its postcheck passed. |
| Hub | PROD deployed. The API client accepts both `OUTSIDE_TEST_SCOPE` (TEST n8n) and `OUTSIDE_ALLOWED_SCOPE` (PROD n8n) as valid rejections (HTTP 409). |
| n8n | New PROD workflow active (below). |

### Migration 009 (PROD)

Files are versioned in [`database/migrations/daubert_global/`](../../database/migrations/daubert_global):

- `20260923_009_caterpillar_manual_reprocess_prod.up.sql`
- `20260923_009_caterpillar_manual_reprocess_prod.down.sql`
- `20260923_009_caterpillar_manual_reprocess_prod.precheck.sql` (read-only)
- `20260923_009_caterpillar_manual_reprocess_prod.postcheck.sql` (read-only)

It delivers only the missing delta on top of what PROD already had:

1. `ops.fn_resolver_ejecucion_para_reproceso(bigint)` – `SECURITY DEFINER`, fixed
   `search_path`, Caterpillar-only, `EXECUTE` revoked from `PUBLIC` and granted to `n8n_app`.
2. Partial unique index `uq_ejecuciones_automatizacion_reproceso_unico`
   (one direct reprocess child per parent execution).
3. `ops.fn_crear_ejecucion_automatizacion(...)` replaced to return
   `ALREADY_REPROCESSED` for a repeated reprocess of the same parent.

The migration only runs against `daubert_global`, refuses to run if `fn_crear_ejecucion_automatizacion`
is not the expected pre-009 body, and never deletes data. The down migration refuses to run when
any reprocess execution exists.

### n8n

- **PROD n8n role:** `n8n_app` (shared with Remisiones Audi). No dedicated Caterpillar role was created.
- **Webhook:** `POST /webhook/cat-reprocess`, Header Auth (`X-Daubert-Automation-Token`) with a
  PROD-specific credential distinct from TEST. Body: `{ "executionId", "reason" }` only; path,
  document, plant and series are resolved from PostgreSQL.
- **Rejections:** `NOT_FOUND`, `NOT_ELIGIBLE_STATE`, `SOURCE_FILE_MISSING`, `OUTSIDE_ALLOWED_SCOPE`.
- **Accepted:** `REPROCESS_CREATED`, `ALREADY_PROCESSING`, `ALREADY_REPROCESSED`.
- **Enabled processes (reprocess follows the automatic pipeline gating):** P2, P5, P6.
  P3, P4, NL/FINSA and Torreón stay inactive and cannot be reprocessed.
- **Workflows:**
  - active: `Remisiones CAT Produccion PG` (now includes the reprocess branch);
  - previous pre-12C workflow: kept **inactive temporarily** as the rollback.
- **Schedule:** every 10 minutes, verified after activation.

## Verification

- Smoke tests against PROD: nonexistent `executionId` → **404**; `COMPLETADA` execution → **409**.
- Schedule (10 min) confirmed working.
- Post-promotion baseline (unchanged by the promotion):
  - document series folios: **P2 = 85, P5 = 124, P6 = 8**;
  - Caterpillar executions: **#10 and #11**, both `COMPLETADA`;
  - **2** folio reservations and **6** Caterpillar remissions.
- No synthetic reprocess was created in PROD.

## Pending

- The first real `REPROCESS_CREATED` in PROD is deferred until a genuine `ERROR`/`CANCELADA`
  Caterpillar execution exists. When it happens, verify the child execution, the folio
  reservations and the generated remissions.
- Once the new workflow is considered stable, decide when to delete the inactive pre-12C
  workflow (kept for rollback until then). Never keep both active: they share the same schedule.

## Rollback notes

- n8n: deactivate `Remisiones CAT Produccion PG` and reactivate the previous pre-12C workflow.
- PostgreSQL: `..._prod.down.sql` (aborts if any reprocess exists).

No credentials, tokens or connection secrets belong in this document.
