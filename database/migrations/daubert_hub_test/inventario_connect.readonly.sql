-- =====================================================================================================================
-- INVENTARIO DE PERMISOS CONNECT (SOLO LECTURA) — previo a cualquier endurecimiento. NO cambia nada.
-- Autorizado únicamente como inventario: no ejecuta GRANT, REVOKE ni ALTER.
--
--   psql -h localhost -p 5432 -d postgres -U postgres -X -w -v ON_ERROR_STOP=1 -f inventario_connect.readonly.sql > inventario_connect.txt
-- (Con el rol administrativo se ven las conexiones de todos los roles y las reglas de pg_hba.conf; con un rol sin privilegios se ve solo lo propio.)
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;

\echo '== 1. ACL de cada base (c = CONNECT, T = TEMPORARY, C = CREATE). "=Tc/..." = PUBLIC puede conectarse.'
SELECT datname, pg_get_userbyid(datdba) AS dueno, datacl::text AS acl FROM pg_database WHERE NOT datistemplate ORDER BY datname;

\echo '== 2. Roles con login y atributos'
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit, rolvaliduntil FROM pg_roles WHERE rolcanlogin AND rolname !~ '^pg_' ORDER BY rolname;

\echo '== 3. ¿Quién PUEDE conectarse a qué base? (por herencia de PUBLIC o concesión explícita)'
SELECT d.datname, r.rolname, has_database_privilege(r.rolname, d.datname, 'CONNECT') AS puede_conectar,
       (d.datacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT')) AS por_public,
       EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = r.oid AND a.privilege_type = 'CONNECT') AS concesion_explicita
FROM pg_database d CROSS JOIN pg_roles r
WHERE NOT d.datistemplate AND r.rolcanlogin AND r.rolname !~ '^pg_' AND NOT r.rolsuper
ORDER BY d.datname, r.rolname;

\echo '== 4. Configuración por rol y base (límites, timeouts, solo lectura)'
SELECT COALESCE((SELECT rolname FROM pg_roles WHERE oid = setrole), '*') AS rol, COALESCE((SELECT datname FROM pg_database WHERE oid = setdatabase), '*') AS base, setconfig::text FROM pg_db_role_setting ORDER BY 1, 2;

\echo '== 5. Conexiones actuales por rol y base (solo conteos; sin consultas ni direcciones)'
SELECT datname, usename, count(*) AS conexiones, max(backend_start) AS ultima_conexion FROM pg_stat_activity WHERE datname IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== 6. Reglas de pg_hba.conf (requiere superusuario; confirme si ya existe alguna regla reject)'
SELECT line_number, type, database, user_name, address, auth_method FROM pg_hba_file_rules ORDER BY line_number;

\echo '== 7. Dependencias a validar ANTES de revocar CONNECT a PUBLIC (roles que hoy entran solo por PUBLIC)'
SELECT d.datname, r.rolname AS rol_que_depende_de_public
FROM pg_database d CROSS JOIN pg_roles r
WHERE NOT d.datistemplate AND r.rolcanlogin AND r.rolname !~ '^pg_' AND NOT r.rolsuper
  AND d.datname IN ('daubert_global', 'daubert_hub_test', 'daubert_global_restore_test')
  AND (d.datacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT'))
  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = r.oid AND a.privilege_type = 'CONNECT')
ORDER BY d.datname, r.rolname;

ROLLBACK;
