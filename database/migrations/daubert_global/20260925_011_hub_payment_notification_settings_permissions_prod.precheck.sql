-- READ-ONLY pre-migration checks for 20260925_011_hub_payment_notification_settings_permissions_prod.up.sql.
-- Run with psql against daubert_global BEFORE applying the up migration. Changes nothing:
-- it runs inside BEGIN TRANSACTION READ ONLY and always ends with ROLLBACK.
-- Expected: section 6 returns ALL_CHECKS_PASS = PASS, and you RECORD the section 7 baseline values -
-- they are passed to the postcheck script with psql -v.
--
-- Context: the Hub role daubert_hub_app must gain SELECT, INSERT, UPDATE on core.empresas_notificacion_pago
-- (never DELETE, never ALL, no sequence - the table has no identity column) and nothing else.
-- The checks below also confirm the privileges the rest of this Hub feature already relies on
-- (core.empresas, core.contactos, core.medios_contacto), so a missing prerequisite is visible BEFORE deploy.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION 'Precheck 011 is restricted to daubert_global; current database is %', current_database();
    END IF;
END
$guard$;

\echo '== 1. Target database (ok_database must be true) =='
SELECT current_database() AS db,
       current_database() = 'daubert_global' AS ok_database,
       current_setting('transaction_read_only') AS transaction_read_only;

\echo '== 2. Required role/objects (all must be true) =='
SELECT
    EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app') AS hub_role_exists,
    to_regclass('core.empresas_notificacion_pago') IS NOT NULL AS settings_table_exists,
    to_regclass('core.vw_catalogo_notificacion_pago_n8n') IS NOT NULL AS n8n_catalog_view_exists;

\echo '== 3. relacl of the table (informational, RECORD) =='
SELECT n.nspname || '.' || c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       COALESCE(c.relacl::text, '(default)') AS relacl
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass('core.empresas_notificacion_pago');

\echo '== 4. Effective privileges of daubert_hub_app on the table (all must be false before the UP) =='
SELECT
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'SELECT') AS sel,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'INSERT') AS ins,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'UPDATE') AS upd,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'DELETE') AS del,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'TRUNCATE') AS trunc,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'REFERENCES') AS refs,
    has_table_privilege('daubert_hub_app', 'core.empresas_notificacion_pago', 'TRIGGER') AS trig,
    (SELECT COALESCE(string_agg(entry.privilege_type || CASE WHEN entry.is_grantable THEN '*' ELSE '' END,
                                ',' ORDER BY entry.privilege_type), '(none)')
     FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS entry
     WHERE c.oid = to_regclass('core.empresas_notificacion_pago')
       AND entry.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app')) AS direct_grants;

\echo '== 5. Other roles - current privileges on the table (informational; 011 must not change them) =='
SELECT r.rolname,
       has_table_privilege(r.oid, 'core.empresas_notificacion_pago', 'SELECT') AS sel,
       has_table_privilege(r.oid, 'core.empresas_notificacion_pago', 'INSERT') AS ins,
       has_table_privilege(r.oid, 'core.empresas_notificacion_pago', 'UPDATE') AS upd,
       has_table_privilege(r.oid, 'core.empresas_notificacion_pago', 'DELETE') AS del
FROM pg_catalog.pg_roles AS r
WHERE r.rolname IN ('n8n_app', 'daubert_docs_ro') OR r.rolname ILIKE '%test%'
ORDER BY r.rolname;

\echo '== 6. SUMMARY (every check must be PASS) =='
WITH hub AS (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app'
), tbl AS (
    SELECT to_regclass('core.empresas_notificacion_pago') AS oid
), checks(ord, name, ok) AS (
    SELECT 1, 'database is daubert_global', current_database() = 'daubert_global'
    UNION ALL SELECT 2, 'role daubert_hub_app exists', EXISTS (SELECT 1 FROM hub)
    UNION ALL SELECT 3, 'core.empresas_notificacion_pago exists', (SELECT oid IS NOT NULL FROM tbl)
    UNION ALL SELECT 4, 'hub has NO effective privilege on the table yet (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER)',
        NOT (has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'SELECT')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'INSERT')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'UPDATE')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'DELETE')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'TRUNCATE')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'REFERENCES')
             OR has_table_privilege('daubert_hub_app', (SELECT oid FROM tbl), 'TRIGGER'))
    UNION ALL SELECT 5, 'hub has no direct grant on the table',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e, hub WHERE c.oid = (SELECT oid FROM tbl) AND e.grantee = hub.oid)
    UNION ALL SELECT 6, 'no column-level privileges for hub on the table',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e, hub, tbl
                    WHERE a.attrelid = tbl.oid AND a.attacl IS NOT NULL AND e.grantee = hub.oid)
    UNION ALL SELECT 7, 'table has no identity column (no sequence privilege needed)',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, tbl WHERE a.attrelid = tbl.oid AND a.attnum > 0 AND a.attidentity <> ''::"char")
    UNION ALL SELECT 8, 'prerequisite: hub SELECT/INSERT/UPDATE on core.empresas (ruta_dropbox is written column-wise)',
        has_table_privilege('daubert_hub_app', 'core.empresas', 'SELECT')
        AND has_column_privilege('daubert_hub_app', 'core.empresas', 'ruta_dropbox', 'INSERT')
        AND has_column_privilege('daubert_hub_app', 'core.empresas', 'ruta_dropbox', 'UPDATE')
    UNION ALL SELECT 9, 'prerequisite: hub SELECT on core.contactos (readiness)', has_table_privilege('daubert_hub_app', 'core.contactos', 'SELECT')
    UNION ALL SELECT 10, 'prerequisite: hub SELECT/INSERT/UPDATE on core.medios_contacto (payment flags, primary demotion)',
        has_table_privilege('daubert_hub_app', 'core.medios_contacto', 'SELECT')
        AND has_table_privilege('daubert_hub_app', 'core.medios_contacto', 'INSERT')
        AND has_table_privilege('daubert_hub_app', 'core.medios_contacto', 'UPDATE')
    UNION ALL SELECT 11, 'n8n_app can still read the n8n catalog view (011 does not touch it)',
        COALESCE(has_table_privilege('n8n_app', 'core.vw_catalogo_notificacion_pago_n8n', 'SELECT'), FALSE)
)
SELECT name, result
FROM (
    SELECT ord, name, CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
    UNION ALL
    SELECT 999, 'ALL_CHECKS_PASS', CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END FROM checks
) AS summary
ORDER BY ord;

\echo '== 7. BASELINE value - RECORD THIS and pass it to the postcheck with psql -v =='
-- baseline_others_fp: owners + normalized ACLs of every non-system relation (tables, views, sequences),
-- column ACLs, schema ACLs and default privileges, EXCLUDING only the daubert_hub_app entries on the
-- table 011 changes. Any change to n8n_app, daubert_docs_ro, TEST roles, sequences, schemas or default
-- privileges changes this value.
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
     ) AS fp_rows) AS baseline_others_fp;

ROLLBACK;
