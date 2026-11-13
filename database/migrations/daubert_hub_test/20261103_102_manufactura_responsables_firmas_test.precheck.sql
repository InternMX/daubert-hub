-- =====================================================================================================================
-- PRECHECK · manufactura 102 · responsables y firmas (SOLO TEST: daubert_hub_test)
-- SOLO LECTURA (BEGIN TRANSACTION READ ONLY ... ROLLBACK). Rol administrativo; nunca daubert_hub_test_user.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261103_102_manufactura_responsables_firmas_test.precheck.sql
-- Esperado: todas las comprobaciones en true y ALL_PRECHECKS_PASS = true. Anote HUELLA_101: el postcheck la recibe con -v huella_101=... para demostrar
-- que las 5 tablas de la 101 no cambiaron.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
END $$;

WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                               AS rol_es_administrador,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND rolcanlogin) AS rol_app_sin_privilegios,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 5                                                      AS manufactura_tiene_las_5_tablas_de_la_101,
    to_regproc('manufactura.fn_auditar_manufactura') IS NOT NULL AND to_regproc('manufactura.fn_actor') IS NOT NULL
      AND to_regproc('manufactura.fn_inmutable') IS NOT NULL AND to_regproc('manufactura.fn_actor_es_admin') IS NOT NULL      AS funciones_base_de_la_101,
    to_regclass('manufactura.firmas') IS NULL AND to_regclass('manufactura.firma_autorizaciones') IS NULL AND to_regclass('manufactura.revision_responsables') IS NULL AS delta_no_existe,
    to_regclass('security.users') IS NOT NULL AND to_regclass('audit.cambios') IS NOT NULL                                      AS dependencias_existen,
    NOT has_schema_privilege('daubert_hub_test_user', 'manufactura', 'CREATE')                                                 AS app_sin_create_en_manufactura
)
SELECT c.*, (rol_es_administrador AND rol_app_sin_privilegios AND manufactura_tiene_las_5_tablas_de_la_101 AND funciones_base_de_la_101 AND delta_no_existe AND dependencias_existen AND app_sin_create_en_manufactura) AS all_prechecks_pass FROM c;

-- Huella de lo que la 102 NO debe tocar: columnas, triggers, políticas y privilegios de las 5 tablas de la 101.
SELECT md5(string_agg(x, '|' ORDER BY x)) AS huella_101 FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal
  UNION ALL SELECT 'pol:' || tablename || '.' || policyname FROM pg_policies WHERE schemaname = 'manufactura'
  UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
) q;
SELECT (SELECT count(*) FROM manufactura.documentos) AS documentos, (SELECT count(*) FROM manufactura.revisiones) AS revisiones, (SELECT count(*) FROM manufactura.pdfs) AS pdfs;
ROLLBACK;
