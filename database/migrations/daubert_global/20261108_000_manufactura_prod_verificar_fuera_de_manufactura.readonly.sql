-- =====================================================================================================================
-- VERIFICACIÓN TRANSVERSAL · Manufactura en PRODUCCIÓN (012–016) · SOLO LECTURA (una transacción READ ONLY que termina en ROLLBACK). Solo daubert_global.
--
-- Hace DOS cosas con el MISMO script:
--   1) CAPTURA (sin -v):  imprime la LÍNEA BASE del catálogo de TODO lo que NO es Manufactura: relaciones (dueño, ACL, RLS), columnas, ACL de columnas, restricciones, índices, funciones (cuerpo, dueño,
--      SECURITY DEFINER, config, ACL), triggers, políticas RLS, esquemas (dueño y ACL), roles (atributos, membresías, configuración), ACL de bases, privilegios por defecto y extensiones.
--   2) COMPARACIÓN (con -v f_*=…, -v nivel=NN): comprueba que esa línea base NO cambió y, si el esquema manufactura existe, la MATRIZ DE PRIVILEGIOS: los roles n8n_app, n8n_cat_prod, n8n_cat_test,
--      n8n_app_test, daubert_docs_ro, daubert_hub_test_user, daubert_backup y PUBLIC no tienen NINGÚN privilegio (esquema, tablas, columnas, secuencias, funciones) y daubert_hub_app tiene EXACTAMENTE
--      los privilegios previstos para el nivel de migración aplicado (sin DELETE ni TRUNCATE salvo revision_responsables, sin DDL, sin privilegios sobre secuencias).
--
--   Captura:      psql -h localhost -p 5432 -d daubert_global -U postgres -W -X -v ON_ERROR_STOP=1 -f 20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql
--   Comparación:  (copie la línea «comando_comparacion» que imprime la captura; añada -v nivel=12|13|14|15|16 según la última migración aplicada)
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\pset null '(nulo)'
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
END $$;

WITH
 rel AS (SELECT md5(coalesce(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(c.reloptions::text, ''), '|' ORDER BY n.nspname, c.relname), '')) AS h
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura') AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')),
 col AS (SELECT md5(coalesce(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') || ':' || is_identity || ':' || coalesce(generation_expression, ''), '|' ORDER BY table_schema, table_name, column_name), '')) AS h
           FROM information_schema.columns WHERE table_schema !~ '^pg_' AND table_schema NOT IN ('information_schema', 'manufactura')),
 acol AS (SELECT md5(coalesce(string_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || a.attacl::text, '|' ORDER BY n.nspname, c.relname, a.attname), '')) AS h
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE a.attacl IS NOT NULL AND NOT a.attisdropped AND n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')),
 con AS (SELECT md5(coalesce(string_agg(n.nspname || '.' || c.relname || ':' || k.conname || ':' || k.contype::text || ':' || pg_get_constraintdef(k.oid), '|' ORDER BY n.nspname, c.relname, k.conname), '')) AS h
           FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')),
 idx AS (SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || indexname || ':' || indexdef, '|' ORDER BY schemaname, tablename, indexname), '')) AS h FROM pg_indexes WHERE schemaname !~ '^pg_' AND schemaname NOT IN ('information_schema', 'manufactura')),
 fn  AS (SELECT md5(coalesce(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(p.proconfig::text, '') || ':' || coalesce(p.proacl::text, '') || ':' || md5(replace(p.prosrc, E'\r', '')), '|' ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '')) AS h
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')),
 trg AS (SELECT md5(coalesce(string_agg(n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), '|' ORDER BY n.nspname, c.relname, t.tgname), '')) AS h
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')),
 pol AS (SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY schemaname, tablename, policyname), '')) AS h FROM pg_policies WHERE schemaname <> 'manufactura'),
 nsp AS (SELECT md5(coalesce(string_agg(n.nspname || ':' || pg_get_userbyid(n.nspowner) || ':' || coalesce(n.nspacl::text, ''), '|' ORDER BY n.nspname), '')) AS h FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')),
 rol AS (SELECT md5(coalesce(string_agg(r.rolname || ':' || r.rolsuper::text || r.rolinherit::text || r.rolcreaterole::text || r.rolcreatedb::text || r.rolcanlogin::text || r.rolreplication::text || r.rolbypassrls::text || r.rolconnlimit::text || ':' || coalesce((SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), ''), '|' ORDER BY r.rolname), '')) AS h
           FROM pg_roles r WHERE r.rolname !~ '^pg_'),
 rset AS (SELECT md5(coalesce(string_agg(coalesce(r.rolname, '*') || ':' || s.setdatabase::text || ':' || array_to_string(s.setconfig, ';'), '|' ORDER BY coalesce(r.rolname, '*'), s.setdatabase), '')) AS h FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole),
 dbs AS (SELECT md5(coalesce(string_agg(datname || ':' || pg_get_userbyid(datdba) || ':' || coalesce(datacl::text, ''), '|' ORDER BY datname), '')) AS h FROM pg_database),
 dac AS (SELECT md5(coalesce(string_agg(pg_get_userbyid(d.defaclrole) || ':' || coalesce(n.nspname, '*') || ':' || d.defaclobjtype::text || ':' || d.defaclacl::text, '|' ORDER BY 1), '')) AS h FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace),
 ext AS (SELECT md5(coalesce(string_agg(extname || ':' || extversion, '|' ORDER BY extname), '')) AS h FROM pg_extension)
SELECT rel.h AS f_rel, col.h AS f_col, acol.h AS f_acol, con.h AS f_con, idx.h AS f_idx, fn.h AS f_fn, trg.h AS f_trg, pol.h AS f_pol, nsp.h AS f_nsp, rol.h AS f_rol, rset.h AS f_rset, dbs.h AS f_dbs, dac.h AS f_dac, ext.h AS f_ext
  FROM rel, col, acol, con, idx, fn, trg, pol, nsp, rol, rset, dbs, dac, ext
\gset cur_

\if :{?f_rel}
  \echo '== COMPARACIÓN (nivel :nivel): todo lo que NO es Manufactura debe seguir IDÉNTICO; los demás roles sin NINGÚN privilegio; daubert_hub_app con la matriz exacta'
  \if :{?nivel}
  \else
    \set nivel 16
  \endif
  WITH
   _esperado AS (SELECT * FROM (VALUES
    -- (nivel, objeto, privilegios de tabla de daubert_hub_app, columnas con UPDATE)
    (12, 'documentos', 'INSERT,SELECT', ''), (12, 'revisiones', 'INSERT,SELECT,UPDATE', ''), (12, 'pdfs', 'INSERT,SELECT', ''), (12, 'pdf_contenidos', 'INSERT,SELECT', ''), (12, 'confirmaciones_revision', 'INSERT,SELECT', ''),
    (13, 'firmas', 'INSERT,SELECT', 'estado,retirada_en'), (13, 'firma_autorizaciones', 'INSERT,SELECT', 'revocada_en,revocada_por_usuario_id'), (13, 'revision_responsables', 'DELETE,INSERT,SELECT,UPDATE', ''),
    (15, 'cliente_abreviaturas', 'INSERT,SELECT', 'codigos_evidencia,documentos_evidencia,estado,evidencia,fuente,motivo_resolucion,resuelta_en,resuelta_por_email,resuelta_por_usuario_id,updated_at')
  ) AS t(nivel, tabla, privilegios, columnas_update)),
   _funciones_app AS (SELECT * FROM (VALUES
    (12, 'fn_actor()'), (12, 'fn_actor_id()'), (12, 'fn_actor_es_admin()'), (12, 'fn_hash_revision(text,jsonb)'), (12, 'fn_nombre_pdf(text,text,integer)'), (12, 'fn_especificacion_valida(jsonb)'), (12, 'fn_claves_validas(jsonb)'),
    (13, 'fn_firma_autorizada_a(bigint,bigint)'), (13, 'fn_firma_propietario(bigint)'), (13, 'fn_firma_utilizable(bigint,bigint)'),
    (14, 'fn_firmas_inventario(bigint,boolean)'),
    (15, 'fn_sugerir_cliente(text,boolean)'), (15, 'fn_cliente_vigente(bigint)')
  ) AS t(nivel, firma)),
   igual AS (SELECT
     :'cur_f_rel' = :'f_rel' AS relaciones_y_acl_igual, :'cur_f_col' = :'f_col' AS columnas_igual, :'cur_f_acol' = :'f_acol' AS acl_de_columnas_igual,
     :'cur_f_con' = :'f_con' AS restricciones_igual, :'cur_f_idx' = :'f_idx' AS indices_igual, :'cur_f_fn' = :'f_fn' AS funciones_y_acl_igual,
     :'cur_f_trg' = :'f_trg' AS triggers_igual, :'cur_f_pol' = :'f_pol' AS politicas_rls_igual, :'cur_f_nsp' = :'f_nsp' AS esquemas_y_acl_igual,
     :'cur_f_rol' = :'f_rol' AS roles_igual, :'cur_f_rset' = :'f_rset' AS config_de_roles_igual, :'cur_f_dbs' = :'f_dbs' AS acl_de_bases_igual,
     :'cur_f_dac' = :'f_dac' AS privilegios_por_defecto_igual, :'cur_f_ext' = :'f_ext' AS extensiones_igual),
   hay AS (SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') AS esquema),
   -- ACL del esquema manufactura excluyendo al dueño y a daubert_hub_app: debe estar VACÍA (esto cubre n8n_*, daubert_docs_ro, daubert_hub_test_user, daubert_backup, PUBLIC y cualquier rol desconocido)
   ajenos AS (
     SELECT count(*) AS n FROM (
       SELECT a.grantee FROM pg_namespace s, LATERAL aclexplode(s.nspacl) a WHERE s.nspname = 'manufactura'
       UNION ALL SELECT a.grantee FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a WHERE s.nspname = 'manufactura'
       UNION ALL SELECT a.grantee FROM pg_attribute t JOIN pg_class c ON c.oid = t.attrelid JOIN pg_namespace s ON s.oid = c.relnamespace, LATERAL aclexplode(t.attacl) a WHERE s.nspname = 'manufactura'
       UNION ALL SELECT a.grantee FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace, LATERAL aclexplode(p.proacl) a WHERE s.nspname = 'manufactura'
     ) x WHERE x.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('postgres', 'daubert_hub_app')) AND x.grantee <> (SELECT nspowner FROM pg_namespace WHERE nspname = 'manufactura')),
   nombrados AS (
     SELECT NOT EXISTS (
       SELECT 1 FROM pg_roles r, pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = 'manufactura' AND c.relkind IN ('r', 'S') AND r.rolname IN ('n8n_app', 'n8n_cat_prod', 'n8n_cat_test', 'n8n_app_test', 'daubert_docs_ro', 'daubert_hub_test_user', 'daubert_backup')
          AND (has_table_privilege(r.oid, c.oid, 'SELECT') OR has_table_privilege(r.oid, c.oid, 'INSERT') OR has_table_privilege(r.oid, c.oid, 'UPDATE') OR has_table_privilege(r.oid, c.oid, 'DELETE')
               OR has_table_privilege(r.oid, c.oid, 'TRUNCATE') OR has_table_privilege(r.oid, c.oid, 'REFERENCES') OR has_table_privilege(r.oid, c.oid, 'TRIGGER'))
     ) AND NOT EXISTS (
       SELECT 1 FROM pg_roles r WHERE r.rolname IN ('n8n_app', 'n8n_cat_prod', 'n8n_cat_test', 'n8n_app_test', 'daubert_docs_ro', 'daubert_hub_test_user', 'daubert_backup')
          AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') AND (has_schema_privilege(r.oid, 'manufactura', 'USAGE') OR has_schema_privilege(r.oid, 'manufactura', 'CREATE'))
     ) AS roles_nombrados_sin_acceso,
     NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') OR (NOT has_schema_privilege('public', 'manufactura', 'USAGE') AND NOT has_schema_privilege('public', 'manufactura', 'CREATE')) AS public_sin_acceso_al_esquema),
   app AS (
     SELECT
       -- tabla por tabla: exactamente los privilegios previstos para el nivel aplicado
       NOT EXISTS (SELECT 1 FROM _esperado e WHERE e.nivel <= :nivel AND to_regclass('manufactura.' || e.tabla) IS NULL)                                  AS tablas_esperadas_existen,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'manufactura' AND c.relkind = 'r'
                    AND c.relname NOT IN (SELECT tabla FROM _esperado WHERE nivel <= :nivel))                                                              AS sin_tablas_de_mas,
       NOT EXISTS (SELECT 1 FROM _esperado e WHERE e.nivel <= :nivel AND to_regclass('manufactura.' || e.tabla) IS NOT NULL AND
                    coalesce((SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) FROM pg_class c, LATERAL aclexplode(c.relacl) a
                               WHERE c.oid = to_regclass('manufactura.' || e.tabla) AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'daubert_hub_app')), '') <> e.privilegios) AS privilegios_de_tabla_exactos,
       NOT EXISTS (SELECT 1 FROM _esperado e WHERE e.nivel <= :nivel AND to_regclass('manufactura.' || e.tabla) IS NOT NULL AND
                    coalesce((SELECT string_agg(t.attname, ',' ORDER BY t.attname) FROM pg_attribute t, LATERAL aclexplode(t.attacl) a
                               WHERE t.attrelid = to_regclass('manufactura.' || e.tabla) AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'daubert_hub_app') AND a.privilege_type = 'UPDATE'), '') <> e.columnas_update) AS update_solo_en_columnas_previstas,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
                    WHERE s.nspname = 'manufactura' AND c.relkind = 'S' AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'daubert_hub_app'))        AS sin_privilegios_sobre_secuencias,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
                    WHERE s.nspname = 'manufactura' AND c.relkind = 'r' AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'daubert_hub_app') AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS sin_truncate_references_trigger,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
                    WHERE s.nspname = 'manufactura' AND c.relkind = 'r' AND c.relname <> 'revision_responsables' AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'daubert_hub_app') AND a.privilege_type = 'DELETE') AS delete_solo_en_responsables,
       coalesce((SELECT string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace, LATERAL aclexplode(p.proacl) a
                  WHERE s.nspname = 'manufactura' AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'daubert_hub_app') AND a.privilege_type = 'EXECUTE'), '')
         = coalesce((SELECT string_agg('manufactura.' || firma, ',' ORDER BY 'manufactura.' || firma) FROM _funciones_app WHERE nivel <= :nivel), '')                                                       AS execute_solo_en_funciones_previstas,
       NOT has_schema_privilege('daubert_hub_app', 'manufactura', 'CREATE') AND has_schema_privilege('daubert_hub_app', 'manufactura', 'USAGE')                                                              AS esquema_usage_sin_create,
       NOT (SELECT rolbypassrls OR rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = 'daubert_hub_app')                                                                                   AS app_sin_atributos_peligrosos,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'manufactura' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = 'daubert_hub_app')            AS app_no_es_duena,
       NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity)                                                                                                             AS toda_tabla_con_rls
   )
  SELECT i.*, CASE WHEN h.esquema THEN a.n = 0 ELSE true END AS acl_del_esquema_sin_roles_ajenos, n.*,
         CASE WHEN h.esquema THEN (p.tablas_esperadas_existen AND p.sin_tablas_de_mas AND p.privilegios_de_tabla_exactos AND p.update_solo_en_columnas_previstas AND p.sin_privilegios_sobre_secuencias AND p.sin_truncate_references_trigger
                                   AND p.delete_solo_en_responsables AND p.execute_solo_en_funciones_previstas AND p.esquema_usage_sin_create AND p.app_sin_atributos_peligrosos AND p.app_no_es_duena AND p.toda_tabla_con_rls) ELSE true END AS matriz_de_daubert_hub_app_exacta,
         (i.relaciones_y_acl_igual AND i.columnas_igual AND i.acl_de_columnas_igual AND i.restricciones_igual AND i.indices_igual AND i.funciones_y_acl_igual AND i.triggers_igual AND i.politicas_rls_igual AND i.esquemas_y_acl_igual
          AND i.roles_igual AND i.config_de_roles_igual AND i.acl_de_bases_igual AND i.privilegios_por_defecto_igual AND i.extensiones_igual
          AND CASE WHEN h.esquema THEN a.n = 0 AND n.roles_nombrados_sin_acceso AND n.public_sin_acceso_al_esquema AND p.tablas_esperadas_existen AND p.sin_tablas_de_mas AND p.privilegios_de_tabla_exactos AND p.update_solo_en_columnas_previstas
                                       AND p.sin_privilegios_sobre_secuencias AND p.sin_truncate_references_trigger AND p.delete_solo_en_responsables AND p.execute_solo_en_funciones_previstas AND p.esquema_usage_sin_create
                                       AND p.app_sin_atributos_peligrosos AND p.app_no_es_duena AND p.toda_tabla_con_rls ELSE true END) AS all_checks_pass
    FROM igual i, hay h, ajenos a, nombrados n, app p;
\else
  \echo '== CAPTURA DE LA LÍNEA BASE (todo lo que NO es Manufactura). Guarde esta salida junto con el respaldo.'
  SELECT :'cur_f_rel' AS f_rel, :'cur_f_col' AS f_col, :'cur_f_acol' AS f_acol, :'cur_f_con' AS f_con, :'cur_f_idx' AS f_idx, :'cur_f_fn' AS f_fn, :'cur_f_trg' AS f_trg, :'cur_f_pol' AS f_pol, :'cur_f_nsp' AS f_nsp, :'cur_f_rol' AS f_rol, :'cur_f_rset' AS f_rset, :'cur_f_dbs' AS f_dbs, :'cur_f_dac' AS f_dac, :'cur_f_ext' AS f_ext;
  SELECT format(E'psql -h localhost -p 5432 -d daubert_global -U postgres -W -X -v ON_ERROR_STOP=1 -v nivel=NN -v f_rel=%s -v f_col=%s -v f_acol=%s -v f_con=%s -v f_idx=%s -v f_fn=%s -v f_trg=%s -v f_pol=%s -v f_nsp=%s -v f_rol=%s -v f_rset=%s -v f_dbs=%s -v f_dac=%s -v f_ext=%s -f 20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql',
         :'cur_f_rel', :'cur_f_col', :'cur_f_acol', :'cur_f_con', :'cur_f_idx', :'cur_f_fn', :'cur_f_trg', :'cur_f_pol', :'cur_f_nsp', :'cur_f_rol', :'cur_f_rset', :'cur_f_dbs', :'cur_f_dac', :'cur_f_ext') AS comando_comparacion;
\endif
ROLLBACK;
