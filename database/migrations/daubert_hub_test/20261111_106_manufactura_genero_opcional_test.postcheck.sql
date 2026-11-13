-- =====================================================================================================================
-- POSTCHECK · manufactura 106 (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_resto=<valor del precheck> -f 20261111_106_manufactura_genero_opcional_test.postcheck.sql
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
    UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura'
    UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
    UNION ALL SELECT 'con:' || k.conname || ':' || pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'manufactura' AND k.conname <> 'ck_manufactura_revisiones_coherencia'
  ) q
), def AS (
  SELECT coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia'), '') AS d
), r AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia' AND obj_description(oid, 'pg_constraint') LIKE '106:%') AS restriccion_marcada_106,
    (SELECT d FROM def) LIKE '%(elaboro_nombre IS NULL) OR elaboro_confirmado%'                                                      AS genero_opcional_confirmado_si_existe,
    (SELECT d FROM def) LIKE '%cliente_nombre IS NOT NULL%'                                                                          AS cliente_sigue_obligatorio,
    (SELECT d FROM def) NOT LIKE '%elaboro_nombre IS NOT NULL%'                                                                      AS sin_exigencia_de_nombre,
    (SELECT convalidated FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia')                                 AS restriccion_validada,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0                                        AS toda_tabla_con_rls,
    ((SELECT h FROM huella) = :'huella_resto')                                                                                       AS resto_sin_cambios
)
SELECT r.*, (restriccion_marcada_106 AND genero_opcional_confirmado_si_existe AND cliente_sigue_obligatorio AND sin_exigencia_de_nombre AND restriccion_validada AND toda_tabla_con_rls AND resto_sin_cambios) AS all_postchecks_pass FROM r;
ROLLBACK;
