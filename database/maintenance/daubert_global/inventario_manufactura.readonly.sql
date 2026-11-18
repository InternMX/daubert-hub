-- =====================================================================================================================
-- INVENTARIO DE SOLO LECTURA · preparación de Manufactura para producción
-- Se ejecuta MANUALMENTE y de forma idéntica en daubert_global (PROD) y en daubert_hub_test (TEST) para comparar los resultados sección por sección.
-- NO modifica nada: una sola transacción READ ONLY que termina en ROLLBACK; no lee contenido de tablas de negocio (solo conteos y catálogo del sistema); no imprime contraseñas ni claves.
--
--   psql -h localhost -p 5432 -d daubert_global    -U postgres -W -X -v ON_ERROR_STOP=1 -f inventario_manufactura.readonly.sql > inventario_PROD.txt
--   psql -h localhost -p 5432 -d daubert_hub_test  -U postgres -W -X -v ON_ERROR_STOP=1 -f inventario_manufactura.readonly.sql > inventario_TEST.txt
-- (Envíe ambos archivos. Cada sección termina con una huella md5 «H_…» para ver de un vistazo qué coincide y qué difiere.)
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\pset null '(nulo)'
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() NOT IN ('daubert_global', 'daubert_hub_test') THEN RAISE EXCEPTION 'ABORTO: solo daubert_global o daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: ejecútelo con el rol administrativo (para ver todo el catálogo).'; END IF;
END $$;

\echo '== S1. Sesión y servidor'
SELECT current_database() AS base, current_user AS rol, version() AS version, current_setting('server_version_num') AS version_num, current_setting('server_encoding') AS codificacion,
       current_setting('row_security') AS row_security, now() AS momento;

\echo '== S2. Roles del clúster (atributos; sin contraseñas)'
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin, rolinherit, rolconnlimit
  FROM pg_roles WHERE rolname IN ('postgres', 'daubert_hub_app', 'daubert_hub_test_user', 'n8n_app', 'n8n_cat_test', 'n8n_cat_prod', 'n8n_app_test', 'daubert_docs_ro') ORDER BY 1;
SELECT r.rolname AS rol, string_agg(g.rolname, ',' ORDER BY g.rolname) AS miembro_de
  FROM pg_roles r JOIN pg_auth_members m ON m.member = r.oid JOIN pg_roles g ON g.oid = m.roleid
 WHERE r.rolname IN ('daubert_hub_app', 'daubert_hub_test_user', 'n8n_app', 'n8n_cat_test', 'n8n_cat_prod', 'n8n_app_test', 'daubert_docs_ro') GROUP BY 1 ORDER BY 1;
SELECT rolname, array_to_string(setconfig, ' ; ') AS configuracion_por_rol_o_base
  FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database())) ORDER BY 1 NULLS FIRST;

\echo '== S3. Esquemas (propietario y ACL) y presencia de «manufactura»'
SELECT n.nspname AS esquema, pg_get_userbyid(n.nspowner) AS propietario, n.nspacl::text AS acl
  FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' ORDER BY 1;
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') AS existe_esquema_manufactura,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura') AS objetos_en_manufactura;

\echo '== S4. Objetos por esquema (conteos) y huella global del catálogo EXCLUYENDO manufactura'
SELECT n.nspname AS esquema, count(*) FILTER (WHERE c.relkind IN ('r', 'p')) AS tablas, count(*) FILTER (WHERE c.relkind = 'v') AS vistas, count(*) FILTER (WHERE c.relkind = 'S') AS secuencias,
       (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = n.oid) AS funciones, (SELECT count(*) FROM pg_trigger t JOIN pg_class tc ON tc.oid = t.tgrelid WHERE tc.relnamespace = n.oid AND NOT t.tgisinternal) AS triggers
  FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace = n.oid WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' GROUP BY n.oid, n.nspname ORDER BY 1;
SELECT 'H_ESTRUCTURA_SIN_MANUFACTURA' AS huella, md5(string_agg(x, '|' ORDER BY x)) AS md5 FROM (
  SELECT 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura') AND c.relkind IN ('r', 'p', 'v', 'S')
  UNION ALL SELECT 'col:' || table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns WHERE table_schema !~ '^pg_' AND table_schema NOT IN ('information_schema', 'manufactura')
  UNION ALL SELECT 'fn:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'manufactura')
) q;

\echo '== S5. Posibles CONFLICTOS de nombres con lo que crearía Manufactura (todo debe salir vacío en PROD antes de migrar)'
-- 5a. funciones con los nombres de las funciones de manufactura en cualquier OTRO esquema (no chocan por esquema, pero confunden y pueden sombrear con search_path)
SELECT n.nspname AS esquema, p.proname AS funcion FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname <> 'manufactura' AND (p.proname ~ '^fn_(actor|hash_revision|nombre_pdf|claves_validas|especificacion_valida|auditar_manufactura|inmutable|documentos_|revisiones_|pdfs_|pdf_contenidos_|confirmaciones_|firma|responsables_|sugerir_cliente|cliente_)' ) ORDER BY 1, 2;
-- 5b. tablas/vistas cuyo nombre coincide con las de manufactura en otros esquemas (staging.manufactura_* es esperado e informativo)
SELECT n.nspname AS esquema, c.relname AS objeto, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname <> 'manufactura' AND c.relkind IN ('r', 'p', 'v') AND (c.relname IN ('documentos', 'revisiones', 'pdfs', 'pdf_contenidos', 'confirmaciones_revision', 'firmas', 'firma_autorizaciones', 'revision_responsables', 'cliente_abreviaturas') OR c.relname ~ 'manufactura') ORDER BY 1, 2;
-- 5c. roles / esquemas / tipos llamados «manufactura»
SELECT 'rol' AS tipo, rolname AS nombre FROM pg_roles WHERE rolname ~ 'manufactura' UNION ALL SELECT 'tipo', typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'manufactura';

\echo '== S6. Dependencias que usa Manufactura: columnas requeridas (deben existir con estos tipos)'
SELECT table_schema || '.' || table_name AS tabla, column_name AS columna, data_type AS tipo, is_nullable AS admite_nulo
  FROM information_schema.columns
 WHERE (table_schema, table_name) IN (('security', 'users'), ('core', 'empresas'), ('core', 'empresa_roles'), ('audit', 'cambios'))
   AND column_name IN ('user_id', 'display_name', 'email', 'role', 'status', 'empresa_id', 'tipo_empresa', 'nombre_comercial', 'estatus', 'rol',
                       'cambio_id', 'fecha', 'esquema', 'tabla', 'registro_id', 'operacion', 'usuario_id', 'usuario_email', 'origen', 'request_id', 'datos_anteriores', 'datos_nuevos')
 ORDER BY 1, ordinal_position;
SELECT 'H_DEPENDENCIAS' AS huella, md5(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, '|' ORDER BY table_schema, table_name, column_name)) AS md5
  FROM information_schema.columns WHERE (table_schema, table_name) IN (('security', 'users'), ('core', 'empresas'), ('core', 'empresa_roles'), ('audit', 'cambios'), ('core', 'alias_empresa'));
SELECT n.nspname || '.' || p.proname AS funcion, p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS propietario, p.proconfig::text AS config,
       md5(replace(p.prosrc, E'\r', '')) AS md5_cuerpo_sin_cr
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'audit' ORDER BY 1;
SELECT n.nspname || '.' || c.relname AS tabla, pg_get_userbyid(c.relowner) AS propietario, c.relrowsecurity AS rls, c.relforcerowsecurity AS rls_forzada
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE (n.nspname, c.relname) IN (('security', 'users'), ('core', 'empresas'), ('core', 'empresa_roles'), ('core', 'alias_empresa'), ('audit', 'cambios')) ORDER BY 1;
SELECT t.tgname AS trigger_en_audit_cambios, pg_get_triggerdef(t.oid) AS definicion FROM pg_trigger t WHERE t.tgrelid = 'audit.cambios'::regclass AND NOT t.tgisinternal;
SELECT conname, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = 'security.users'::regclass AND contype = 'c' ORDER BY 1;

\echo '== S7. Privilegios actuales del rol de la aplicación sobre esas dependencias (S=SELECT I=INSERT U=UPDATE D=DELETE)'
SELECT r.rolname AS rol, t.tabla,
       CASE WHEN to_regclass(t.tabla) IS NULL THEN '(la tabla no existe)' ELSE
       (CASE WHEN has_table_privilege(r.oid, to_regclass(t.tabla), 'SELECT') THEN 'S' ELSE '-' END) || (CASE WHEN has_table_privilege(r.oid, to_regclass(t.tabla), 'INSERT') THEN 'I' ELSE '-' END) ||
       (CASE WHEN has_table_privilege(r.oid, to_regclass(t.tabla), 'UPDATE') THEN 'U' ELSE '-' END) || (CASE WHEN has_table_privilege(r.oid, to_regclass(t.tabla), 'DELETE') THEN 'D' ELSE '-' END) END AS privilegios
  FROM pg_roles r CROSS JOIN (VALUES ('security.users'), ('core.empresas'), ('core.empresa_roles'), ('core.alias_empresa'), ('audit.cambios')) AS t(tabla)
 WHERE r.rolname IN ('daubert_hub_app', 'daubert_hub_test_user') ORDER BY 1, 2;
SELECT r.rolname AS rol, n.nspname AS esquema, has_schema_privilege(r.oid, n.oid, 'USAGE') AS usage, has_schema_privilege(r.oid, n.oid, 'CREATE') AS create_
  FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname IN ('daubert_hub_app', 'n8n_app', 'daubert_docs_ro') AND n.nspname IN ('security', 'core', 'audit', 'ops', 'operacion', 'staging', 'public') ORDER BY 1, 2;
SELECT 'privilegio de base' AS item, r.rolname AS rol, has_database_privilege(r.oid, current_database(), 'CONNECT') AS connect, has_database_privilege(r.oid, current_database(), 'CREATE') AS create_
  FROM pg_roles r WHERE r.rolname IN ('daubert_hub_app', 'daubert_hub_test_user', 'n8n_app') ORDER BY 2;
SELECT pg_get_userbyid(d.defaclrole) AS creador, n.nspname AS esquema, d.defaclobjtype AS tipo, d.defaclacl::text AS privilegios_por_defecto
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace ORDER BY 1, 2, 3;

\echo '== S8. Datos de referencia (solo conteos): usuarios y clientes que Manufactura usaría'
SELECT role, status, count(*) AS cuentas FROM security.users GROUP BY 1, 2 ORDER BY 1, 2;
SELECT count(*) AS empresas, count(*) FILTER (WHERE estatus = 'ACTIVO') AS activas FROM core.empresas;
SELECT rol, estatus, count(*) AS filas FROM core.empresa_roles GROUP BY 1, 2 ORDER BY 1, 2;
SELECT esquema, count(*) AS filas_de_auditoria, pg_size_pretty(pg_total_relation_size('audit.cambios')) AS tamano_tabla_auditoria FROM audit.cambios GROUP BY 1 ORDER BY 2 DESC;

\echo '== S9. Mecanismos que podrían interferir con DDL o con la réplica'
SELECT evtname AS event_trigger, evtevent AS evento, evtenabled AS habilitado FROM pg_event_trigger ORDER BY 1;
SELECT pubname AS publicacion, puballtables FROM pg_publication ORDER BY 1;
SELECT extname AS extension, extversion FROM pg_extension ORDER BY 1;
SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'shared_buffers', 'work_mem', 'wal_level', 'archive_mode', 'default_transaction_read_only', 'idle_in_transaction_session_timeout', 'lock_timeout', 'statement_timeout') ORDER BY 1;
SELECT pg_size_pretty(pg_database_size(current_database())) AS tamano_base;

\echo '== S10. Conexiones actuales a la base (informativo; para elegir la ventana de aplicación)'
SELECT usename AS rol, coalesce(application_name, '') AS aplicacion, state AS estado, count(*) AS conexiones FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== S11. Respaldo: último contenido de pg_stat_database (informativo)'
SELECT datname, xact_commit, xact_rollback, stats_reset FROM pg_stat_database WHERE datname = current_database();
ROLLBACK;
