-- =====================================================================================================================
-- POSTCHECK · manufactura · gestor documental (SOLO TEST: daubert_hub_test)
-- SOLO LECTURA. Recibe la LÍNEA BASE del precheck con -v. Esperado: ALL_CHECKS_PASS = true.
--
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
--        -v baseline_users=<n> -v baseline_empresas=<n> -v baseline_audit_cambios=<n> \
--        -v baseline_tablas_fp=<md5> -v baseline_funciones_fp=<md5> -v baseline_columnas_fp=<md5> -v baseline_triggers_fp=<md5> \
--        -v baseline_privilegios_fp=<md5> -v baseline_roles_fp=<md5> -v baseline_acl_bases_fp=<md5> -v baseline_esquemas_acl_fp=<md5> \
--        -f 20261030_101_manufactura_gestor_documental_test.postcheck.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION 'ABORTO: este postcheck es solo para daubert_hub_test (base actual: %).', current_database();
  END IF;
END $$;

WITH
objetos AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura')                                                   AS esquema,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') = 5                                              AS cinco_tablas,
    (SELECT array_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname = 'manufactura')
      = ARRAY['confirmaciones_revision', 'documentos', 'pdf_contenidos', 'pdfs', 'revisiones']::name[]                  AS nombres_tablas,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'manufactura') = 15 AS quince_funciones,
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgname LIKE 'trg\_audit\_manufactura\_%') = 4          AS cuatro_triggers_auditoria,
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgname NOT LIKE 'trg\_audit\_%') = 11                 AS once_triggers_integridad,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'manufactura' AND indexname = 'uq_manufactura_revisiones_abierta') AS un_borrador_abierto_por_documento,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = 5                               AS rls_activa_en_5_tablas,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') = 11                                            AS once_politicas_rls,
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
                 WHERE n.nspname = 'manufactura' AND a.grantee = 0)                                                     AS public_sin_privilegios_en_objetos,
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, LATERAL aclexplode(p.proacl) a
                 WHERE n.nspname = 'manufactura' AND a.grantee = 0)                                                     AS public_sin_execute_en_funciones,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'manufactura'
       AND pg_get_userbyid(p.proowner) = (SELECT rolname FROM pg_roles WHERE oid = (SELECT nspowner FROM pg_namespace WHERE nspname = 'manufactura'))) = 15 AS funciones_del_mismo_dueno,
    -- una única función SECURITY DEFINER (la auditoría redactora), con search_path fijado, y los 4 triggers de auditoría la usan
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'manufactura' AND p.prosecdef) = 1
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'manufactura.fn_auditar_manufactura'::regproc AND p.prosecdef AND p.proconfig::text LIKE '%search_path%') AS una_sola_security_definer_fijada,
    (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\_audit\_manufactura\_%' AND t.tgfoid = 'manufactura.fn_auditar_manufactura'::regproc) = 4 AS auditoria_con_funcion_redactora,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_manufactura_documentos_codigo_variante')                    AS unico_codigo_variante,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_manufactura_revisiones_doc_revision')                       AS unica_revision_por_documento,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia')                         AS coherencia_estado,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND c.relkind = 'r'
       AND pg_get_userbyid(c.relowner) = (SELECT rolname FROM pg_roles WHERE oid = (SELECT nspowner FROM pg_namespace WHERE nspname = 'manufactura'))) = 5 AS dueno_unico,
    (SELECT rolsuper FROM pg_roles WHERE oid = (SELECT nspowner FROM pg_namespace WHERE nspname = 'manufactura'))      AS esquema_de_administrador
),
vacio AS (
  SELECT (SELECT count(*) FROM manufactura.documentos) = 0 AND (SELECT count(*) FROM manufactura.revisiones) = 0
     AND (SELECT count(*) FROM manufactura.pdfs) = 0 AND (SELECT count(*) FROM manufactura.pdf_contenidos) = 0
     AND (SELECT count(*) FROM manufactura.confirmaciones_revision) = 0 AS tablas_vacias_o_con_datos_de_prueba_esperados
),
permisos AS (
  SELECT
    has_schema_privilege('daubert_hub_test_user', 'manufactura', 'USAGE')                                              AS app_usage,
    NOT has_schema_privilege('daubert_hub_test_user', 'manufactura', 'CREATE')                                         AS app_sin_create_esquema,
    NOT has_database_privilege('daubert_hub_test_user', current_database(), 'CREATE')                                  AS app_sin_create_base,
    -- matriz exacta de privilegios de datos
    has_table_privilege('daubert_hub_test_user', 'manufactura.documentos', 'SELECT') AND has_table_privilege('daubert_hub_test_user', 'manufactura.documentos', 'INSERT')
      AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.documentos', 'UPDATE') AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.documentos', 'DELETE') AS permisos_documentos,
    has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'SELECT') AND has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'INSERT')
      AND has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'UPDATE') AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'DELETE')
      AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'TRUNCATE')                      AS permisos_revisiones,
    (SELECT bool_and(has_table_privilege('daubert_hub_test_user', 'manufactura.' || t, 'SELECT') AND has_table_privilege('daubert_hub_test_user', 'manufactura.' || t, 'INSERT')
        AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.' || t, 'UPDATE') AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.' || t, 'DELETE')
        AND NOT has_table_privilege('daubert_hub_test_user', 'manufactura.' || t, 'TRUNCATE'))
       FROM unnest(ARRAY['pdfs', 'pdf_contenidos', 'confirmaciones_revision']) AS t)                                  AS permisos_pdfs_confirmaciones,
    -- nadie más accede: ni PUBLIC ni los roles de n8n / backup / lectura de documentos / producción
    (SELECT bool_and(NOT has_schema_privilege(r.rolname, 'manufactura', 'USAGE'))
       FROM pg_roles r WHERE r.rolname IN ('daubert_hub_app', 'n8n_app', 'n8n_app_test', 'n8n_cat_prod', 'n8n_cat_test', 'daubert_docs_ro', 'daubert_backup')) AS otros_roles_sin_acceso,
    NOT has_schema_privilege('public', 'manufactura', 'USAGE')                                                         AS public_sin_acceso
),
sin_cambios AS (
  SELECT
    (SELECT count(*) FROM security.users) = :baseline_users                                                            AS usuarios_igual,
    (SELECT count(*) FROM core.empresas) = :baseline_empresas                                                          AS empresas_igual,
    (SELECT count(*) FROM audit.cambios) = :baseline_audit_cambios                                                     AS audit_cambios_igual,
    (SELECT md5(string_agg(table_schema || '.' || table_name, ',' ORDER BY table_schema, table_name))
       FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'manufactura')) = :'baseline_tablas_fp' AS tablas_existentes_igual,
    (SELECT md5(string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)), ',' ORDER BY p.oid::regprocedure::text))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('audit', 'core', 'security', 'ops', 'operacion')) = :'baseline_funciones_fp' AS funciones_existentes_igual,
    (SELECT md5(string_agg(c.table_schema || '.' || c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || COALESCE(c.column_default, ''), ',' ORDER BY c.table_schema, c.table_name, c.ordinal_position))
       FROM information_schema.columns c WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'manufactura')) = :'baseline_columnas_fp' AS columnas_existentes_igual,
    (SELECT md5(COALESCE(string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid), ',' ORDER BY n.nspname, c.relname, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname <> 'manufactura') = :'baseline_triggers_fp' AS triggers_existentes_igual,
    (SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || COALESCE(c.relacl::text, '') || ':' || pg_get_userbyid(c.relowner), ',' ORDER BY n.nspname, c.relname))
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'manufactura') AND c.relkind IN ('r', 'v', 'm', 'S', 'p')) = :'baseline_privilegios_fp' AS privilegios_y_duenos_existentes_igual,
    (SELECT md5(string_agg(rolname || ':' || rolsuper::text || rolcreatedb::text || rolcreaterole::text || rolcanlogin::text || rolbypassrls::text || rolconnlimit::text, ',' ORDER BY rolname)) FROM pg_roles WHERE rolname !~ '^pg_') = :'baseline_roles_fp' AS roles_igual,
    (SELECT md5(string_agg(datname || ':' || COALESCE(datacl::text, ''), ',' ORDER BY datname)) FROM pg_database) = :'baseline_acl_bases_fp' AS acl_de_bases_igual_sin_cambios_de_connect,
    (SELECT md5(string_agg(n.nspname || ':' || COALESCE(n.nspacl::text, ''), ',' ORDER BY n.nspname)) FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'manufactura')) = :'baseline_esquemas_acl_fp' AS acl_de_esquemas_igual
)
SELECT o.*, v.*, p.*, s.*,
  (o.esquema AND o.cinco_tablas AND o.nombres_tablas AND o.quince_funciones AND o.rls_activa_en_5_tablas AND o.once_politicas_rls AND o.public_sin_privilegios_en_objetos AND o.public_sin_execute_en_funciones AND o.funciones_del_mismo_dueno AND o.una_sola_security_definer_fijada AND o.auditoria_con_funcion_redactora AND o.cuatro_triggers_auditoria AND o.once_triggers_integridad AND o.un_borrador_abierto_por_documento
   AND o.unico_codigo_variante AND o.unica_revision_por_documento AND o.coherencia_estado AND o.dueno_unico AND o.esquema_de_administrador
   AND v.tablas_vacias_o_con_datos_de_prueba_esperados
   AND p.app_usage AND p.app_sin_create_esquema AND p.app_sin_create_base AND p.permisos_documentos AND p.permisos_revisiones AND p.permisos_pdfs_confirmaciones
   AND p.otros_roles_sin_acceso AND p.public_sin_acceso
   AND s.usuarios_igual AND s.empresas_igual AND s.audit_cambios_igual AND s.tablas_existentes_igual AND s.funciones_existentes_igual
   AND s.columnas_existentes_igual AND s.triggers_existentes_igual AND s.privilegios_y_duenos_existentes_igual AND s.roles_igual AND s.acl_de_bases_igual_sin_cambios_de_connect AND s.acl_de_esquemas_igual) AS all_checks_pass
FROM objetos o, vacio v, permisos p, sin_cambios s;

ROLLBACK;
