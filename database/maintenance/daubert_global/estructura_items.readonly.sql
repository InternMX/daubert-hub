-- =====================================================================================================================
-- ESTRUCTURA POR OBJETO · SOLO LECTURA (excluye el esquema manufactura). Imprime UNA línea por objeto para poder comparar PROD contra TEST con un diff.
-- Sirve para localizar exactamente qué hace distinta la huella H_ESTRUCTURA_SIN_MANUFACTURA entre ambas bases.
--   psql -h localhost -p 5432 -d daubert_global   -U postgres -W -X -At -v ON_ERROR_STOP=1 -o estructura_PROD.txt -f estructura_items.readonly.sql
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -At -v ON_ERROR_STOP=1 -o estructura_TEST.txt -f estructura_items.readonly.sql
-- (use -o, no «>» de PowerShell: así el archivo sale en UTF-8). No lee datos de negocio. Una transacción READ ONLY que termina en ROLLBACK.
-- =====================================================================================================================
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() NOT IN ('daubert_global', 'daubert_hub_test') THEN RAISE EXCEPTION 'ABORTO: solo daubert_global o daubert_hub_test.'; END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
END $$;
SELECT x FROM (
  SELECT 'REL   ' || n.nspname || '.' || c.relname || ' kind=' || c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity::text AS x
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  UNION ALL SELECT 'COL   ' || table_schema || '.' || table_name || '.' || column_name || ' type=' || data_type || ' null=' || is_nullable || ' ident=' || is_identity || ' gen=' || coalesce(generation_expression, '-') || ' def=' || coalesce(regexp_replace(column_default, 'nextval\(''[^'']*''', 'nextval(''…''', 'g'), '-')
    FROM information_schema.columns WHERE table_schema !~ '^pg_' AND table_schema NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'CON   ' || n.nspname || '.' || c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || md5(pg_get_constraintdef(k.oid))
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'IDX   ' || schemaname || '.' || tablename || ' ' || indexname || ' ' || md5(indexdef) FROM pg_indexes WHERE schemaname !~ '^pg_' AND schemaname NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'FN    ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef::text || ' owner=' || pg_get_userbyid(p.proowner) || ' body=' || md5(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'TRG   ' || n.nspname || '.' || c.relname || ' ' || t.tgname || ' enabled=' || t.tgenabled::text || ' ' || md5(pg_get_triggerdef(t.oid))
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'VIEW  ' || schemaname || '.' || viewname || ' ' || md5(regexp_replace(definition, '\s+', ' ', 'g')) FROM pg_views WHERE schemaname !~ '^pg_' AND schemaname NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'POL   ' || schemaname || '.' || tablename || ' ' || policyname FROM pg_policies WHERE schemaname NOT IN ('manufactura')
) q ORDER BY x;
ROLLBACK;
