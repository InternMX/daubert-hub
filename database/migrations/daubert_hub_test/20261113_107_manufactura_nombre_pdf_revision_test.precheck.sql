-- =====================================================================================================================
-- PRECHECK · manufactura 107 · nombre del PDF con revisión sin truncar (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261113_107_manufactura_nombre_pdf_revision_test.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote huella_resto: el postcheck la recibe con -v para demostrar que lo demás NO cambió.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF; END $$;
WITH f AS (
  SELECT p.* FROM pg_proc p WHERE p.oid = to_regprocedure('manufactura.fn_nombre_pdf(text,text,integer)')
), c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                       AS rol_es_administrador,
    to_regclass('manufactura.pdfs') IS NOT NULL                                                                                        AS migracion_101_aplicada,
    EXISTS (SELECT 1 FROM f)                                                                                                           AS funcion_existe,
    coalesce((SELECT f.proowner = n.nspowner FROM f, pg_namespace n WHERE n.nspname = 'manufactura'), false)                           AS propietario_es_el_del_esquema,
    coalesce((SELECT f.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql') AND f.provolatile = 'i' AND NOT f.prosecdef
                     AND f.prorettype = 'text'::regtype AND f.proconfig = ARRAY['search_path=pg_catalog'] FROM f), false)             AS atributos_de_la_101,
    coalesce((SELECT f.prosrc = $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' $b$ FROM f), false)
                                                                                                                                       AS definicion_de_la_101_la_107_no_aplicada,
    coalesce((SELECT has_function_privilege('daubert_hub_test_user', f.oid, 'EXECUTE') FROM f), false)                                 AS app_puede_ejecutar,
    coalesce((SELECT NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0) FROM f), false) AS public_sin_execute,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0                                         AS toda_tabla_con_rls
)
SELECT current_database() AS base_actual, c.*, (rol_es_administrador AND migracion_101_aplicada AND funcion_existe AND propietario_es_el_del_esquema AND atributos_de_la_101
  AND definicion_de_la_101_la_107_no_aplicada AND app_puede_ejecutar AND public_sin_execute AND toda_tabla_con_rls) AS all_prechecks_pass FROM c;
-- Huella de TODO lo que la 107 NO debe tocar: las demás funciones, propietario/ACL/atributos de fn_nombre_pdf, tablas (dueño, RLS, ACL), columnas, triggers, políticas, privilegios y restricciones.
SELECT md5(string_agg(x, '|' ORDER BY x)) AS huella_resto FROM (
  SELECT 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) AS x FROM pg_proc p WHERE p.pronamespace = 'manufactura'::regnamespace AND p.oid <> 'manufactura.fn_nombre_pdf(text,text,integer)'::regprocedure
  UNION ALL SELECT 'fnacl:' || p.oid::regprocedure::text || ':' || pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, '') || ':' || p.provolatile::text || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '') || ':' || p.prorettype::regtype::text FROM pg_proc p WHERE p.pronamespace = 'manufactura'::regnamespace
  UNION ALL SELECT 'tab:' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(c.relacl::text, '') FROM pg_class c WHERE c.relnamespace = 'manufactura'::regnamespace AND c.relkind IN ('r', 'p', 'S', 'v')
  UNION ALL SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') || ':' || coalesce(generation_expression, '') FROM information_schema.columns WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'manufactura'::regnamespace AND NOT t.tgisinternal
  UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura'
  UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'con:' || k.conname || ':' || pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.connamespace = 'manufactura'::regnamespace
  UNION ALL SELECT 'nsp:' || n.nspname || ':' || pg_get_userbyid(n.nspowner) || ':' || coalesce(n.nspacl::text, '') FROM pg_namespace n WHERE n.nspname = 'manufactura'
) q;
-- Informativo: revisiones con número >= 100 (con la 101 su PDF no podía registrarse: el nombre se truncaba a dos dígitos) y PDF registrados.
SELECT (SELECT count(*) FROM manufactura.revisiones WHERE greatest(coalesce(revision, 0), coalesce(revision_prevista, 0)) >= 100) AS revisiones_100_o_mas,
       (SELECT count(*) FROM manufactura.pdfs) AS pdfs_registrados;
ROLLBACK;
