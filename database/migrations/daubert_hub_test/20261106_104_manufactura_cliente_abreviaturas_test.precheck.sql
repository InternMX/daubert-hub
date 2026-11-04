-- =====================================================================================================================
-- PRECHECK · manufactura 104 · abreviaturas de cliente (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261106_104_manufactura_cliente_abreviaturas_test.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote HUELLA_MANUFACTURA: el postcheck la recibe con -v para demostrar que lo existente NO cambió.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF; END $$;

WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                AS rol_es_administrador,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND rolcanlogin) AS rol_app_sin_privilegios,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 8                                                       AS migraciones_101_y_102_aplicadas_8_tablas,
    to_regproc('manufactura.fn_actor') IS NOT NULL AND to_regproc('manufactura.fn_actor_es_admin') IS NOT NULL
      AND to_regproc('manufactura.fn_auditar_manufactura') IS NOT NULL AND to_regproc('manufactura.fn_inmutable') IS NOT NULL    AS funciones_de_la_101,
    to_regclass('core.empresas') IS NOT NULL AND to_regclass('core.empresa_roles') IS NOT NULL                                    AS core_empresas_y_roles_existen,
    COALESCE(has_table_privilege('daubert_hub_test_user', 'core.empresas', 'SELECT') AND has_table_privilege('daubert_hub_test_user', 'core.empresa_roles', 'SELECT'), false) AS app_puede_leer_core_empresas,
    to_regclass('manufactura.cliente_abreviaturas') IS NULL                                                                     AS tabla_104_no_existe,
    to_regprocedure('manufactura.fn_sugerir_cliente(text, boolean)') IS NULL AND to_regprocedure('manufactura.fn_cliente_vigente(bigint)') IS NULL AS funciones_104_no_existen,
    NOT has_schema_privilege('daubert_hub_test_user', 'manufactura', 'CREATE')                                                  AS app_sin_create_en_manufactura
)
SELECT c.*, (rol_es_administrador AND rol_app_sin_privilegios AND migraciones_101_y_102_aplicadas_8_tablas AND funciones_de_la_101 AND core_empresas_y_roles_existen AND app_puede_leer_core_empresas
             AND tabla_104_no_existe AND funciones_104_no_existen AND app_sin_create_en_manufactura) AS all_prechecks_pass FROM c;

-- Huella de TODO lo que la 104 NO debe tocar (columnas, triggers, políticas y privilegios de las 8 tablas existentes).
SELECT md5(string_agg(x, '|' ORDER BY x)) AS huella_manufactura FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura' AND table_name <> 'cliente_abreviaturas'
  UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND c.relname <> 'cliente_abreviaturas'
  UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura' AND tablename <> 'cliente_abreviaturas'
  UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura' AND table_name <> 'cliente_abreviaturas'
) q;
-- Referencia de lo que NO se toca en core (la 104 no modifica core.alias_empresa ni core.empresas): conteos informativos.
SELECT (SELECT count(*) FROM core.empresas) AS empresas, (SELECT count(*) FROM core.empresa_roles WHERE rol = 'CLIENTE' AND estatus = 'ACTIVO') AS roles_cliente_activos,
       CASE WHEN to_regclass('core.alias_empresa') IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM core.alias_empresa', false, true, '')))[1]::text END AS alias_empresa_filas;
ROLLBACK;
