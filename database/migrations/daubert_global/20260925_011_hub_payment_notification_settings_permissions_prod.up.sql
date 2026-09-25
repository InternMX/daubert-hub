-- PRODUCTION-READY TEMPLATE - DO NOT APPLY TO daubert_global YET.
-- Payment Notifications company configuration (Hub CRUD, phase 1): permissions for the Hub role.
--
-- The Hub now reads and writes core.empresas_notificacion_pago (GET/PATCH companies/:id/payment-notification-settings,
-- provider creation, and ruta_dropbox/ruta_destino synchronization):
--   * SELECT  - settings + readiness read;
--   * INSERT  - provider creation, and UPSERT for historical companies without a row
--               (INSERT ... ON CONFLICT (empresa_id) DO UPDATE);
--   * UPDATE  - the DO UPDATE branch and flag changes.
-- The table has NO identity column (empresa_id is the PK/FK), so no sequence privilege is involved.
--
-- Grant applied here (and nothing else):
--   GRANT SELECT, INSERT, UPDATE ON TABLE core.empresas_notificacion_pago TO daubert_hub_app;
--
-- Deliberately NOT granted: DELETE (the Hub never deletes settings; the FK cascades from
-- core.empresas), TRUNCATE, REFERENCES, TRIGGER, ALL, CREATE, WITH GRANT OPTION, any sequence
-- privilege. No ownership, default-privilege, n8n_app (or any other role) change. n8n keeps consuming
-- core.vw_catalogo_notificacion_pago_n8n exactly as before.
--
-- Safety: runs only on daubert_global; aborts unless daubert_hub_app has NO privilege of any kind on the
-- table (the state the precheck expects); verifies the result inside the same transaction (a GRANT by a
-- role without grant option only warns) and that no other ACL/owner/default privilege changed.
--
-- Suggested order: run 20260925_011_hub_payment_notification_settings_permissions_prod.precheck.sql (read-only) and record its
-- baseline values, apply this file, then run ..._prod.postcheck.sql (read-only).
-- Rollback: 20260925_011_hub_payment_notification_settings_permissions_prod.down.sql.
BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $migration_guard$
DECLARE
    v_hub oid;
    v_tbl oid := to_regclass('core.empresas_notificacion_pago');
    v_direct text;
    v_others_fp text;
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION 'Migration 20260925_011 is restricted to daubert_global; current database is %', current_database();
    END IF;

    SELECT oid INTO v_hub FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app';
    IF v_hub IS NULL THEN
        RAISE EXCEPTION 'Required role daubert_hub_app does not exist';
    END IF;
    IF v_tbl IS NULL THEN
        RAISE EXCEPTION 'Required table core.empresas_notificacion_pago does not exist';
    END IF;

    SELECT COALESCE(string_agg(e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END,
                               ',' ORDER BY e.privilege_type), '')
    INTO v_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_tbl AND e.grantee = v_hub;

    IF v_direct <> '' THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app already has direct grants on core.empresas_notificacion_pago (%); expected none. Re-run the precheck.', v_direct;
    END IF;

    -- Effective privileges (also catches grants inherited via PUBLIC or role membership).
    IF has_table_privilege(v_hub, v_tbl, 'SELECT') OR has_table_privilege(v_hub, v_tbl, 'INSERT')
       OR has_table_privilege(v_hub, v_tbl, 'UPDATE') OR has_table_privilege(v_hub, v_tbl, 'DELETE')
       OR has_table_privilege(v_hub, v_tbl, 'TRUNCATE') OR has_table_privilege(v_hub, v_tbl, 'REFERENCES')
       OR has_table_privilege(v_hub, v_tbl, 'TRIGGER') THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app has effective privileges on core.empresas_notificacion_pago; expected none';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e
               WHERE a.attrelid = v_tbl AND a.attacl IS NOT NULL AND e.grantee = v_hub) THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app has column-level privileges on core.empresas_notificacion_pago';
    END IF;

    -- Snapshot of everything 011 must NOT change (see precheck section 8, baseline_others_fp).
    SELECT md5(COALESCE(string_agg(entry_text, E'\n' ORDER BY entry_text), ''))
        INTO v_others_fp
        FROM (
            SELECT 'rel|' || n.nspname || '.' || c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' ||
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' ||
                   pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable AS entry_text
            FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,
                    acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) AS a
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
              AND NOT (c.oid = v_tbl AND a.grantee = v_hub)
            UNION ALL
            SELECT 'col|' || n.nspname || '.' || c.relname || '.' || att.attname || '|' ||
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' ||
                   a.privilege_type || ':' || a.is_grantable
            FROM pg_catalog.pg_attribute AS att
            JOIN pg_catalog.pg_class AS c ON c.oid = att.attrelid
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL aclexplode(att.attacl) AS a
            WHERE att.attacl IS NOT NULL AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            UNION ALL
            SELECT 'nsp|' || n.nspname || '|' || pg_get_userbyid(n.nspowner) || '|' ||
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' ||
                   a.privilege_type || ':' || a.is_grantable
            FROM pg_catalog.pg_namespace AS n
            CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS a
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
            UNION ALL
            SELECT 'defacl|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text
            FROM pg_catalog.pg_default_acl AS d
        ) AS fp_rows;

    PERFORM set_config('mig011.others_fp', v_others_fp, true);
END
$migration_guard$;

GRANT SELECT, INSERT, UPDATE ON TABLE core.empresas_notificacion_pago TO daubert_hub_app;

DO $migration_verify$
DECLARE
    v_hub oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app');
    v_tbl oid := to_regclass('core.empresas_notificacion_pago');
    v_direct text;
    v_others_fp text;
BEGIN
    SELECT COALESCE(string_agg(e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END,
                               ',' ORDER BY e.privilege_type), '')
    INTO v_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_tbl AND e.grantee = v_hub;

    -- A GRANT issued by a role without grant option only warns; fail loudly instead.
    IF v_direct <> 'INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'GRANT verification failed on core.empresas_notificacion_pago: hub direct grants are (%)', v_direct;
    END IF;
    IF has_table_privilege(v_hub, v_tbl, 'DELETE') OR has_table_privilege(v_hub, v_tbl, 'TRUNCATE')
       OR has_table_privilege(v_hub, v_tbl, 'REFERENCES') OR has_table_privilege(v_hub, v_tbl, 'TRIGGER') THEN
        RAISE EXCEPTION 'GRANT verification failed: hub gained a privilege that 011 must not grant';
    END IF;

    SELECT md5(COALESCE(string_agg(entry_text, E'\n' ORDER BY entry_text), ''))
        INTO v_others_fp
        FROM (
            SELECT 'rel|' || n.nspname || '.' || c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' ||
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' ||
                   pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable AS entry_text
            FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,
                    acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) AS a
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
              AND NOT (c.oid = v_tbl AND a.grantee = v_hub)
            UNION ALL
            SELECT 'col|' || n.nspname || '.' || c.relname || '.' || att.attname || '|' ||
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' ||
                   a.privilege_type || ':' || a.is_grantable
            FROM pg_catalog.pg_attribute AS att
            JOIN pg_catalog.pg_class AS c ON c.oid = att.attrelid
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL aclexplode(att.attacl) AS a
            WHERE att.attacl IS NOT NULL AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            UNION ALL
            SELECT 'nsp|' || n.nspname || '|' || pg_get_userbyid(n.nspowner) || '|' ||
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' ||
                   a.privilege_type || ':' || a.is_grantable
            FROM pg_catalog.pg_namespace AS n
            CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS a
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
            UNION ALL
            SELECT 'defacl|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text
            FROM pg_catalog.pg_default_acl AS d
        ) AS fp_rows;

    IF v_others_fp IS DISTINCT FROM current_setting('mig011.others_fp', true) THEN
        RAISE EXCEPTION 'Verification failed: an ACL/owner/default privilege other than the hub grant changed';
    END IF;
END
$migration_verify$;

COMMIT;
