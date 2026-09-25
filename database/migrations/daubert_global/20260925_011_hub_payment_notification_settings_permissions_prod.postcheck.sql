-- READ-ONLY post-migration checks for 20260925_011_hub_payment_notification_settings_permissions_prod.up.sql.
-- Run with psql against daubert_global AFTER applying the up migration. Changes nothing:
-- it runs inside BEGIN TRANSACTION READ ONLY and always ends with ROLLBACK.
-- Pass the value recorded from the precheck (section 7):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w ^
--     -v baseline_others_fp=<md5> ^
--     -f 20260925_011_hub_payment_notification_settings_permissions_prod.postcheck.sql
-- Expected: ALL_CHECKS_PASS = PASS and every check PASS.
\set ON_ERROR_STOP on
\pset pager off

\if :{?baseline_others_fp}
\else
    \echo 'ERROR: missing -v baseline_others_fp=... (record it from the precheck, section 7)'
    \quit
\endif

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION 'Postcheck 011 is restricted to daubert_global; current database is %', current_database();
    END IF;
END
$guard$;

\echo '== 1. Target database =='
SELECT current_database() AS db,
       current_database() = 'daubert_global' AS ok_database,
       current_setting('transaction_read_only') AS transaction_read_only;

\echo '== 2. relacl of the table (informational) =='
SELECT n.nspname || '.' || c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       COALESCE(c.relacl::text, '(default)') AS relacl
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass('core.empresas_notificacion_pago');

\echo '== 3. Effective privileges of daubert_hub_app on the table =='
SELECT
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'SELECT') AS sel,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'INSERT') AS ins,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'UPDATE') AS upd,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'DELETE') AS del,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'TRUNCATE') AS trunc,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'REFERENCES') AS refs,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'TRIGGER') AS trig;
-- Expected: sel=t ins=t upd=t del=f trunc=f refs=f trig=f

\echo '== 4. SUMMARY (every check must be PASS) =='
WITH hub AS (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app'
), tbl AS (
    SELECT to_regclass('core.empresas_notificacion_pago') AS oid
), current_values AS (
    SELECT
    (SELECT md5(COALESCE(string_agg(entry_text, E'\n' ORDER BY entry_text), ''))
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
               AND NOT (c.oid = to_regclass('core.empresas_notificacion_pago')
                        AND a.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app'))
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
         ) AS fp_rows) AS others_fp
), checks(ord, name, ok) AS (
    SELECT 1, 'database is daubert_global', current_database() = 'daubert_global'
    UNION ALL SELECT 2, 'SELECT=true',    has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'SELECT')
    UNION ALL SELECT 3, 'INSERT=true',    has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'INSERT')
    UNION ALL SELECT 4, 'UPDATE=true',    has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'UPDATE')
    UNION ALL SELECT 5, 'DELETE=false',   NOT has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'DELETE')
    UNION ALL SELECT 6, 'TRUNCATE=false', NOT has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'TRUNCATE')
    UNION ALL SELECT 7, 'no REFERENCES/TRIGGER for hub',
        NOT (has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'REFERENCES')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'TRIGGER'))
    UNION ALL SELECT 8, 'direct grants for hub = INSERT,SELECT,UPDATE (not grantable)',
        (SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '') = 'INSERT,SELECT,UPDATE'
                AND NOT COALESCE(bool_or(e.is_grantable), false)
         FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e, hub
         WHERE c.oid = (SELECT oid FROM tbl) AND e.grantee = hub.oid)
    UNION ALL SELECT 9, 'no column-level privileges for hub on the table',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e, hub, tbl
                    WHERE a.attrelid = tbl.oid AND a.attacl IS NOT NULL AND e.grantee = hub.oid)
    UNION ALL SELECT 10, 'no sequence privileges added; n8n_app, daubert_docs_ro, TEST roles, schema core (CREATE), default privileges and owners unchanged',
        (SELECT others_fp = :'baseline_others_fp' FROM current_values)
)
SELECT name, result
FROM (
    SELECT ord, name, CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
    UNION ALL
    SELECT 999, 'ALL_CHECKS_PASS', CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END FROM checks
) AS summary
ORDER BY ord;

ROLLBACK;
