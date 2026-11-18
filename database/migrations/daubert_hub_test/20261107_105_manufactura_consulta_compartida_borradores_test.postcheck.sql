-- =====================================================================================================================
-- POSTCHECK · manufactura 105 (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_resto=<valor del precheck> -f 20261107_105_manufactura_consulta_compartida_borradores_test.postcheck.sql
-- Esperado: todas las columnas en true y all_postchecks_pass = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?huella_resto}
\else
  \set huella_resto SIN_HUELLA
\endif
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test.'; END IF; END $$;
WITH huella AS (
  SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
    SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura'
    UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal
    UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura' AND policyname NOT IN ('pol_revisiones_sel', 'pol_pdfs_sel', 'pol_pdf_contenidos_sel')
    UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
  ) q
), r AS (
  SELECT
    (SELECT count(*) FROM pg_policy p WHERE p.polname IN ('pol_revisiones_sel', 'pol_pdfs_sel', 'pol_pdf_contenidos_sel') AND obj_description(p.oid, 'pg_policy') LIKE '105:%') = 3 AS tres_politicas_marcadas_105,
    (SELECT qual FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_revisiones_sel') LIKE '%BORRADOR%'
      AND (SELECT qual FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_revisiones_sel') LIKE '%fn_actor_id() IS NOT NULL%'                                    AS revisiones_borrador_con_identidad,
    (SELECT qual FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_revisiones_sel') NOT LIKE '%DESCARTADA%'                                                        AS descartada_no_se_abre,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname IN ('pol_pdfs_sel', 'pol_pdf_contenidos_sel') AND qual LIKE '%FINALIZADA%' AND qual LIKE '%fn_actor_es_admin%') = 2 AS pdf_sin_exposicion_nueva,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0                                                                                            AS toda_tabla_con_rls,
    NOT has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'DELETE') AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'TRUNCATE')
      AND NOT has_table_privilege('public', 'manufactura.revisiones', 'SELECT')                                                                                                           AS privilegios_sin_cambios,
    NOT has_schema_privilege('daubert_hub_test_user', 'manufactura', 'CREATE')                                                                                                            AS app_sin_create_en_manufactura,
    ((SELECT h FROM huella) = :'huella_resto')                                                                                                                                            AS resto_sin_cambios
)
SELECT r.*, (tres_politicas_marcadas_105 AND revisiones_borrador_con_identidad AND descartada_no_se_abre AND pdf_sin_exposicion_nueva AND toda_tabla_con_rls
             AND privilegios_sin_cambios AND app_sin_create_en_manufactura AND resto_sin_cambios) AS all_postchecks_pass FROM r;
ROLLBACK;
