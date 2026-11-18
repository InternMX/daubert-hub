-- GENERADO desde TEST 103 (20261105_103_manufactura_inventario_firmas_admin_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 022. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- PRECHECK · manufactura 103 · inventario administrativo de firmas (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_022_manufactura_inventario_firmas_admin_prod.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote HUELLA_MANUFACTURA: el postcheck la recibe con -v para demostrar que tablas, triggers, políticas y privilegios NO cambiaron.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF; END $$;

WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                AS rol_es_administrador,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_app' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND rolcanlogin) AS rol_app_sin_privilegios,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 8                                                       AS migraciones_101_y_102_aplicadas_8_tablas,
    to_regproc('manufactura.fn_actor') IS NOT NULL AND to_regproc('manufactura.fn_actor_es_admin') IS NOT NULL                  AS funciones_de_identidad,
    to_regclass('manufactura.firmas') IS NOT NULL AND to_regclass('manufactura.firma_autorizaciones') IS NOT NULL               AS tablas_de_firmas,
    to_regprocedure('manufactura.fn_firmas_inventario(bigint, boolean)') IS NULL                                                     AS funcion_103_no_existe,
    NOT has_schema_privilege('daubert_hub_app', 'manufactura', 'CREATE')                                                  AS app_sin_create_en_manufactura
)
SELECT c.*, (rol_es_administrador AND rol_app_sin_privilegios AND migraciones_101_y_102_aplicadas_8_tablas AND funciones_de_identidad AND tablas_de_firmas AND funcion_103_no_existe AND app_sin_create_en_manufactura) AS all_prechecks_pass FROM c;

-- Huella de TODO lo que la 103 NO debe tocar: columnas, triggers, políticas y privilegios de las 8 tablas.
SELECT md5(string_agg(x, '|' ORDER BY x)) AS huella_manufactura FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal
  UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura'
  UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
) q;
SELECT (SELECT count(*) FROM manufactura.firmas) AS firmas, (SELECT count(*) FROM manufactura.firma_autorizaciones) AS autorizaciones, (SELECT count(*) FROM manufactura.revision_responsables) AS responsables;
ROLLBACK;
