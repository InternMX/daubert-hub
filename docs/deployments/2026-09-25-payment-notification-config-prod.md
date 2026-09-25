# Payment Notifications company configuration – PROD promotion (2026-09-25)

Feature: **configure a company for Payment Notifications from the Hub** (Dropbox path, PARA/CC/CCO
recipients, "Procesa comprobantes", "Generar borradores"), with no manual SQL. Status (final,
2026-09-25): implemented, merged into `main`, deployed to PROD and functionally validated.
Functional documentation:
[company-configuration](../automations/payment-notifications/company-configuration.md).

## What was promoted

| Layer | Change |
| --- | --- |
| PostgreSQL (`daubert_global`) | Migration `20260925_011_hub_payment_notification_settings_permissions_prod` applied; PRECHECK and POSTCHECK passed. |
| Hub API + Web | Deployed with the functional configuration (company notification settings, Dropbox path suggestion, recipient flags and last-PARA invariant, file-level errors). |
| Hub Web (follow-up) | After the contextual help (tooltips) was added, **only Web needed one additional rebuild**. No further API, database or n8n change was required for the tooltips. The final Web deployment was made from `main`. |
| n8n | **No change.** It keeps consuming `core.vw_catalogo_notificacion_pago_n8n`; the reprocess contract by `correo_id`/hash is untouched. |

### Commits

| Commit | Subject | Scope |
| --- | --- | --- |
| `c7e3991` | `feat(payments): add company notification configuration` | Functional (API + Web + migration 011 files) |
| `c4a9cf3` | `feat(payments): surface file-level notification errors` | Functional |
| `36de43f` | `feat(payments): surface file-level notification errors` | Functional (second `fileErrors` commit; includes the later parser adjustment that correctly separates multiple inline file errors) |
| `815507e` | `feat(web): add contextual payment notification help` | Functional (Web only) |
| `b933325` | `merge: payment notification company configuration` | Functional merge into `main` |
| `2513aae` | `docs(payments): document company notification configuration` | Documentation |
| `f56c77e` | `merge: project technical documentation` | Previous documentation merge |

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

- Functional validation of the configuration flow in PROD was performed (details below).
- No mass backfill: historical companies are not modified automatically; a company without a
  settings row reads as `false`/`false` and a row is only written when the user saves.

## Final functional validation (PROD)

Checked manually in the Hub after the final Web deployment:

- The **Payment Notifications configuration** section is available from the provider detail in the Hub (mounted in `ProviderDetailPage`).
- **Dropbox path** is editable, and the **path suggestion** is available.
- The suggestion is **not saved nor does it overwrite** the current path automatically; it only
  applies after "Usar sugerencia" plus an explicit save.
- Contacts with a `CORREO` method accept **PARA / CC / CCO**.
- **"Correo principal" is independent** of the payment recipient.
- **Readiness** prevents activating an incomplete configuration.
- An **active company cannot be left without an operable PARA**.
- **File errors** (`fileErrors`) are shown separately from per-company results.
- **Contextual help** is available in the UI; at least one help icon was validated with **hover**
  and with **focus/keyboard**.
- The help icons do not change controls or business rules.

Not covered by this validation: no real e-mail sending was verified, and there is no real Dropbox
integration to verify (the Hub never queries Dropbox).

## Pending

- **Future evolution (not a current requirement):** direct Hub → Dropbox integration (verify that
  folders exist, create folders from the Hub, confirm the real path). Today creating/verifying the
  company folder remains an operator task.
- Historical active companies in an inconsistent state (e.g. no operable PARA) are not fixed
  automatically; review them from the Hub.

## Rollback notes

- PostgreSQL: `..._prod.down.sql` (revokes the Hub grant; the Hub would then lose the ability to
  configure notifications).
- Hub: redeploy the previous API/Web build. n8n needs no rollback.

No credentials, tokens or connection secrets belong in this document.
