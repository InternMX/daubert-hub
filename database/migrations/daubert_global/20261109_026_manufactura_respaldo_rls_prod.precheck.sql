-- GENERADO por tools/generar-manufactura-026.cjs — migración PRODUCTIVA 026 (precheck). NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- PRECHECK · manufactura 026 · respaldo con RLS (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261109_026_manufactura_respaldo_rls_prod.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote huella_politicas_app y huella_privilegios: el postcheck las recibe con -v para demostrar que la 026 no tocó nada más.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF; END $$;
WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                AS rol_es_administrador,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_backup')                                                            AS rol_respaldos_existe,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = 9                          AS nueve_tablas_con_rls,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') = 24                                                    AS politicas_de_la_024,
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pol_respaldo_sel')                                                AS la_026_no_esta_aplicada,
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'manufactura' AND roles::text LIKE '%daubert_backup%')             AS sin_politicas_previas_para_respaldos,
    NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname <> 'manufactura' AND rowsecurity)                                      AS sin_rls_fuera_de_manufactura,
COALESCE((SELECT bool_and(
        b.rolcanlogin AND b.rolinherit AND NOT b.rolsuper AND NOT b.rolcreaterole AND NOT b.rolcreatedb AND NOT b.rolreplication AND NOT b.rolbypassrls
        AND pg_has_role(b.oid, 'pg_read_all_data', 'USAGE')
        AND NOT EXISTS (SELECT 1 FROM pg_roles o WHERE o.oid <> b.oid AND o.rolname <> 'pg_read_all_data' AND (pg_has_role(b.oid, o.oid, 'MEMBER') OR pg_has_role(b.oid, o.oid, 'USAGE') OR pg_has_role(b.oid, o.oid, 'SET')))
        AND has_schema_privilege(b.oid, 'manufactura', 'USAGE') AND NOT has_schema_privilege(b.oid, 'manufactura', 'CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'manufactura'::regnamespace AND (
              (c.relkind IN ('r', 'p') AND (NOT has_table_privilege(b.oid, c.oid, 'SELECT') OR has_table_privilege(b.oid, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                                           OR has_any_column_privilege(b.oid, c.oid, 'INSERT,UPDATE,REFERENCES')))
           OR (c.relkind = 'S' AND has_sequence_privilege(b.oid, c.oid, 'USAGE,UPDATE'))))
        AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'manufactura'::regnamespace AND p.prorettype <> 'trigger'::regtype AND has_function_privilege(b.oid, p.oid, 'EXECUTE'))
        AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'manufactura'::regnamespace AND a.grantee = b.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname = 'manufactura' AND a.grantee = b.oid)
      ) FROM pg_roles b WHERE b.rolname = 'daubert_backup'), true)                                                                                             AS respaldos_solo_lectura
)
SELECT c.*, (rol_es_administrador AND rol_respaldos_existe AND nueve_tablas_con_rls AND politicas_de_la_024 AND la_026_no_esta_aplicada AND sin_politicas_previas_para_respaldos
             AND sin_rls_fuera_de_manufactura AND respaldos_solo_lectura) AS all_prechecks_pass FROM c;
SELECT (SELECT md5(COALESCE(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, ''), '|' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname <> 'pol_respaldo_sel') AS huella_politicas_app, (SELECT md5(COALESCE(string_agg(table_name || ':' || grantee || ':' || privilege_type, '|' ORDER BY table_name, grantee, privilege_type), '')) FROM information_schema.role_table_grants WHERE table_schema = 'manufactura') AS huella_privilegios;
ROLLBACK;
