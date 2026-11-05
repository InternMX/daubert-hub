-- GENERADO desde TEST 103 (20261105_103_manufactura_inventario_firmas_admin_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 022. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- POSTCHECK · manufactura 103 · inventario administrativo de firmas (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_manufactura=<valor del precheck> -f 20261108_022_manufactura_inventario_firmas_admin_prod.postcheck.sql
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
  SELECT p.oid, p.prosecdef, p.provolatile, p.proconfig, p.proacl, pg_get_function_result(p.oid) AS resultado, pg_get_userbyid(p.proowner) AS dueno
    FROM pg_proc p WHERE p.oid = to_regprocedure('manufactura.fn_firmas_inventario(bigint, boolean)')
), huella AS (
  SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
    SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura'
    UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal
    UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura'
    UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
  ) q
), r AS (
  SELECT
    EXISTS (SELECT 1 FROM f)                                                                                                       AS funcion_existe,
    COALESCE((SELECT prosecdef AND provolatile = 's' FROM f), false)                                                               AS security_definer_y_stable,
    COALESCE((SELECT EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%') FROM f), false)                       AS search_path_fijo,
    COALESCE((SELECT resultado !~* 'bytea|contenido|miniatura' FROM f), false)                                                     AS no_devuelve_imagen,
    COALESCE((SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = dueno) FROM f), false)                                         AS dueno_administrativo,
    COALESCE((SELECT NOT has_function_privilege('public', oid, 'EXECUTE') AND has_function_privilege('daubert_hub_app', oid, 'EXECUTE') FROM f), false) AS execute_solo_para_la_app,
    COALESCE((SELECT NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) FROM f), false)                          AS sin_acl_para_public,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 8                                                          AS siguen_8_tablas,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = 8                                          AS rls_en_las_8,
    NOT has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'DELETE') AND NOT has_column_privilege('daubert_hub_app', 'manufactura.firmas', 'contenido', 'UPDATE') AS privilegios_de_tabla_intactos,
    ((SELECT h FROM huella) = :'huella_manufactura')                                                                               AS tablas_triggers_politicas_y_privilegios_sin_cambios
)
SELECT r.*, (funcion_existe AND security_definer_y_stable AND search_path_fijo AND no_devuelve_imagen AND dueno_administrativo AND execute_solo_para_la_app AND sin_acl_para_public AND siguen_8_tablas AND rls_en_las_8
             AND privilegios_de_tabla_intactos AND tablas_triggers_politicas_y_privilegios_sin_cambios) AS all_postchecks_pass FROM r;
ROLLBACK;
