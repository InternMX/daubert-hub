-- READ ONLY. 015 is the next local number; confirm external allocation before any application.
BEGIN READ ONLY;
DO $precheck$
DECLARE t text; f text;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '015 requires postgres exclusively in TEST'; END IF;
  IF current_setting('server_version_num')::int<180000 OR current_setting('server_encoding')<>'UTF8'
    OR NOT EXISTS(SELECT 1 FROM pg_collation WHERE collname='pg_unicode_fast' AND collnamespace='pg_catalog'::regnamespace) THEN RAISE EXCEPTION '015 requires PostgreSQL 18 UTF8 Unicode collation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission' AND atttypid='jsonb'::regtype AND NOT attisdropped) THEN RAISE EXCEPTION '015 requires 014'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_test' AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN RAISE EXCEPTION '015 unsafe/missing TEST role'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>'n8n_cat_test' AND (pg_has_role('n8n_cat_test',oid,'MEMBER') OR pg_has_role('n8n_cat_test',oid,'SET'))) THEN RAISE EXCEPTION '015 dedicated role membership requires review'; END IF;
  FOREACH t IN ARRAY ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones','operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales'] LOOP
    IF has_table_privilege('n8n_cat_test',t,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege('n8n_cat_test',t,'INSERT,UPDATE') THEN RAISE EXCEPTION '015 direct DML bypass'; END IF;
  END LOOP;
  IF has_schema_privilege('n8n_cat_test','core','CREATE') OR has_schema_privilege('n8n_cat_test','ops','CREATE') OR has_schema_privilege('n8n_cat_test','operacion','CREATE') OR has_schema_privilege('n8n_cat_test','public','CREATE') THEN RAISE EXCEPTION '015 unsafe schema CREATE'; END IF;
  IF NOT has_schema_privilege('n8n_cat_test','core','USAGE') OR NOT has_schema_privilege('n8n_cat_test','ops','USAGE') OR NOT has_schema_privilege('n8n_cat_test','operacion','USAGE') THEN RAISE EXCEPTION '015 missing schema USAGE'; END IF;
  FOREACH f IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
    'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid=to_regprocedure(f)
      AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='n8n_cat_test')
      AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable) THEN RAISE EXCEPTION '015 missing/review-required legacy contract'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','TABLE(ejecucion_id bigint, ya_existia boolean, motivo text)'),
    ('operacion.reservar_folios_para_ejecucion(bigint,text,integer)','TABLE(reserva_id bigint, folio_inicial bigint, folio_final bigint, cantidad integer)'),
    ('operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','TABLE(remision_id bigint, ya_existia boolean)'),
    ('ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','TABLE(ejecucion_id bigint, ya_estaba_finalizada boolean, estado_final text, reservas_aplicadas integer, reservas_abandonadas integer)'),
    ('ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)','TABLE(ejecucion_id bigint, ya_registrado boolean, intentos_fallidos integer, max_intentos integer, error_final boolean, estado_actual text, reservas_abandonadas integer)')
  ) expected(signature,result_type) WHERE pg_get_function_result(to_regprocedure(expected.signature)) IS DISTINCT FROM expected.result_type) THEN
    RAISE EXCEPTION '015 legacy result contract drift'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('ops','operacion') AND p.proname=ANY(ARRAY[
    'fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar_test','fn_registrar_remision_caterpillar_test','fn_finalizar_caterpillar_test','fn_fallo_caterpillar_test'])) THEN RAISE EXCEPTION '015 objects already exist'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE a.codigo='REMISIONES_CATERPILLAR'
    AND(e.estado='PROCESANDO' OR d.caterpillar_admission IS NOT NULL)) THEN RAISE EXCEPTION '015 reviewed idle cutover required'; END IF;
END $precheck$;
SELECT 'PRECHECK_015_PASS' AS result;
SELECT p.oid::regprocedure::text AS legacy_function,pg_get_function_result(p.oid) AS result_contract,md5(replace(p.prosrc,chr(13),'')) AS body_fingerprint
FROM pg_proc p WHERE p.oid=ANY(ARRAY[
  'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)'::regprocedure,
  'operacion.reservar_folios_para_ejecucion(bigint,text,integer)'::regprocedure,
  'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)'::regprocedure,
  'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)'::regprocedure,
  'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'::regprocedure]);
COMMIT;
