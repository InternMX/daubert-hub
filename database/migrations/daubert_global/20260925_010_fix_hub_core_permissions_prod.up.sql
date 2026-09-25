-- PRODUCTION-READY TEMPLATE - DO NOT APPLY TO daubert_global YET.
-- Fix: Hub (role daubert_hub_app) is missing table privileges in PROD core schema.
--
-- Confirmed PROD ACL before this migration:
--   core.direcciones   : SELECT/INSERT/UPDATE/DELETE = false
--   core.alias_empresa : SELECT/INSERT/DELETE = true, UPDATE = false
--
-- Grants applied here (and nothing else):
--   GRANT SELECT, INSERT, UPDATE ON TABLE core.direcciones   TO daubert_hub_app;
--   GRANT UPDATE                 ON TABLE core.alias_empresa TO daubert_hub_app;
--
-- Why exactly these:
--   * core.direcciones: list = SELECT; create = UPDATE (demote previous es_principal) + INSERT ... RETURNING;
--     patch/deactivate/reactivate = SELECT ... FOR UPDATE + UPDATE. Deactivation is logical: NO DELETE.
--   * core.alias_empresa: replaceCompanyAliases does SELECT ... FOR UPDATE (needs UPDATE), DELETE and INSERT.
--     SELECT/INSERT/DELETE were already granted by 20260828_001; only UPDATE is missing.
--   * direccion_id is GENERATED ALWAYS AS IDENTITY and alias_id is an identity column: INSERT does not
--     need any privilege on the identity sequences. Unlike the historical 20260902_002, NO sequence
--     USAGE/SELECT/UPDATE is granted.
--
-- Deliberately NOT granted: DELETE on core.direcciones, TRUNCATE, REFERENCES, TRIGGER, CREATE,
-- any sequence privilege, WITH GRANT OPTION. No ownership, default-privilege, n8n_app,
-- daubert_docs_ro or TEST-role changes.
--
-- Safety: runs only on daubert_global; aborts if the hub ACL is not exactly the state the precheck
-- expects (someone changed permissions since the precheck); verifies the result inside the same
-- transaction (a GRANT by a role without grant option only raises a WARNING, so it is re-checked)
-- and that no other ACL/owner/default-privilege changed. Any failure rolls the whole thing back.
--
-- Suggested order: run 20260925_010_fix_hub_core_permissions_prod.precheck.sql (read-only) and record
-- its baseline values, apply this file, then run ..._prod.postcheck.sql (read-only).
-- Rollback: 20260925_010_fix_hub_core_permissions_prod.down.sql.
BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $migration_guard$
DECLARE
    v_hub oid;
    v_dir oid := to_regclass('core.direcciones');
    v_ali oid := to_regclass('core.alias_empresa');
    v_dir_direct text;
    v_ali_direct text;
    v_others_fp text;
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION
            'Migration 20260925_010 is restricted to daubert_global; current database is %',
            current_database();
    END IF;

    SELECT oid INTO v_hub FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app';
    IF v_hub IS NULL THEN
        RAISE EXCEPTION 'Required role daubert_hub_app does not exist';
    END IF;
    IF v_dir IS NULL THEN
        RAISE EXCEPTION 'Required table core.direcciones does not exist';
    END IF;
    IF v_ali IS NULL THEN
        RAISE EXCEPTION 'Required table core.alias_empresa does not exist';
    END IF;

    -- Identity columns: no sequence privileges are needed (and none are granted).
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                   WHERE attrelid = v_dir AND attname = 'direccion_id' AND attidentity = 'a') THEN
        RAISE EXCEPTION 'core.direcciones.direccion_id is not GENERATED ALWAYS AS IDENTITY; review before granting';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                   WHERE attrelid = v_ali AND attname = 'alias_id' AND attidentity IN ('a', 'd')) THEN
        RAISE EXCEPTION 'core.alias_empresa.alias_id is not an identity column; review before granting';
    END IF;

    -- Exact expected ACL of daubert_hub_app (direct grants, none grantable).
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

    IF v_dir_direct <> '' THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app already has direct grants on core.direcciones (%); expected none. Re-run the precheck.', v_dir_direct;
    END IF;
    IF v_ali_direct <> 'DELETE,INSERT,SELECT' THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app direct grants on core.alias_empresa are (%); expected DELETE,INSERT,SELECT. Re-run the precheck.', v_ali_direct;
    END IF;

    -- Effective privileges (also catches grants inherited via PUBLIC or role membership).
    IF has_table_privilege(v_hub, v_dir, 'SELECT') OR has_table_privilege(v_hub, v_dir, 'INSERT')
       OR has_table_privilege(v_hub, v_dir, 'UPDATE') OR has_table_privilege(v_hub, v_dir, 'DELETE')
       OR has_table_privilege(v_hub, v_dir, 'TRUNCATE') OR has_table_privilege(v_hub, v_dir, 'REFERENCES')
       OR has_table_privilege(v_hub, v_dir, 'TRIGGER') THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app has effective privileges on core.direcciones; expected none';
    END IF;
    IF NOT (has_table_privilege(v_hub, v_ali, 'SELECT') AND has_table_privilege(v_hub, v_ali, 'INSERT')
            AND has_table_privilege(v_hub, v_ali, 'DELETE'))
       OR has_table_privilege(v_hub, v_ali, 'UPDATE') OR has_table_privilege(v_hub, v_ali, 'TRUNCATE')
       OR has_table_privilege(v_hub, v_ali, 'REFERENCES') OR has_table_privilege(v_hub, v_ali, 'TRIGGER') THEN
        RAISE EXCEPTION 'ACL drift: effective privileges of daubert_hub_app on core.alias_empresa differ from SELECT/INSERT/DELETE';
    END IF;

    -- Column-level privileges for the hub role would change the interpretation.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e
               WHERE a.attrelid IN (v_dir, v_ali) AND a.attacl IS NOT NULL AND e.grantee = v_hub) THEN
        RAISE EXCEPTION 'ACL drift: daubert_hub_app has column-level privileges on core.direcciones/core.alias_empresa';
    END IF;

    -- Snapshot of everything 010 must NOT change (see precheck section 10, baseline_others_fp).
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
          AND NOT (c.oid IN (v_dir, v_ali) AND a.grantee = v_hub)
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

    PERFORM set_config('mig010.others_fp', v_others_fp, true);
END
$migration_guard$;

GRANT SELECT, INSERT, UPDATE ON TABLE core.direcciones TO daubert_hub_app;

GRANT UPDATE ON TABLE core.alias_empresa TO daubert_hub_app;

DO $migration_verify$
DECLARE
    v_hub oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app');
    v_dir oid := to_regclass('core.direcciones');
    v_ali oid := to_regclass('core.alias_empresa');
    v_dir_direct text;
    v_ali_direct text;
    v_others_fp text;
BEGIN
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

    -- A GRANT issued by a role without grant option only warns; fail loudly instead.
    IF v_dir_direct <> 'INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'GRANT verification failed on core.direcciones: hub direct grants are (%)', v_dir_direct;
    END IF;
    IF v_ali_direct <> 'DELETE,INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'GRANT verification failed on core.alias_empresa: hub direct grants are (%)', v_ali_direct;
    END IF;
    IF has_table_privilege(v_hub, v_dir, 'DELETE') OR has_table_privilege(v_hub, v_dir, 'TRUNCATE')
       OR has_table_privilege(v_hub, v_dir, 'REFERENCES') OR has_table_privilege(v_hub, v_dir, 'TRIGGER')
       OR has_table_privilege(v_hub, v_ali, 'TRUNCATE') OR has_table_privilege(v_hub, v_ali, 'REFERENCES')
       OR has_table_privilege(v_hub, v_ali, 'TRIGGER') THEN
        RAISE EXCEPTION 'GRANT verification failed: hub gained a privilege that 010 must not grant';
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
          AND NOT (c.oid IN (v_dir, v_ali) AND a.grantee = v_hub)
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

    IF v_others_fp IS DISTINCT FROM current_setting('mig010.others_fp', true) THEN
        RAISE EXCEPTION 'Verification failed: an ACL/owner/default privilege other than the two hub grants changed';
    END IF;
END
$migration_verify$;

COMMIT;
