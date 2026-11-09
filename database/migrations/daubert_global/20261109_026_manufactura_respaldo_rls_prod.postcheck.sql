-- GENERADO por tools/generar-manufactura-026.cjs — migración PRODUCTIVA 026 (postcheck). NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- POSTCHECK · manufactura 026 (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_politicas_app=<del precheck> -v huella_privilegios=<del precheck> -f 20261109_026_manufactura_respaldo_rls_prod.postcheck.sql
-- Esperado: all_postchecks_pass = t.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF; END $$;
WITH r AS (
  SELECT
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel') = 9                         AS nueve_politicas_de_respaldo,
    (SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel') = 9       AS una_por_tabla,
    (SELECT bool_and(cmd = 'SELECT' AND roles = ARRAY['daubert_backup']::name[] AND permissive = 'PERMISSIVE' AND qual = 'true' AND with_check IS NULL)
       FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel')                                                       AS solo_select_para_respaldos_sin_with_check,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND roles::text LIKE '%daubert_backup%') = 9                     AS ninguna_otra_politica_para_respaldos,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') = 24 + 9                                                      AS treinta_y_tres_politicas,
    (SELECT md5(COALESCE(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, ''), '|' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname <> 'pol_respaldo_sel') = :'huella_politicas_app'                                                                                                  AS politicas_de_la_aplicacion_sin_cambios,
    (SELECT md5(COALESCE(string_agg(table_name || ':' || grantee || ':' || privilege_type, '|' ORDER BY table_name, grantee, privilege_type), '')) FROM information_schema.role_table_grants WHERE table_schema = 'manufactura') = :'huella_privilegios'                                                                                                       AS privilegios_de_tabla_sin_cambios,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = 9                                              AS rls_activa_en_las_9,
    NOT EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = (SELECT nspname FROM pg_namespace WHERE oid = c.relnamespace) AND p.tablename = c.relname
                             AND p.cmd IN ('SELECT', 'ALL') AND p.permissive = 'PERMISSIVE' AND (p.roles @> ARRAY['daubert_backup']::name[] OR p.roles @> ARRAY['public']::name[]) AND p.qual = 'true'))                                                                                                                              AS toda_tabla_con_rls_cubierta_para_respaldos,
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
      ) FROM pg_roles b WHERE b.rolname = 'daubert_backup'), true)                                                                                                                                           AS respaldos_solo_lectura
)
SELECT r.*, (nueve_politicas_de_respaldo AND una_por_tabla AND solo_select_para_respaldos_sin_with_check AND ninguna_otra_politica_para_respaldos AND treinta_y_tres_politicas
             AND politicas_de_la_aplicacion_sin_cambios AND privilegios_de_tabla_sin_cambios AND rls_activa_en_las_9 AND toda_tabla_con_rls_cubierta_para_respaldos AND respaldos_solo_lectura) AS all_postchecks_pass FROM r;
ROLLBACK;
