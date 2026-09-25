-- ROLLBACK of 20260925_011_hub_payment_notification_settings_permissions_prod.up.sql (daubert_global only).
-- Reverts EXACTLY what 011 granted:
--   REVOKE SELECT, INSERT, UPDATE ON TABLE core.empresas_notificacion_pago FROM daubert_hub_app;
-- Expected result after DOWN: daubert_hub_app has no privilege on the table (the state 011 required).
-- No sequence, other role or other object is touched.
--
-- Safety: aborts (nothing is revoked) unless the hub ACL is exactly the state left by the UP
-- (INSERT, SELECT, UPDATE, not grantable, no column-level privileges). If someone added or changed
-- privileges afterwards, revoking blindly could break the app or hide that change.
BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
    v_hub oid;
    v_tbl oid := to_regclass('core.empresas_notificacion_pago');
    v_direct text;
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION 'Rollback 20260925_011 is restricted to daubert_global; current database is %', current_database();
    END IF;
    SELECT oid INTO v_hub FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app';
    IF v_hub IS NULL THEN
        RAISE EXCEPTION 'Required role daubert_hub_app does not exist';
    END IF;
    IF v_tbl IS NULL THEN
        RAISE EXCEPTION 'core.empresas_notificacion_pago does not exist';
    END IF;

    SELECT COALESCE(string_agg(e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END,
                               ',' ORDER BY e.privilege_type), '')
    INTO v_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_tbl AND e.grantee = v_hub;

    IF v_direct <> 'INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app direct grants on core.empresas_notificacion_pago are (%); expected exactly INSERT,SELECT,UPDATE (post-UP state)', v_direct;
    END IF;
    IF has_table_privilege(v_hub, v_tbl, 'DELETE') OR has_table_privilege(v_hub, v_tbl, 'TRUNCATE')
       OR has_table_privilege(v_hub, v_tbl, 'REFERENCES') OR has_table_privilege(v_hub, v_tbl, 'TRIGGER') THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app has extra effective privileges beyond the post-UP state';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e
               WHERE a.attrelid = v_tbl AND a.attacl IS NOT NULL AND e.grantee = v_hub) THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app has column-level privileges on core.empresas_notificacion_pago';
    END IF;
END
$rollback_guard$;

REVOKE SELECT, INSERT, UPDATE ON TABLE core.empresas_notificacion_pago FROM daubert_hub_app;

DO $rollback_verify$
DECLARE
    v_hub oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app');
    v_tbl oid := to_regclass('core.empresas_notificacion_pago');
    v_direct text;
BEGIN
    SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '')
    INTO v_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_tbl AND e.grantee = v_hub;

    -- A REVOKE issued by a role that is not the grantor only warns; fail loudly instead.
    IF v_direct <> '' OR has_table_privilege(v_hub, v_tbl, 'SELECT') OR has_table_privilege(v_hub, v_tbl, 'INSERT')
       OR has_table_privilege(v_hub, v_tbl, 'UPDATE') OR has_table_privilege(v_hub, v_tbl, 'DELETE') THEN
        RAISE EXCEPTION 'REVOKE verification failed on core.empresas_notificacion_pago: hub direct grants are (%)', v_direct;
    END IF;
END
$rollback_verify$;

COMMIT;
