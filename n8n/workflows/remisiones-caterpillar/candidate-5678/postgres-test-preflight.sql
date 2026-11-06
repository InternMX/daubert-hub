-- PREPARED ONLY. Do not execute in this phase. READ ONLY, no business function is invoked.
-- Future operator-owned session settings: app.cat_test_company_id (approved bigint),
-- app.cat_test_series (approved comma-separated codes). Missing settings cannot pass policy.
-- This report NEVER lifts holds; each future mutation needs a same-connection identity guard.
BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION 'CAT_TEST_DATABASE_REQUIRED';
  END IF;
END $guard$;
WITH signatures(signature) AS (VALUES
  ('core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)'),
  ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)'),
  ('operacion.reservar_folios_para_ejecucion(bigint,text,integer)'),
  ('operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)'),
  ('ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)'),
  ('ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'),
  ('ops.fn_resolver_ejecucion_para_reproceso(bigint)')
), function_access AS (
  SELECT signature, to_regprocedure(signature) IS NOT NULL AS available,
    COALESCE(has_function_privilege(current_user,to_regprocedure(signature),'EXECUTE'),false) AS executable,
    (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid=to_regprocedure(signature)) AS owner,
    (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure(signature)) AS definition_fingerprint
  FROM signatures
), selected_series AS (
  SELECT s.serie_id, s.codigo, s.estatus
  FROM operacion.series_documentales s
  WHERE s.codigo=ANY(string_to_array(COALESCE(current_setting('app.cat_test_series',true),''),','))
), role_memberships AS (
  SELECT r.rolname, pg_has_role(current_user,r.oid,'USAGE') AS inherited,
    pg_has_role(current_user,r.oid,'MEMBER') AS member,
    pg_has_role(current_user,r.oid,'SET') AS can_set,
    r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls
  FROM pg_roles r
  WHERE pg_has_role(current_user,r.oid,'MEMBER') OR pg_has_role(current_user,r.oid,'USAGE')
    OR pg_has_role(current_user,r.oid,'SET')
), table_access AS (
  SELECT relation, has_table_privilege(current_user,relation,'SELECT') AS can_read,
    has_table_privilege(current_user,relation,'INSERT') AS can_insert,
    has_table_privilege(current_user,relation,'UPDATE') AS can_update,
    has_table_privilege(current_user,relation,'DELETE') AS can_delete,
    has_table_privilege(current_user,relation,'TRUNCATE,TRIGGER,REFERENCES') AS other_mutation,
    has_any_column_privilege(current_user,relation,'INSERT,UPDATE,REFERENCES') AS column_mutation
  FROM (VALUES ('core.documentos'),('core.empresas'),('ops.ejecuciones_automatizacion'),
    ('operacion.series_documentales'),('operacion.reservas_folios'),('operacion.remisiones'),
    ('operacion.remision_detalle'),('operacion.cancelaciones_remisiones')) x(relation)
), sequence_access AS (
  SELECT n.nspname||'.'||c.relname AS relation, pg_get_userbyid(c.relowner) AS owner,
    has_sequence_privilege(current_user,c.oid,'SELECT') AS can_read,
    has_sequence_privilege(current_user,c.oid,'USAGE') AS can_advance,
    has_sequence_privilege(current_user,c.oid,'UPDATE') AS can_set
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname IN ('core','ops','operacion')
), effective_privileges AS (
  SELECT jsonb_build_object(
    'memberships', (SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM role_memberships r),
    'functions', (SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM function_access f),
    'tables', (SELECT jsonb_agg(to_jsonb(t) ORDER BY relation) FROM table_access t),
    'sequences', (SELECT jsonb_agg(to_jsonb(s) ORDER BY relation) FROM sequence_access s),
    'schemaCreate', has_schema_privilege(current_user,'operacion','CREATE')
      OR has_schema_privilege(current_user,'ops','CREATE') OR has_schema_privilege(current_user,'core','CREATE')
      OR has_schema_privilege(current_user,'security','CREATE') OR has_schema_privilege(current_user,'public','CREATE')
  ) AS report
)
SELECT jsonb_build_object(
  'database', current_database(), 'user', current_user,
  'server', inet_server_addr()::text, 'port', inet_server_port(),
  'companyId', NULLIF(current_setting('app.cat_test_company_id',true),''),
  'companyActive', EXISTS(SELECT 1 FROM core.empresas WHERE empresa_id=
    NULLIF(current_setting('app.cat_test_company_id',true),'')::bigint AND estatus='ACTIVO'),
  'roleAdministrative', EXISTS(SELECT 1 FROM role_memberships WHERE
    rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls),
  'schemaCreate', (p.report->'schemaCreate'),
  'directBusinessWrites', EXISTS(SELECT 1 FROM table_access WHERE
    can_insert OR can_update OR can_delete OR other_mutation OR column_mutation),
  'functions', (SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM function_access f),
  'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',codigo,'id',serie_id::text,
    'active',estatus='ACTIVA') ORDER BY codigo) FROM selected_series),'[]'::jsonb),
  'reservationsConsistent', NOT EXISTS(SELECT 1 FROM operacion.reservas_folios r
    JOIN selected_series s USING(serie_id) WHERE r.folio_final<r.folio_inicial
      OR r.cantidad<>r.folio_final-r.folio_inicial+1),
  'effectivePrivileges', p.report, 'privilegeFingerprint', md5(p.report::text)
) AS test_identity_report
FROM effective_privileges p;
COMMIT;
