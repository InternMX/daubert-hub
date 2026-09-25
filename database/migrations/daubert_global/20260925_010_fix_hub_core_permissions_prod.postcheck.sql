-- READ-ONLY post-migration checks for 20260925_010_fix_hub_core_permissions_prod.up.sql.
-- Run with psql against daubert_global AFTER applying the up migration. Changes nothing:
-- it runs inside BEGIN TRANSACTION READ ONLY and always ends with ROLLBACK.
-- Pass the values recorded from the precheck (section 10):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w ^
--     -v baseline_others_fp=<md5> -v baseline_triggers_fp=<md5> -v baseline_identity_fp=<md5> ^
--     -f 20260925_010_fix_hub_core_permissions_prod.postcheck.sql
-- Expected: ALL_CHECKS_PASS = PASS in section 5 and every check PASS.
\set ON_ERROR_STOP on
\pset pager off

\if :{?baseline_others_fp}
\else
    \echo 'ERROR: missing -v baseline_others_fp=... (record it from the precheck, section 10)'
    \quit
\endif
\if :{?baseline_triggers_fp}
\else
    \echo 'ERROR: missing -v baseline_triggers_fp=... (record it from the precheck, section 10)'
    \quit
\endif
\if :{?baseline_identity_fp}
\else
    \echo 'ERROR: missing -v baseline_identity_fp=... (record it from the precheck, section 10)'
    \quit
\endif

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION 'Postcheck 010 is restricted to daubert_global; current database is %', current_database();
    END IF;
END
$guard$;

\echo '== 1. Target database =='
SELECT current_database() AS db,
       current_database() = 'daubert_global' AS ok_database,
       current_setting('transaction_read_only') AS transaction_read_only;

\echo '== 2. relacl of both tables (informational) =='
SELECT n.nspname || '.' || c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       COALESCE(c.relacl::text, '(default)') AS relacl
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.oid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
ORDER BY 1;

\echo '== 3. Effective privileges of daubert_hub_app =='
SELECT
    tbl.name,
    has_table_privilege('daubert_hub_app', tbl.oid, 'SELECT') AS sel,
    has_table_privilege('daubert_hub_app', tbl.oid, 'INSERT') AS ins,
    has_table_privilege('daubert_hub_app', tbl.oid, 'UPDATE') AS upd,
    has_table_privilege('daubert_hub_app', tbl.oid, 'DELETE') AS del,
    has_table_privilege('daubert_hub_app', tbl.oid, 'TRUNCATE') AS trunc,
    has_table_privilege('daubert_hub_app', tbl.oid, 'REFERENCES') AS refs,
    has_table_privilege('daubert_hub_app', tbl.oid, 'TRIGGER') AS trig
FROM (VALUES ('core.direcciones', to_regclass('core.direcciones')),
             ('core.alias_empresa', to_regclass('core.alias_empresa'))) AS tbl(name, oid)
ORDER BY 1;
-- Expected: direcciones   sel=t ins=t upd=t del=f trunc=f refs=f trig=f
--           alias_empresa sel=t ins=t upd=t del=t trunc=f refs=f trig=f

\echo '== 4. Informational: hub CREATE on schema core and hub privileges on the identity sequences =='
SELECT has_schema_privilege('daubert_hub_app', 'core', 'CREATE') AS hub_create_on_core,
       (SELECT COALESCE(string_agg(seq.name || '=' || seq.priv, ', '), '')
        FROM (SELECT 'direccion_id_seq' AS name,
                     CASE WHEN has_sequence_privilege('daubert_hub_app', s.oid, 'USAGE') THEN 'USAGE ' ELSE '' END ||
                     CASE WHEN has_sequence_privilege('daubert_hub_app', s.oid, 'SELECT') THEN 'SELECT ' ELSE '' END ||
                     CASE WHEN has_sequence_privilege('daubert_hub_app', s.oid, 'UPDATE') THEN 'UPDATE' ELSE '' END AS priv
              FROM (SELECT to_regclass(pg_get_serial_sequence('core.direcciones', 'direccion_id')) AS oid) AS s
              UNION ALL
              SELECT 'alias_id_seq',
                     CASE WHEN has_sequence_privilege('daubert_hub_app', s.oid, 'USAGE') THEN 'USAGE ' ELSE '' END ||
                     CASE WHEN has_sequence_privilege('daubert_hub_app', s.oid, 'SELECT') THEN 'SELECT ' ELSE '' END ||
                     CASE WHEN has_sequence_privilege('daubert_hub_app', s.oid, 'UPDATE') THEN 'UPDATE' ELSE '' END
              FROM (SELECT to_regclass(pg_get_serial_sequence('core.alias_empresa', 'alias_id')) AS oid) AS s) AS seq)
           AS hub_sequence_privileges;
-- The sequence ACLs themselves are covered by check 'no other ACL changed' below (baseline_others_fp).

\echo '== 5. SUMMARY (every check must be PASS) =='
WITH hub AS (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'daubert_hub_app'
), tbl AS (
    SELECT to_regclass('core.direcciones') AS dir, to_regclass('core.alias_empresa') AS ali
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
         ) AS fp_rows) AS others_fp,
        (SELECT md5(COALESCE(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid),
                                        E'\n' ORDER BY c.relname, t.tgname), ''))
         FROM pg_catalog.pg_trigger AS t
         JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
         WHERE t.tgrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
           AND NOT t.tgisinternal) AS triggers_fp,
        (SELECT md5(string_agg(c.relname || '.' || a.attname || ':' || a.attidentity::text || ':' || a.attgenerated::text,
                               ',' ORDER BY c.relname, a.attnum))
         FROM pg_catalog.pg_attribute AS a
         JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
         WHERE a.attrelid IN (to_regclass('core.direcciones'), to_regclass('core.alias_empresa'))
           AND a.attnum > 0 AND NOT a.attisdropped) AS identity_fp
), checks(ord, name, ok) AS (
    SELECT 1, 'database is daubert_global', current_database() = 'daubert_global'
    UNION ALL SELECT 2, 'direcciones SELECT=true',   has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'SELECT')
    UNION ALL SELECT 3, 'direcciones INSERT=true',   has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'INSERT')
    UNION ALL SELECT 4, 'direcciones UPDATE=true',   has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'UPDATE')
    UNION ALL SELECT 5, 'direcciones DELETE=false',  NOT has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'DELETE')
    UNION ALL SELECT 6, 'direcciones TRUNCATE=false', NOT has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'TRUNCATE')
    UNION ALL SELECT 7, 'alias_empresa SELECT=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'SELECT')
    UNION ALL SELECT 8, 'alias_empresa INSERT=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'INSERT')
    UNION ALL SELECT 9, 'alias_empresa UPDATE=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'UPDATE')
    UNION ALL SELECT 10, 'alias_empresa DELETE=true', has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'DELETE')
    UNION ALL SELECT 11, 'alias_empresa TRUNCATE=false', NOT has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'TRUNCATE')
    UNION ALL SELECT 12, 'no REFERENCES/TRIGGER for hub on either table',
        NOT (has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'REFERENCES')
             OR has_table_privilege('daubert_hub_app', (SELECT dir FROM tbl), 'TRIGGER')
             OR has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'REFERENCES')
             OR has_table_privilege('daubert_hub_app', (SELECT ali FROM tbl), 'TRIGGER'))
    UNION ALL SELECT 13, 'direcciones direct grants for hub = INSERT,SELECT,UPDATE (not grantable)',
        (SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '') = 'INSERT,SELECT,UPDATE'
                AND NOT COALESCE(bool_or(e.is_grantable), false)
         FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e, hub
         WHERE c.oid = (SELECT dir FROM tbl) AND e.grantee = hub.oid)
    UNION ALL SELECT 14, 'alias_empresa direct grants for hub = DELETE,INSERT,SELECT,UPDATE (not grantable)',
        (SELECT COALESCE(string_agg(e.privilege_type, ',' ORDER BY e.privilege_type), '') = 'DELETE,INSERT,SELECT,UPDATE'
                AND NOT COALESCE(bool_or(e.is_grantable), false)
         FROM pg_catalog.pg_class AS c, aclexplode(c.relacl) AS e, hub
         WHERE c.oid = (SELECT ali FROM tbl) AND e.grantee = hub.oid)
    UNION ALL SELECT 15, 'no column-level privileges for hub on either table',
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, aclexplode(a.attacl) AS e, hub, tbl
                    WHERE a.attrelid IN (tbl.dir, tbl.ali) AND a.attacl IS NOT NULL AND e.grantee = hub.oid)
    UNION ALL SELECT 16, 'no other ACL changed: n8n_app, daubert_docs_ro, TEST roles, sequences, schema core (CREATE), default privileges, owners',
        (SELECT others_fp = :'baseline_others_fp' FROM current_values)
    UNION ALL SELECT 17, 'identity columns unchanged',
        (SELECT identity_fp = :'baseline_identity_fp' FROM current_values)
    UNION ALL SELECT 18, 'direccion_id still GENERATED ALWAYS AS IDENTITY',
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a, tbl
                WHERE a.attrelid = tbl.dir AND a.attname = 'direccion_id' AND a.attidentity = 'a')
    UNION ALL SELECT 19, 'audit triggers still present and unchanged',
        (SELECT triggers_fp = :'baseline_triggers_fp' FROM current_values)
    UNION ALL SELECT 20, 'audit triggers present on both tables',
        (SELECT count(DISTINCT t.tgrelid) = 2 FROM pg_catalog.pg_trigger AS t, tbl
         WHERE t.tgrelid IN (tbl.dir, tbl.ali) AND NOT t.tgisinternal)
)
SELECT name, result
FROM (
    SELECT ord, name, CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
    UNION ALL
    SELECT 999, 'ALL_CHECKS_PASS', CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END FROM checks
) AS summary
ORDER BY ord;

ROLLBACK;
