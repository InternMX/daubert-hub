-- READ ONLY. Does not admit/claim/reserve or invoke business functions.
BEGIN READ ONLY;
DO $postcheck$
DECLARE f record; r record; proc_row record; legacy text; t text; expected_count integer:=0;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '015 TEST postcheck only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_test' AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN RAISE EXCEPTION '015 runtime role drift'; END IF;
  IF has_schema_privilege('n8n_cat_test','core','CREATE') OR has_schema_privilege('n8n_cat_test','ops','CREATE') OR has_schema_privilege('n8n_cat_test','operacion','CREATE') OR has_schema_privilege('n8n_cat_test','public','CREATE') THEN RAISE EXCEPTION '015 schema privilege drift'; END IF;
  IF NOT has_schema_privilege('n8n_cat_test','core','USAGE') OR NOT has_schema_privilege('n8n_cat_test','ops','USAGE') OR NOT has_schema_privilege('n8n_cat_test','operacion','USAGE') THEN RAISE EXCEPTION '015 missing schema USAGE'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>'n8n_cat_test' AND (pg_has_role('n8n_cat_test',oid,'MEMBER') OR pg_has_role('n8n_cat_test',oid,'SET'))) THEN RAISE EXCEPTION '015 dedicated role membership drift'; END IF;
  FOR f IN SELECT * FROM (VALUES
    ('ops.fn_cat_key_text_015(text)','23968d76b373557d6dcf211fc69d92a0',false,false),
    ('ops.fn_cat_snapshot_015(bigint,text,jsonb)','3a0d74e788c628bf6d8dd909abdcb172',false,false),
    ('ops.fn_cat_worker_015(bigint,text)','e7ddda86d018f3e9dbef74c97745897f',true,false),
    ('ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer)','a3e178b623dd1a931dc3ce05785967b3',true,true),
    ('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)','da2088a4bb82bffb90ccd632d6108dde',true,true),
    ('ops.fn_guardar_snapshot_caterpillar_test(bigint,text)','e8a39d9e2d9b64e40cc42f9fd9e979d0',true,true),
    ('operacion.fn_registrar_remision_caterpillar_test(bigint,text,text,bigint,date,text,jsonb)','10f24f8a090a4b3246e708018ec9a432',true,true),
    ('ops.fn_finalizar_caterpillar_test(bigint,text,text,text,text)','997d8d733d6849636cab0f282c1ef944',true,true),
    ('ops.fn_fallo_caterpillar_test(bigint,text,text,text)','ea0fc6d1dee94b2eb8631c9453c514ef',true,true)
  ) expected(signature,body_hash,definer,worker_execute) LOOP
    SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f.signature);
    IF NOT FOUND OR pg_get_userbyid(proc_row.proowner)<>'postgres' OR proc_row.prosecdef<>f.definer
      OR proc_row.provolatile::text IS DISTINCT FROM (CASE WHEN f.definer THEN 'v' ELSE 'i' END)
      OR proc_row.proisstrict IS DISTINCT FROM (f.signature='ops.fn_cat_key_text_015(text)')
      OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR md5(replace(proc_row.prosrc,chr(13),''))<>f.body_hash THEN RAISE EXCEPTION '015 function definition drift'; END IF;
    expected_count:=expected_count+1;
    IF EXISTS(SELECT 1 FROM aclexplode(proc_row.proacl) acl WHERE acl.grantee<>proc_row.proowner AND acl.is_grantable) THEN RAISE EXCEPTION '015 grant option drift'; END IF;
    FOR r IN SELECT oid,rolname FROM pg_roles WHERE NOT rolsuper AND rolname<>'postgres' LOOP
      IF has_function_privilege(r.oid,proc_row.oid,'EXECUTE') IS DISTINCT FROM (r.rolname='n8n_cat_test' AND f.worker_execute) THEN RAISE EXCEPTION '015 effective function privilege drift'; END IF;
    END LOOP;
    IF has_function_privilege('public',proc_row.oid,'EXECUTE') THEN RAISE EXCEPTION '015 PUBLIC execute drift'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('ops','operacion') AND p.proname=ANY(ARRAY[
    'fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar_test','fn_reprocesar_reservar_caterpillar_test','fn_guardar_snapshot_caterpillar_test','fn_registrar_remision_caterpillar_test','fn_finalizar_caterpillar_test','fn_fallo_caterpillar_test']))<>expected_count THEN RAISE EXCEPTION '015 unexpected overload'; END IF;
  FOREACH legacy IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
    'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    IF has_function_privilege('n8n_cat_test',legacy,'EXECUTE') THEN RAISE EXCEPTION '015 legacy bypass'; END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones','operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales'] LOOP
    IF has_table_privilege('n8n_cat_test',t,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege('n8n_cat_test',t,'INSERT,UPDATE') THEN RAISE EXCEPTION '015 DML bypass'; END IF;
  END LOOP;
END $postcheck$;
SELECT 'POSTCHECK_015_PASS' AS result;
COMMIT;
