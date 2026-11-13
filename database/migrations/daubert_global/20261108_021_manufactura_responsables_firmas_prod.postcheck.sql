-- GENERADO desde TEST 102 (20261103_102_manufactura_responsables_firmas_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 021. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- POSTCHECK · manufactura 102 · responsables y firmas (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_101=<valor del precheck> -f 20261108_021_manufactura_responsables_firmas_prod.postcheck.sql
-- Esperado: todas las columnas en true y ALL_POSTCHECKS_PASS = true.
-- (La huella del precheck cubre las 5 tablas de la 101; aquí se recalcula SOLO sobre ellas.)
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?huella_101}
\else
  \set huella_101 SIN_HUELLA
\endif
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global.'; END IF; END $$;

WITH base AS (
  SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
    SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'manufactura' AND table_name IN ('documentos','revisiones','pdfs','pdf_contenidos','confirmaciones_revision')
    UNION ALL SELECT 'trg:' || c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND c.relname IN ('documentos','revisiones','pdfs','pdf_contenidos','confirmaciones_revision')
    UNION ALL SELECT 'pol:' || tablename || '.' || policyname FROM pg_policies WHERE schemaname = 'manufactura' AND tablename IN ('documentos','revisiones','pdfs','pdf_contenidos','confirmaciones_revision')
    UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'manufactura' AND table_name IN ('documentos','revisiones','pdfs','pdf_contenidos','confirmaciones_revision')
  ) q
), r AS (
  SELECT
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 8                                                              AS ocho_tablas,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = 8                                              AS rls_en_las_8,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND tablename IN ('firmas','firma_autorizaciones','revision_responsables')) = 10 AS diez_politicas_nuevas,
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND c.relname IN ('firmas','firma_autorizaciones','revision_responsables')) = 11 AS once_triggers_nuevos,
    (SELECT bool_and((SELECT rolsuper FROM pg_roles WHERE rolname = tableowner)) FROM pg_tables WHERE schemaname = 'manufactura' AND tablename IN ('firmas','firma_autorizaciones','revision_responsables')) AS duenos_administrativos,
    (has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'SELECT') AND has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'INSERT')
      AND NOT has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'DELETE') AND NOT has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'TRUNCATE')
      AND NOT has_column_privilege('daubert_hub_app', 'manufactura.firmas', 'contenido', 'UPDATE') AND has_column_privilege('daubert_hub_app', 'manufactura.firmas', 'estado', 'UPDATE')) AS privilegios_firmas,
    (has_table_privilege('daubert_hub_app', 'manufactura.firma_autorizaciones', 'INSERT') AND NOT has_table_privilege('daubert_hub_app', 'manufactura.firma_autorizaciones', 'DELETE')
      AND NOT has_column_privilege('daubert_hub_app', 'manufactura.firma_autorizaciones', 'usuario_id', 'UPDATE'))                                                          AS privilegios_autorizaciones,
    (has_table_privilege('daubert_hub_app', 'manufactura.revision_responsables', 'DELETE') AND NOT has_table_privilege('daubert_hub_app', 'manufactura.revision_responsables', 'TRUNCATE')) AS privilegios_responsables,
    NOT has_schema_privilege('daubert_hub_app', 'manufactura', 'CREATE')                                                       AS app_sin_ddl,
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
      ) FROM pg_roles b WHERE b.rolname = 'daubert_backup'), true) AS backup_solo_lectura,
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON true
                 WHERE n.nspname = 'manufactura' AND c.relname IN ('firmas','firma_autorizaciones','revision_responsables') AND NOT r.rolsuper AND r.rolname <> 'daubert_hub_app' AND r.rolname <> 'daubert_backup' AND r.rolname !~ '^pg_'
                   AND has_table_privilege(r.oid, c.oid, 'SELECT'))                                                                  AS ningun_otro_rol_con_acceso,
    ((SELECT h FROM base) = :'huella_101')                                                                                           AS tablas_de_la_101_sin_cambios
)
SELECT r.*, (ocho_tablas AND rls_en_las_8 AND diez_politicas_nuevas AND once_triggers_nuevos AND duenos_administrativos AND privilegios_firmas AND privilegios_autorizaciones AND privilegios_responsables
             AND app_sin_ddl AND ningun_otro_rol_con_acceso AND backup_solo_lectura AND tablas_de_la_101_sin_cambios) AS all_postchecks_pass FROM r;
ROLLBACK;
