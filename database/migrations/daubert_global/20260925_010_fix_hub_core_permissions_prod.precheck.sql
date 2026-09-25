-- READ-ONLY pre-migration checks for 20260925_010_fix_hub_core_permissions_prod.up.sql.
-- Run with psql against daubert_global BEFORE applying the up migration. Changes nothing:
-- it runs inside BEGIN TRANSACTION READ ONLY and always ends with ROLLBACK.
-- Expected: section 9 returns ALL_CHECKS_PASS = true, and you RECORD the section 10 baseline
-- values - they are passed to the postcheck script with psql -v.
--
-- Context (Hub PROD, role daubert_hub_app):
--   core.direcciones   : SELECT/INSERT/UPDATE/DELETE all false  -> 010 grants SELECT, INSERT, UPDATE
--   core.alias_empresa : SELECT/INSERT/DELETE true, UPDATE false -> 010 grants UPDATE
--     (UPDATE is required because replaceCompanyAliases runs SELECT ... FOR UPDATE.)
-- Identity columns (direccion_id GENERATED ALWAYS, alias_id identity) need NO sequence privileges.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- Hard guard: abort the whole script (ON_ERROR_STOP) when not on daubert_global.
DO $guard$
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION 'Precheck 010 is restricted to daubert_global; current database is %', current_database();
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
    to_regclass('core.direcciones') IS NOT NULL AS direcciones_exists,
    to_regclass('core.alias_empresa') IS NOT NULL AS alias_empresa_exists,
    (SELECT count(*) FROM pg_catalog.pg_trigger
     WHERE tgrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
       AND NOT tgisinternal) AS non_internal_trigger_count;

\echo '== 3. relacl of both tables (informational, RECORD) =='
SELECT n.nspname || '.' || c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       COALESCE(c.relacl::text, '(default)') AS relacl
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.oid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
ORDER BY 1;

\echo '== 4. Effective privileges of daubert_hub_app (expected states) =='
SELECT
    tbl.name,
    has_table_privilege('daubert_hub_app', tbl.oid, 'SELECT') AS sel,
    has_table_privilege('daubert_hub_app', tbl.oid, 'INSERT') AS ins,
    has_table_privilege('daubert_hub_app', tbl.oid, 'UPDATE') AS upd,
    has_table_privilege('daubert_hub_app', tbl.oid, 'DELETE') AS del,
    has_table_privilege('daubert_hub_app', tbl.oid, 'TRUNCATE') AS trunc,
    has_table_privilege('daubert_hub_app', tbl.oid, 'REFERENCES') AS refs,
    has_table_privilege('daubert_hub_app', tbl.oid, 'TRIGGER') AS trig,
    (SELECT COALESCE(string_agg(entry.privilege_type || CASE WHEN entry.is_grantable THEN '*' ELSE '' END,
                                ',' ORDER BY entry.privilege_type), '(none)')
     FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS entry
     WHERE c.oid = tbl.oid
       AND entry.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app')) AS direct_grants
FROM (VALUES ('core.direcciones', to_regclass('core.direcciones')),
             ('core.alias_empresa', to_regclass('core.alias_empresa'))) AS tbl(name, oid)
ORDER BY 1;
-- Expected: direcciones  sel=f ins=f upd=f del=f, direct_grants (none)
--           alias_empresa sel=t ins=t upd=f del=t, direct_grants DELETE,INSERT,SELECT
--           trunc/refs/trig = f on both.

\echo '== 5. Column-level privileges for daubert_hub_app on both tables (must return 0 rows) =='
SELECT c.relname, a.attname, a.attacl
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
WHERE a.attrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
  AND a.attacl IS NOT NULL
  AND EXISTS (SELECT 1 FROM aclexplode(a.attacl) AS entry
              WHERE entry.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app'));

\echo '== 6. Identity columns and their sequences (no sequence grant is needed) =='
SELECT c.relname, a.attname,
       a.attidentity AS identity_kind,   -- a = ALWAYS, d = BY DEFAULT
       pg_get_serial_sequence(n.nspname || '.' || c.relname, a.attname) AS sequence_name,
       COALESCE((SELECT s.relacl::text FROM pg_catalog.pg_class AS s
                 WHERE s.oid = to_regclass(pg_get_serial_sequence(n.nspname || '.' || c.relname, a.attname))),
                '(default)') AS sequence_acl
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE (c.oid = to_regclass('core.direcciones') AND a.attname = 'direccion_id')
   OR (c.oid = to_regclass('core.alias_empresa') AND a.attname = 'alias_id')
ORDER BY 1;

\echo '== 7. Audit/other triggers on both tables (informational, RECORD) =='
SELECT c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
WHERE t.tgrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

\echo '== 8. Other roles - current privileges on both tables (informational; 010 must not change them) =='
SELECT r.rolname, tbl.name,
       has_table_privilege(r.oid, tbl.oid, 'SELECT') AS sel,
       has_table_privilege(r.oid, tbl.oid, 'INSERT') AS ins,
       has_table_privilege(r.oid, tbl.oid, 'UPDATE') AS upd,
       has_table_privilege(r.oid, tbl.oid, 'DELETE') AS del
FROM pg_catalog.pg_roles AS r
CROSS JOIN (VALUES ('core.direcciones', to_regclass('core.direcciones')),
                   ('core.alias_empresa', to_regclass('core.alias_empresa'))) AS tbl(name, oid)
WHERE r.rolname IN ('n8n_app', 'daubert_docs_ro') OR r.rolname ILIKE '%test%'
ORDER BY r.rolname, tbl.name;

\echo '== 9. SUMMARY (every check must be PASS) =='
WITH hub AS (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app'
), tbl AS (
    SELECT to_regclass('core.direcciones') AS dir, to_regclass('core.alias_empresa') AS ali
), checks(ord, name, ok) AS (
    SELECT 1, 'database is daubert_global', current_database() = 'daubert_global'
    UNION ALL SELECT 2, 'role daubert_hub_app exists', EXISTS (SELECT 1 FROM hub)
    UNION ALL SELECT 3, 'core.direcciones exists', (SELECT dir IS NOT NULL FROM tbl)
    UNION ALL SELECT 4, 'core.alias_empresa exists', (SELECT ali IS NOT NULL FROM tbl)
    UNION ALL SELECT 5, 'audit triggers present on both tables',
        (SELECT count(DISTINCT t.tgrelid) = 2 FROM pg_catalog.pg_trigger AS t, tbl
         WHERE t.tgrelid IN (tbl.dir, tbl.ali) AND NOT t.tgisinternal)
    UNION ALL SELECT 6, 'direcciones SELECT=false',   NOT has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'SELECT')
    UNION ALL SELECT 7, 'direcciones INSERT=false',   NOT has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'INSERT')
    UNION ALL SELECT 8, 'direcciones UPDATE=false',   NOT has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'UPDATE')
    UNION ALL SELECT 9, 'direcciones DELETE=false',   NOT has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'DELETE')
    UNION ALL SELECT 10, 'alias_empresa SELECT=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'SELECT')
    UNION ALL SELECT 11, 'alias_empresa INSERT=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'INSERT')
    UNION ALL SELECT 12, 'alias_empresa UPDATE=false', NOT has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'UPDATE')
    UNION ALL SELECT 13, 'alias_empresa DELETE=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'DELETE')
    UNION ALL SELECT 14, 'TRUNCATE/REFERENCES/TRIGGER false on both',
        NOT (has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'TRUNCATE')
             OR has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'REFERENCES')
             OR has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'TRIGGER')
             OR has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'TRUNCATE')
             OR has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'REFERENCES')
             OR has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'TRIGGER'))
    UNION ALL SELECT 15, 'direcciones direct grants for hub = none',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e, hub
                    WHERE c.oid = (SELECT dir FROM tbl) AND e.grantee = hub.oid)
    UNION ALL SELECT 16, 'alias_empresa direct grants for hub = DELETE,INSERT,SELECT (not grantable)',
        (SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '') = 'DELETE,INSERT,SELECT'
                AND NOT COALESCE(bool_or(e.is_grantable), false)
         FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e, hub
         WHERE c.oid = (SELECT ali FROM tbl) AND e.grantee = hub.oid)
    UNION ALL SELECT 17, 'no column-level privileges for hub on either table',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e, hub, tbl
                    WHERE a.attrelid IN (tbl.dir, tbl.ali) AND a.attacl IS NOT NULL AND e.grantee = hub.oid)
    UNION ALL SELECT 18, 'direccion_id is GENERATED ALWAYS AS IDENTITY',
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, tbl
                WHERE a.attrelid = tbl.dir AND a.attname = 'direccion_id' AND a.attidentity = 'a')
    UNION ALL SELECT 19, 'alias_id is an identity column',
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, tbl
                WHERE a.attrelid = tbl.ali AND a.attname = 'alias_id' AND a.attidentity IN ('a', 'd'))
    UNION ALL SELECT 20, 'no sequence grant needed (identity sequences resolved)',
        to_regclass(pg_get_serial_sequence('core.direcciones', 'direccion_id')) IS NOT NULL
        AND to_regclass(pg_get_serial_sequence('core.alias_empresa', 'alias_id')) IS NOT NULL
)
SELECT name, result
FROM (
    SELECT ord, name, CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
    UNION ALL
    SELECT 999, 'ALL_CHECKS_PASS', CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END FROM checks
) AS summary
ORDER BY ord;

\echo '== 10. BASELINE values - RECORD THESE and pass them to the postcheck with psql -v =='
-- baseline_others_fp: owners + normalized ACLs of every non-system relation (tables, views, sequences),
-- column ACLs, schema ACLs and default privileges, EXCLUDING only the daubert_hub_app entries on the two
-- tables 010 changes. Any change to n8n_app, daubert_docs_ro, TEST roles, sequences, schemas or default
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
           AND NOT (c.oid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
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
     ) AS fp_rows) AS baseline_others_fp,
    (SELECT md5(COALESCE(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid),
                                    E'\n' ORDER BY c.relname, t.tgname), ''))
     FROM pg_catalog.pg_trigger AS t
     JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
     WHERE t.tgrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
       AND NOT t.tgisinternal) AS baseline_triggers_fp,
    (SELECT md5(string_agg(c.relname || '.' || a.attname || ':' || a.attidentity::text || ':' || a.attgenerated::text,
                           ',' ORDER BY c.relname, a.attnum))
     FROM pg_catalog.pg_attribute AS a
     JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
     WHERE a.attrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
       AND a.attnum > 0 AND NOT a.attisdropped) AS baseline_identity_fp;

ROLLBACK;
