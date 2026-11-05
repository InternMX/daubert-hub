-- GENERADO desde TEST 104 (20261106_104_manufactura_cliente_abreviaturas_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 015. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- POSTCHECK · manufactura 104 · abreviaturas de cliente (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_manufactura=<valor del precheck> -f 20261108_015_manufactura_cliente_abreviaturas_prod.postcheck.sql
-- Esperado: todas las columnas en true y all_postchecks_pass = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?huella_manufactura}
\else
  \set huella_manufactura SIN_HUELLA
\endif
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global.'; END IF; END $$;

WITH f AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('manufactura.fn_sugerir_cliente(text, boolean)'), to_regprocedure('manufactura.fn_cliente_vigente(bigint)'))
), huella AS (
  SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
    SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura' AND table_name <> 'cliente_abreviaturas'
    UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND c.relname <> 'cliente_abreviaturas'
    UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura' AND tablename <> 'cliente_abreviaturas'
    UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura' AND table_name <> 'cliente_abreviaturas'
  ) q
), r AS (
  SELECT
    to_regclass('manufactura.cliente_abreviaturas') IS NOT NULL                                                                    AS tabla_existe,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 9                                                          AS son_9_tablas,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = 9                                          AS rls_en_las_9,
    (SELECT count(*) FROM manufactura.cliente_abreviaturas) = 0                                                                    AS tabla_vacia_sin_clientes_ni_abreviaturas,
    (SELECT count(*) FROM f) = 2                                                                                                   AS dos_funciones,
    COALESCE((SELECT bool_and(NOT prosecdef AND provolatile = 's') FROM f), false)                                                 AS funciones_invoker_y_stable,
    COALESCE((SELECT bool_and(EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')) FROM f), false)             AS search_path_fijo,
    COALESCE((SELECT bool_and(NOT has_function_privilege('public', oid, 'EXECUTE') AND has_function_privilege('daubert_hub_app', oid, 'EXECUTE')) FROM f), false) AS execute_solo_para_la_app,
    (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'manufactura.cliente_abreviaturas'::regclass AND NOT t.tgisinternal) = 4    AS cuatro_triggers_insert_update_nodelete_auditoria,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND tablename = 'cliente_abreviaturas') = 3                  AS tres_politicas,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'manufactura' AND indexname = 'uq_manufactura_cliente_abrev_vigente' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%') AS unico_solo_duplicado_exacto_vigente,
    NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'manufactura' AND tablename = 'cliente_abreviaturas' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '\(abreviatura\)') AS sin_unicidad_global_por_abreviatura,
    NOT has_table_privilege('daubert_hub_app', 'manufactura.cliente_abreviaturas', 'DELETE') AND NOT has_table_privilege('daubert_hub_app', 'manufactura.cliente_abreviaturas', 'TRUNCATE')
      AND NOT has_column_privilege('daubert_hub_app', 'manufactura.cliente_abreviaturas', 'abreviatura', 'UPDATE') AND NOT has_column_privilege('daubert_hub_app', 'manufactura.cliente_abreviaturas', 'cliente_empresa_id', 'UPDATE')
      AND has_column_privilege('daubert_hub_app', 'manufactura.cliente_abreviaturas', 'estado', 'UPDATE')                  AS privilegios_minimos,
    NOT has_table_privilege('public', 'manufactura.cliente_abreviaturas', 'SELECT')                                                AS sin_acceso_public,
    NOT has_schema_privilege('daubert_hub_app', 'manufactura', 'CREATE')                                                     AS app_sin_create_en_manufactura,
    ((SELECT h FROM huella) = :'huella_manufactura')                                                                               AS objetos_existentes_sin_cambios
)
SELECT r.*, (tabla_existe AND son_9_tablas AND rls_en_las_9 AND tabla_vacia_sin_clientes_ni_abreviaturas AND dos_funciones AND funciones_invoker_y_stable AND search_path_fijo AND execute_solo_para_la_app
             AND cuatro_triggers_insert_update_nodelete_auditoria AND tres_politicas AND unico_solo_duplicado_exacto_vigente AND sin_unicidad_global_por_abreviatura AND privilegios_minimos AND sin_acceso_public
             AND app_sin_create_en_manufactura AND objetos_existentes_sin_cambios) AS all_postchecks_pass FROM r;
ROLLBACK;
