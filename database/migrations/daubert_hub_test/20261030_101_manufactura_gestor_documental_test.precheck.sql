-- =====================================================================================================================
-- PRECHECK · manufactura · gestor documental de Hojas de Instrucción (SOLO TEST: daubert_hub_test)
-- SOLO LECTURA: BEGIN TRANSACTION READ ONLY ... ROLLBACK. No crea ni modifica nada.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_test_user):
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
--        -f 20261030_101_manufactura_gestor_documental_test.precheck.sql
--
-- Resultado esperado: todas las comprobaciones en true y ALL_PRECHECKS_PASS = true.
-- Anote la LÍNEA BASE del bloque final: el postcheck la recibe con -v para comprobar que NADA MÁS cambió.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;

-- 0. Destino: este script solo corre en daubert_hub_test. Se aborta ANTES de cualquier otra comprobación.
DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION 'ABORTO: este precheck es solo para daubert_hub_test (base actual: %).', current_database();
  END IF;
  IF current_database() = 'daubert_global' THEN
    RAISE EXCEPTION 'ABORTO: daubert_global es PRODUCCION.';
  END IF;
END $$;

SELECT
  current_database()                                                             AS base_actual,
  current_user                                                                   AS rol_actual,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                   AS rol_es_administrador,
  current_setting('server_version_num')::int >= 150000                           AS version_pg_15_o_mayor,
  current_database() = 'daubert_hub_test'                                        AS base_es_test,
  -- el rol de la aplicación existe, no es superusuario y NO es el rol de producción
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND rolcanlogin) AS rol_app_test_existe_y_sin_privilegios,
  -- objetos de los que dependen las tablas nuevas
  to_regclass('security.users')                  IS NOT NULL                     AS existe_security_users,
  to_regclass('core.empresas')                   IS NOT NULL                     AS existe_core_empresas,
  to_regclass('audit.cambios')                   IS NOT NULL                     AS existe_audit_cambios,
  to_regproc('audit.fn_registrar_cambio')        IS NOT NULL                     AS existe_fn_auditoria,
  -- el delta NO existe todavía (no se reaplica)
  NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura')          AS esquema_manufactura_no_existe,
  -- la aplicación NO tiene (ni debe tener) DDL
  NOT has_database_privilege('daubert_hub_test_user', current_database(), 'CREATE') AS app_sin_create_en_base,
  NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND has_schema_privilege('daubert_hub_test_user', n.nspname, 'CREATE')) AS app_sin_create_en_esquemas,
  -- Hay al menos un usuario activo (la identidad de auditoría sale de security.users)
  (SELECT count(*) FROM security.users WHERE status = 'ACTIVE') > 0              AS hay_usuarios_activos;

-- Comprobación consolidada.
WITH c AS (
  SELECT
    current_database() = 'daubert_hub_test'                                                         AS a,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                    AS b,
    current_setting('server_version_num')::int >= 150000                                            AS c1,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND rolcanlogin) AS d,
    to_regclass('security.users') IS NOT NULL AND to_regclass('core.empresas') IS NOT NULL AND to_regclass('audit.cambios') IS NOT NULL AND to_regproc('audit.fn_registrar_cambio') IS NOT NULL AS e,
    NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura')                           AS f,
    NOT has_database_privilege('daubert_hub_test_user', current_database(), 'CREATE')               AS g,
    (SELECT count(*) FROM security.users WHERE status = 'ACTIVE') > 0                               AS h
)
SELECT (a AND b AND c1 AND d AND e AND f AND g AND h) AS all_prechecks_pass FROM c;

-- LÍNEA BASE (pásela al postcheck con -v). Describe TODO lo que NO debe cambiar.
SELECT
  (SELECT count(*) FROM security.users)                                                              AS baseline_users,
  (SELECT count(*) FROM core.empresas)                                                               AS baseline_empresas,
  (SELECT count(*) FROM audit.cambios)                                                               AS baseline_audit_cambios,
  (SELECT md5(string_agg(table_schema || '.' || table_name, ',' ORDER BY table_schema, table_name))
     FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema'))  AS baseline_tablas_fp,
  (SELECT md5(string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)), ',' ORDER BY p.oid::regprocedure::text))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('audit', 'core', 'security', 'ops', 'operacion')) AS baseline_funciones_fp;

ROLLBACK;
