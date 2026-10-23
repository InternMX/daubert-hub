-- READ ONLY. 015 is the next local number; confirm external allocation before any application.
BEGIN READ ONLY;
DO $precheck$
DECLARE t text; f text;
BEGIN
  IF current_database()<>'daubert_global' OR current_user<>'postgres' THEN RAISE EXCEPTION '016 requires postgres exclusively in daubert_global'; END IF;
  IF current_setting('server_version_num')::int<180000 OR current_setting('server_encoding')<>'UTF8'
    OR NOT EXISTS(SELECT 1 FROM pg_collation WHERE collname='pg_unicode_fast' AND collnamespace='pg_catalog'::regnamespace) THEN RAISE EXCEPTION '016 requires PostgreSQL 18 UTF8 Unicode collation'; END IF;
  IF to_regclass('core.documentos') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('core.documentos') AND relkind='r' AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('core.documentos') AND attname='caterpillar_admission' AND NOT attisdropped) THEN
    RAISE EXCEPTION '016 requires core.documentos owned by postgres without the snapshot column (use postcheck if already applied)'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_prod' AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN RAISE EXCEPTION '016 unsafe/missing production role'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>'n8n_cat_prod' AND (pg_has_role('n8n_cat_prod',oid,'MEMBER') OR pg_has_role('n8n_cat_prod',oid,'SET'))) THEN RAISE EXCEPTION '016 dedicated role membership requires review'; END IF;
  FOREACH t IN ARRAY ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones','operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales'] LOOP
    IF has_table_privilege('n8n_cat_prod',t,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege('n8n_cat_prod',t,'INSERT,UPDATE') THEN RAISE EXCEPTION '016 direct DML bypass'; END IF;
  END LOOP;
  IF has_schema_privilege('n8n_cat_prod','core','CREATE') OR has_schema_privilege('n8n_cat_prod','ops','CREATE') OR has_schema_privilege('n8n_cat_prod','operacion','CREATE') OR has_schema_privilege('n8n_cat_prod','public','CREATE') THEN RAISE EXCEPTION '016 unsafe schema CREATE'; END IF;
  IF NOT has_schema_privilege('n8n_cat_prod','core','USAGE') OR NOT has_schema_privilege('n8n_cat_prod','ops','USAGE') OR NOT has_schema_privilege('n8n_cat_prod','operacion','USAGE') THEN RAISE EXCEPTION '016 missing schema USAGE'; END IF;
  FOREACH f IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
    'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    IF to_regprocedure(f) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f) AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION '016 missing/review-required legacy contract'; END IF;
    IF has_function_privilege('n8n_cat_prod',to_regprocedure(f),'EXECUTE') THEN RAISE EXCEPTION '016 dedicated role must not hold legacy EXECUTE (direct, PUBLIC or membership)'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','TABLE(ejecucion_id bigint, ya_existia boolean, motivo text)'),
    ('operacion.reservar_folios_para_ejecucion(bigint,text,integer)','TABLE(reserva_id bigint, folio_inicial bigint, folio_final bigint, cantidad integer)'),
    ('operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','TABLE(remision_id bigint, ya_existia boolean)'),
    ('ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','TABLE(ejecucion_id bigint, ya_estaba_finalizada boolean, estado_final text, reservas_aplicadas integer, reservas_abandonadas integer)'),
    ('ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)','TABLE(ejecucion_id bigint, ya_registrado boolean, intentos_fallidos integer, max_intentos integer, error_final boolean, estado_actual text, reservas_abandonadas integer)')
  ) expected(signature,result_type) WHERE pg_get_function_result(to_regprocedure(expected.signature)) IS DISTINCT FROM expected.result_type) THEN
    RAISE EXCEPTION '016 legacy result contract drift'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('ops','operacion') AND p.proname=ANY(ARRAY[
    'fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar','fn_reprocesar_reservar_caterpillar','fn_guardar_snapshot_caterpillar','fn_registrar_remision_caterpillar','fn_finalizar_caterpillar','fn_fallo_caterpillar'])) THEN RAISE EXCEPTION '016 objects already exist'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE a.codigo='REMISIONES_CATERPILLAR'
    AND e.estado='PROCESANDO') THEN RAISE EXCEPTION '016 reviewed idle cutover required: no PROCESANDO Caterpillar execution'; END IF;
  IF EXISTS(SELECT 1 FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND (d.nombre_archivo ~ '[\\/:*?"<>|[:cntrl:]]' OR upper(btrim(d.nombre_archivo)) !~ '\.(XLSX|XLSM|XLS)$')) THEN
    RAISE EXCEPTION '016 historical Caterpillar document names cannot be verified by the gate; every admission would be REVIEW (HISTORY_UNAVAILABLE)'; END IF;
  IF to_regclass('operacion.cancelaciones_remisiones') IS NULL OR to_regprocedure('operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION '016 requires the individual cancellation ledger (migration 013) because regeneration is defined on formally cancelled remissions'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='daubert_hub_app') THEN RAISE EXCEPTION '016 requires the Hub runtime role'; END IF;
  IF to_regclass('operacion.autorizaciones_regeneracion_caterpillar') IS NOT NULL OR to_regprocedure('operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION '016 regeneration objects already exist; refusing replacement'; END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','39a8f01535b92d492c85cac7fb3c168e'),
    ('operacion.reservar_folios_para_ejecucion(bigint,text,integer)','1ec951338fcb7218c59bc0cc03b97336'),
    ('operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','87cde2a1e34239b2c07fa4662f012726'),
    ('ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','594b198708d4d1e53cf4ad812de81164'),
    ('ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)','fbcb268f79ad4e8580dae1d8c58380a0')
  ) pinned(signature,body_hash) WHERE to_regprocedure(pinned.signature) IS NULL
    OR md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure(pinned.signature)),chr(13),''),'--[^\n]*','','g'),'\s+',' ','g')))<>pinned.body_hash) THEN
    RAISE EXCEPTION '016 legacy function body drift: the wrappers were validated against different legacy definitions; review required'; END IF;

END $precheck$;
SELECT 'PRECHECK_016_PASS' AS result;
-- Record before/after: the added NULL column is deliberately excluded from the fingerprint.
SELECT count(*) AS documents,md5(COALESCE(string_agg((to_jsonb(d)-'caterpillar_admission')::text,'|' ORDER BY documento_id),'')) AS existing_document_data_fingerprint FROM core.documentos d;
SELECT p.oid::regprocedure::text AS legacy_function,pg_get_function_result(p.oid) AS result_contract,md5(replace(p.prosrc,chr(13),'')) AS body_fingerprint
FROM pg_proc p WHERE p.oid=ANY(ARRAY[
  'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)'::regprocedure,
  'operacion.reservar_folios_para_ejecucion(bigint,text,integer)'::regprocedure,
  'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)'::regprocedure,
  'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)'::regprocedure,
  'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'::regprocedure]);
COMMIT;
