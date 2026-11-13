-- =====================================================================================================================
-- PRECHECK · manufactura 105 (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261107_105_manufactura_consulta_compartida_borradores_test.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote huella_resto: el postcheck la recibe con -v para demostrar que lo demás NO cambió.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF; END $$;
WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                AS rol_es_administrador,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND rolcanlogin) AS rol_app_sin_privilegios,
    to_regclass('manufactura.revisiones') IS NOT NULL AND to_regclass('manufactura.revision_responsables') IS NOT NULL            AS migraciones_101_y_102_aplicadas,
    to_regproc('manufactura.fn_actor_id') IS NOT NULL AND to_regproc('manufactura.fn_actor_es_admin') IS NOT NULL                 AS funciones_de_la_101,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname IN ('pol_revisiones_sel', 'pol_pdfs_sel', 'pol_pdf_contenidos_sel')) = 3 AS tres_politicas_existen,
    NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polname = 'pol_revisiones_sel' AND obj_description(p.oid, 'pg_policy') LIKE '105:%') AS la_105_no_esta_aplicada,
    (SELECT qual FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_revisiones_sel') NOT LIKE '%BORRADOR%' AS politica_con_forma_de_la_101,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0                                    AS toda_tabla_con_rls,
    NOT has_schema_privilege('daubert_hub_test_user', 'manufactura', 'CREATE')                                                  AS app_sin_create_en_manufactura
)
SELECT c.*, (rol_es_administrador AND rol_app_sin_privilegios AND migraciones_101_y_102_aplicadas AND funciones_de_la_101 AND tres_politicas_existen AND la_105_no_esta_aplicada AND politica_con_forma_de_la_101
             AND toda_tabla_con_rls AND app_sin_create_en_manufactura) AS all_prechecks_pass FROM c;
-- Huella de TODO lo que la 105 NO debe tocar: columnas, triggers, privilegios y las políticas distintas de las 3 redefinidas.
SELECT md5(string_agg(x, '|' ORDER BY x)) AS huella_resto FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal
  UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura' AND policyname NOT IN ('pol_revisiones_sel', 'pol_pdfs_sel', 'pol_pdf_contenidos_sel')
  UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
) q;
-- Conteos informativos (la 105 no cambia datos).
SELECT (SELECT count(*) FROM manufactura.documentos) AS documentos, (SELECT count(*) FROM manufactura.revisiones) AS revisiones, (SELECT count(*) FROM manufactura.pdfs) AS pdfs;
ROLLBACK;
