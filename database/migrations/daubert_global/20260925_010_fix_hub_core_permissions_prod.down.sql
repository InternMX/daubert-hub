-- ROLLBACK of 20260925_010_fix_hub_core_permissions_prod.up.sql (daubert_global only).
-- Reverts EXACTLY what 010 granted:
--   REVOKE SELECT, INSERT, UPDATE ON TABLE core.direcciones   FROM daubert_hub_app;
--   REVOKE UPDATE                 ON TABLE core.alias_empresa FROM daubert_hub_app;
-- Expected result after DOWN:
--   core.direcciones   : SELECT/INSERT/UPDATE/DELETE = false
--   core.alias_empresa : SELECT = true, INSERT = true, UPDATE = false, DELETE = true
-- The historical alias grants (SELECT, INSERT, DELETE from 20260828_001) are NOT touched, and no
-- sequence, other role or other object is touched.
--
-- Safety: aborts (nothing is revoked) unless the hub ACL is exactly the state left by the UP. If someone
-- added or changed privileges afterwards, revoking blindly could break the app or hide that change.
BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
    v_hub oid;
    v_dir oid := to_regclass('core.direcciones');
    v_ali oid := to_regclass('core.alias_empresa');
    v_dir_direct text;
    v_ali_direct text;
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION
            'Rollback 20260925_010 is restricted to daubert_global; current database is %',
            current_database();
    END IF;

    SELECT oid INTO v_hub FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app';
    IF v_hub IS NULL THEN
        RAISE EXCEPTION 'Required role daubert_hub_app does not exist';
    END IF;
    IF v_dir IS NULL OR v_ali IS NULL THEN
        RAISE EXCEPTION 'core.direcciones or core.alias_empresa does not exist';
    END IF;

    SELECT COALESCE(string_agg(e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END,
                               ',' ORDER BY e.privilege_type), '')
    INTO v_dir_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_dir AND e.grantee = v_hub;

    SELECT COALESCE(string_agg(e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END,
                               ',' ORDER BY e.privilege_type), '')
    INTO v_ali_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_ali AND e.grantee = v_hub;

    IF v_dir_direct <> 'INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app direct grants on core.direcciones are (%); expected exactly INSERT,SELECT,UPDATE (post-UP state)', v_dir_direct;
    END IF;
    IF v_ali_direct <> 'DELETE,INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app direct grants on core.alias_empresa are (%); expected exactly DELETE,INSERT,SELECT,UPDATE (post-UP state)', v_ali_direct;
    END IF;

    -- Effective privileges must match too (no extra ones inherited via PUBLIC or role membership).
    IF has_table_privilege(v_hub, v_dir, 'DELETE') OR has_table_privilege(v_hub, v_dir, 'TRUNCATE')
       OR has_table_privilege(v_hub, v_dir, 'REFERENCES') OR has_table_privilege(v_hub, v_dir, 'TRIGGER')
       OR has_table_privilege(v_hub, v_ali, 'TRUNCATE') OR has_table_privilege(v_hub, v_ali, 'REFERENCES')
       OR has_table_privilege(v_hub, v_ali, 'TRIGGER') THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app has extra effective privileges beyond the post-UP state';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e
               WHERE a.attrelid IN (v_dir, v_ali) AND a.attacl IS NOT NULL AND e.grantee = v_hub) THEN
        RAISE EXCEPTION 'Rollback aborted: daubert_hub_app has column-level privileges on the target tables';
    END IF;
END
$rollback_guard$;

REVOKE SELECT, INSERT, UPDATE ON TABLE core.direcciones FROM daubert_hub_app;

REVOKE UPDATE ON TABLE core.alias_empresa FROM daubert_hub_app;

DO $rollback_verify$
DECLARE
    v_hub oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app');
    v_dir oid := to_regclass('core.direcciones');
    v_ali oid := to_regclass('core.alias_empresa');
    v_dir_direct text;
    v_ali_direct text;
BEGIN
    SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '')
    INTO v_dir_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_dir AND e.grantee = v_hub;

    SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '')
    INTO v_ali_direct
    FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e
    WHERE c.oid = v_ali AND e.grantee = v_hub;

    -- A REVOKE issued by a role that is not the grantor only warns; fail loudly instead.
    IF v_dir_direct <> '' OR has_table_privilege(v_hub, v_dir, 'SELECT') OR has_table_privilege(v_hub, v_dir, 'INSERT')
       OR has_table_privilege(v_hub, v_dir, 'UPDATE') OR has_table_privilege(v_hub, v_dir, 'DELETE') THEN
        RAISE EXCEPTION 'REVOKE verification failed on core.direcciones: hub direct grants are (%)', v_dir_direct;
    END IF;
    IF v_ali_direct <> 'DELETE,INSERT,SELECT'
       OR has_table_privilege(v_hub, v_ali, 'UPDATE')
       OR NOT (has_table_privilege(v_hub, v_ali, 'SELECT') AND has_table_privilege(v_hub, v_ali, 'INSERT')
               AND has_table_privilege(v_hub, v_ali, 'DELETE')) THEN
        RAISE EXCEPTION 'REVOKE verification failed on core.alias_empresa: hub direct grants are (%)', v_ali_direct;
    END IF;
END
$rollback_verify$;

COMMIT;
