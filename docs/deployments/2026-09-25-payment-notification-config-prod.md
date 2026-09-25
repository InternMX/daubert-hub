# Payment Notifications company configuration – PROD promotion (2026-09-25)

Feature: **configure a company for Payment Notifications from the Hub** (Dropbox path, PARA/CC/CCO
recipients, "Procesa comprobantes", "Generar borradores"), with no manual SQL. Status: promoted to
PROD and functionally validated. Functional documentation:
[company-configuration](../automations/payment-notifications/company-configuration.md).

## What was promoted

| Layer | Change |
| --- | --- |
| PostgreSQL (`daubert_global`) | Migration `20260925_011_hub_payment_notification_settings_permissions_prod` applied; PRECHECK and POSTCHECK passed. |
| Hub API + Web | Deployed (company notification settings, Dropbox path suggestion, recipient flags and last-PARA invariant, file-level errors, contextual help). |
| n8n | **No change.** It keeps consuming `core.vw_catalogo_notificacion_pago_n8n`; the reprocess contract by `correo_id`/hash is untouched. |

Related repo commits: `c7e3991` (company notification configuration), `c4a9cf3` / `36de43f`
(file-level notification errors), `815507e` (contextual help).

### Migration 011 (PROD)

Files are versioned in [`database/migrations/daubert_global/`](../../database/migrations/daubert_global):

- `20260925_011_hub_payment_notification_settings_permissions_prod.up.sql`
- `20260925_011_hub_payment_notification_settings_permissions_prod.down.sql`
- `20260925_011_hub_payment_notification_settings_permissions_prod.precheck.sql` (read-only)
- `20260925_011_hub_payment_notification_settings_permissions_prod.postcheck.sql` (read-only)

Delta: `GRANT SELECT, INSERT, UPDATE ON core.empresas_notificacion_pago TO daubert_hub_app`.

Result in PROD:

- `daubert_hub_app` has `SELECT`, `INSERT`, `UPDATE`; it does **not** have `DELETE`, `TRUNCATE`,
  `REFERENCES` or `TRIGGER`.
- No additional privileges for `n8n_app`, `daubert_docs_ro` or the TEST roles.
- No sequence privileges were needed (the table has no identity column).
- PRECHECK passed → UP applied → POSTCHECK passed; the baseline of every other privilege (ACLs,
  owners, default privileges) stayed unchanged.

The migration only runs against `daubert_global` and aborts if `daubert_hub_app` already has any
privilege on the table.

## Verification

- Functional validation of the configuration flow in PROD was performed.
- No mass backfill: historical companies are not modified automatically; a company without a
  settings row reads as `false`/`false` and a row is only written when the user saves.

## Pending

- The Hub does not check Dropbox: creating/verifying the company folder remains an operator task
  (there is no direct Hub → Dropbox integration).
- Historical active companies in an inconsistent state (e.g. no operable PARA) are not fixed
  automatically; review them from the Hub.

## Rollback notes

- PostgreSQL: `..._prod.down.sql` (revokes the Hub grant; the Hub would then lose the ability to
  configure notifications).
- Hub: redeploy the previous API/Web build. n8n needs no rollback.

No credentials, tokens or connection secrets belong in this document.
