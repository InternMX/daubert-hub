-- =====================================================================================================================
-- PRECHECK · manufactura 106 (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261111_106_manufactura_genero_opcional_test.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote huella_resto: el postcheck la recibe con -v para demostrar que lo demás NO cambió.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF; END $$;
WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                 AS rol_es_administrador,
    to_regclass('manufactura.revisiones') IS NOT NULL                                                                            AS migracion_101_aplicada,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia')                                   AS restriccion_existe,
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia' AND obj_description(oid, 'pg_constraint') LIKE '106:%') AS la_106_no_esta_aplicada,
    coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia'), '') LIKE '%elaboro_nombre IS NOT NULL) AND elaboro_confirmado%' AS restriccion_con_forma_de_la_101,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0                                     AS toda_tabla_con_rls
)
SELECT c.*, (rol_es_administrador AND migracion_101_aplicada AND restriccion_existe AND la_106_no_esta_aplicada AND restriccion_con_forma_de_la_101 AND toda_tabla_con_rls) AS all_prechecks_pass FROM c;
-- Huella de TODO lo que la 106 NO debe tocar: columnas, triggers, políticas, privilegios y las demás restricciones de manufactura.
SELECT md5(string_agg(x, '|' ORDER BY x)) AS huella_resto FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal
  UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'manufactura'
  UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'
  UNION ALL SELECT 'con:' || k.conname || ':' || pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'manufactura' AND k.conname <> 'ck_manufactura_revisiones_coherencia'
) q;
-- Conteos informativos (la 106 no cambia datos).
SELECT (SELECT count(*) FROM manufactura.revisiones) AS revisiones, (SELECT count(*) FROM manufactura.revisiones WHERE estado = 'FINALIZADA') AS finalizadas;
ROLLBACK;
