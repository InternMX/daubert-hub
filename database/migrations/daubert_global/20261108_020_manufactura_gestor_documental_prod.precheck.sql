-- GENERADO desde TEST 101 (20261030_101_manufactura_gestor_documental_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 020. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- PRECHECK · manufactura · gestor documental de Hojas de Instrucción (SOLO PRODUCCIÓN: daubert_global)
-- SOLO LECTURA: BEGIN TRANSACTION READ ONLY ... ROLLBACK. No crea ni modifica nada.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 \
--        -f 20261108_020_manufactura_gestor_documental_prod.precheck.sql
--
-- Resultado esperado: todas las comprobaciones en true y ALL_PRECHECKS_PASS = true.
-- Anote la LÍNEA BASE del bloque final: el postcheck la recibe con -v para comprobar que NADA MÁS cambió.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;

-- 0. Destino: este script solo corre en daubert_global. Se aborta ANTES de cualquier otra comprobación.
DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN
    RAISE EXCEPTION 'ABORTO: este precheck es solo para daubert_global (base actual: %).', current_database();
  END IF;
  IF current_database() = 'daubert_hub_test' THEN
    RAISE EXCEPTION 'ABORTO: daubert_hub_test es TEST; use las migraciones de TEST.';
  END IF;
END $$;

SELECT
  current_database()                                                             AS base_actual,
  current_user                                                                   AS rol_actual,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                   AS rol_es_administrador,
  current_setting('server_version_num')::int >= 150000                           AS version_pg_15_o_mayor,
  current_database() = 'daubert_global'                                        AS base_es_produccion,
  -- el rol de la aplicación existe, no es superusuario y NO es el rol de producción
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_app' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND rolcanlogin) AS rol_app_existe_y_sin_privilegios,
  current_setting('row_security') = 'on'                                           AS row_security_activa,
  -- objetos de los que dependen las tablas nuevas
  to_regclass('security.users')                  IS NOT NULL                     AS existe_security_users,
  to_regclass('core.empresas')                   IS NOT NULL                     AS existe_core_empresas,
  to_regclass('audit.cambios')                   IS NOT NULL                     AS existe_audit_cambios,
  to_regproc('audit.fn_registrar_cambio')        IS NOT NULL                     AS existe_fn_auditoria,
  -- el delta NO existe todavía (no se reaplica)
  NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura')          AS esquema_manufactura_no_existe,
  -- la aplicación NO tiene (ni debe tener) DDL
  NOT has_database_privilege('daubert_hub_app', current_database(), 'CREATE') AS app_sin_create_en_base,
  NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND has_schema_privilege('daubert_hub_app', n.nspname, 'CREATE')) AS app_sin_create_en_esquemas,
  -- Hay al menos un usuario activo (la identidad de auditoría sale de security.users)
  (SELECT count(*) FROM security.users WHERE status = 'ACTIVE') > 0              AS hay_usuarios_activos,
  -- dependencias de lectura de la aplicación (rutas y políticas RLS): existen y la app puede leerlas, sin RLS que las filtre
  to_regclass('core.empresa_roles') IS NOT NULL                                  AS existe_core_empresa_roles,
  COALESCE(has_table_privilege('daubert_hub_app', to_regclass('security.users'), 'SELECT') AND has_table_privilege('daubert_hub_app', to_regclass('core.empresas'), 'SELECT') AND has_table_privilege('daubert_hub_app', to_regclass('core.empresa_roles'), 'SELECT'), false) AS app_puede_leer_users_empresas_roles,
  NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (to_regclass('security.users'), to_regclass('core.empresas'), to_regclass('core.empresa_roles')) AND c.relrowsecurity) AS sin_rls_en_tablas_leidas,
  -- columnas que usa el gestor
  (SELECT count(*) FROM information_schema.columns WHERE (table_schema, table_name, column_name) IN (('security','users','user_id'),('security','users','display_name'),('security','users','email'),('security','users','role'),('security','users','status'),('core','empresas','empresa_id'),('core','empresas','nombre_comercial'),('core','empresas','estatus'),('core','empresa_roles','empresa_id'),('core','empresa_roles','rol'),('core','empresa_roles','estatus'))) = 11 AS columnas_requeridas_existen;

-- Comprobación consolidada.
WITH c AS (
  SELECT
    current_database() = 'daubert_global'                                                         AS a,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                    AS b,
    current_setting('server_version_num')::int >= 150000                                            AS c1,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_app' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND rolcanlogin) AS d,
    to_regclass('security.users') IS NOT NULL AND to_regclass('core.empresas') IS NOT NULL AND to_regclass('audit.cambios') IS NOT NULL AND to_regproc('audit.fn_registrar_cambio') IS NOT NULL AS e,
    NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura')                           AS f,
    NOT has_database_privilege('daubert_hub_app', current_database(), 'CREATE')               AS g,
    (SELECT count(*) FROM security.users WHERE status = 'ACTIVE') > 0                               AS h,
    current_setting('row_security') = 'on'                                                          AS i,
    to_regclass('core.empresa_roles') IS NOT NULL AND COALESCE(has_table_privilege('daubert_hub_app', to_regclass('security.users'), 'SELECT') AND has_table_privilege('daubert_hub_app', to_regclass('core.empresas'), 'SELECT') AND has_table_privilege('daubert_hub_app', to_regclass('core.empresa_roles'), 'SELECT'), false) AS j,
    NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (to_regclass('security.users'), to_regclass('core.empresas'), to_regclass('core.empresa_roles')) AND c.relrowsecurity) AS k,
    (SELECT count(*) FROM information_schema.columns WHERE (table_schema, table_name, column_name) IN (('security','users','user_id'),('security','users','display_name'),('security','users','email'),('security','users','role'),('security','users','status'),('core','empresas','empresa_id'),('core','empresas','nombre_comercial'),('core','empresas','estatus'),('core','empresa_roles','empresa_id'),('core','empresa_roles','rol'),('core','empresa_roles','estatus'))) = 11 AS l
)
SELECT (a AND b AND c1 AND d AND e AND f AND g AND h AND i AND j AND k AND l) AS all_prechecks_pass FROM c;

-- LÍNEA BASE (pásela al postcheck con -v). Describe TODO lo que NO debe cambiar.
SELECT
  (SELECT count(*) FROM security.users)                                                              AS baseline_users,
  (SELECT count(*) FROM core.empresas)                                                               AS baseline_empresas,
  (SELECT count(*) FROM audit.cambios)                                                               AS baseline_audit_cambios,
  (SELECT md5(string_agg(table_schema || '.' || table_name, ',' ORDER BY table_schema, table_name))
     FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema'))  AS baseline_tablas_fp,
  (SELECT md5(string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)), ',' ORDER BY p.oid::regprocedure::text))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('audit', 'core', 'security', 'ops', 'operacion')) AS baseline_funciones_fp,
  -- Línea base AMPLIADA (revisión 3): todo lo que existe FUERA de `manufactura` debe quedar idéntico tras el UP y tras el DOWN.
  (SELECT md5(string_agg(c.table_schema || '.' || c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || COALESCE(c.column_default, ''), ',' ORDER BY c.table_schema, c.table_name, c.ordinal_position))
     FROM information_schema.columns c WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'manufactura'))   AS baseline_columnas_fp,
  (SELECT md5(COALESCE(string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid), ',' ORDER BY n.nspname, c.relname, t.tgname), ''))
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname <> 'manufactura') AS baseline_triggers_fp,
  (SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || COALESCE(c.relacl::text, '') || ':' || pg_get_userbyid(c.relowner), ',' ORDER BY n.nspname, c.relname))
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'manufactura') AND c.relkind IN ('r', 'v', 'm', 'S', 'p')) AS baseline_privilegios_fp,
  (SELECT md5(string_agg(rolname || ':' || rolsuper::text || rolcreatedb::text || rolcreaterole::text || rolcanlogin::text || rolbypassrls::text || rolconnlimit::text, ',' ORDER BY rolname)) FROM pg_roles WHERE rolname !~ '^pg_') AS baseline_roles_fp,
  (SELECT md5(string_agg(datname || ':' || COALESCE(datacl::text, ''), ',' ORDER BY datname)) FROM pg_database)         AS baseline_acl_bases_fp,
  (SELECT md5(string_agg(n.nspname || ':' || COALESCE(n.nspacl::text, ''), ',' ORDER BY n.nspname)) FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'manufactura')) AS baseline_esquemas_acl_fp;

ROLLBACK;
