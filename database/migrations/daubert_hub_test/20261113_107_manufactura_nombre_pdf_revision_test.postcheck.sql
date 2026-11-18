-- =====================================================================================================================
-- POSTCHECK · manufactura 107 (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_resto=<valor del precheck> -f 20261113_107_manufactura_nombre_pdf_revision_test.postcheck.sql
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
    SELECT 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) AS x FROM pg_proc p WHERE p.pronamespace = 'manufactura'::regnamespace AND p.oid <> 'manufactura.fn_nombre_pdf(text,text,integer)'::regprocedure
    UNION ALL SELECT 'fnacl:' || p.oid::regprocedure::text || ':' || pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, '') || ':' || p.provolatile::text || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '') || ':' || p.prorettype::regtype::text FROM pg_proc p WHERE p.pronamespace = 'manufactura'::regnamespace
    UNION ALL SELECT 'tab:' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(c.relacl::text, '') FROM pg_class c WHERE c.relnamespace = 'manufactura'::regnamespace AND c.relkind IN ('r', 'p', 'S', 'v')
    UNION ALL SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') || ':' || coalesce(generation_expression, '') FROM information_schema.columns WHERE table_schema = 'manufactura'
    UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'manufactura'::regnamespace AND NOT t.tgisinternal
    UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura'
    UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
    UNION ALL SELECT 'con:' || k.conname || ':' || pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.connamespace = 'manufactura'::regnamespace
    UNION ALL SELECT 'nsp:' || n.nspname || ':' || pg_get_userbyid(n.nspowner) || ':' || coalesce(n.nspacl::text, '') FROM pg_namespace n WHERE n.nspname = 'manufactura'
  ) q
), f AS (
  SELECT p.* FROM pg_proc p WHERE p.oid = to_regprocedure('manufactura.fn_nombre_pdf(text,text,integer)')
), r AS (
  SELECT
    coalesce((SELECT f.prosrc = $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, greatest(2, length(p_revision::text)), '0') || '.pdf' $b$ FROM f), false)
                                                                                                                                       AS definicion_de_la_107,
    coalesce((SELECT f.provolatile = 'i' AND NOT f.prosecdef AND f.proconfig = ARRAY['search_path=pg_catalog'] AND f.prorettype = 'text'::regtype FROM f), false) AS atributos_conservados,
    coalesce((SELECT f.proowner = n.nspowner FROM f, pg_namespace n WHERE n.nspname = 'manufactura'), false)                           AS propietario_conservado,
    coalesce((SELECT has_function_privilege('daubert_hub_test_user', f.oid, 'EXECUTE') FROM f), false)                                 AS app_puede_ejecutar,
    coalesce((SELECT NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0) FROM f), false) AS public_sin_execute,
    (manufactura.fn_nombre_pdf('ABC', NULL, 1) = 'ABC_REV01.pdf' AND manufactura.fn_nombre_pdf('ABC', NULL, 9) = 'ABC_REV09.pdf' AND manufactura.fn_nombre_pdf('ABC', NULL, 10) = 'ABC_REV10.pdf'
      AND manufactura.fn_nombre_pdf('ABC', NULL, 99) = 'ABC_REV99.pdf' AND manufactura.fn_nombre_pdf('ABC', NULL, 100) = 'ABC_REV100.pdf'
      AND manufactura.fn_nombre_pdf('HOJA48', 'doblada', 105) = 'HOJA48-DOBLADA_REV105.pdf' AND manufactura.fn_nombre_pdf('CON', NULL, 1) = 'CON_REV01.pdf')  AS nombres_esperados,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0                                         AS toda_tabla_con_rls,
    ((SELECT h FROM huella) = :'huella_resto')                                                                                         AS resto_sin_cambios
)
SELECT r.*, (definicion_de_la_107 AND atributos_conservados AND propietario_conservado AND app_puede_ejecutar AND public_sin_execute AND nombres_esperados AND toda_tabla_con_rls AND resto_sin_cambios) AS all_postchecks_pass FROM r;
ROLLBACK;
