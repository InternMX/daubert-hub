-- READ ONLY. Does not admit/claim/reserve or invoke business functions.
BEGIN READ ONLY;
DO $postcheck$
DECLARE f record; r record; proc_row record; legacy text; t text; expected_count integer:=0;
BEGIN
  IF current_database()<>'daubert_global' OR current_user<>'postgres' THEN RAISE EXCEPTION '016 production postcheck only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE c.oid=to_regclass('core.documentos') AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres'
      AND a.attname='caterpillar_admission' AND NOT a.attisdropped AND a.atttypid='jsonb'::regtype
      AND NOT a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='') THEN RAISE EXCEPTION '016 missing or incompatible snapshot column'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_prod' AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN RAISE EXCEPTION '016 runtime role drift'; END IF;
  IF has_schema_privilege('n8n_cat_prod','core','CREATE') OR has_schema_privilege('n8n_cat_prod','ops','CREATE') OR has_schema_privilege('n8n_cat_prod','operacion','CREATE') OR has_schema_privilege('n8n_cat_prod','public','CREATE') THEN RAISE EXCEPTION '016 schema privilege drift'; END IF;
  IF NOT has_schema_privilege('n8n_cat_prod','core','USAGE') OR NOT has_schema_privilege('n8n_cat_prod','ops','USAGE') OR NOT has_schema_privilege('n8n_cat_prod','operacion','USAGE') THEN RAISE EXCEPTION '016 missing schema USAGE'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>'n8n_cat_prod' AND (pg_has_role('n8n_cat_prod',oid,'MEMBER') OR pg_has_role('n8n_cat_prod',oid,'SET'))) THEN RAISE EXCEPTION '016 dedicated role membership drift'; END IF;
  FOR f IN SELECT * FROM (VALUES
    ('ops.fn_cat_key_text_015(text)','23968d76b373557d6dcf211fc69d92a0',false,false),
    ('ops.fn_cat_snapshot_015(bigint,text,jsonb)','3a0d74e788c628bf6d8dd909abdcb172',false,false),
    ('ops.fn_cat_worker_015(bigint,text)','c31231a468afab425b37d6b9176ea04d',true,false),
    ('ops.fn_admitir_reservar_caterpillar(bigint,text,text,integer)','71db3261c8aafc7b050238c50f76b800',true,true),
    ('ops.fn_reprocesar_reservar_caterpillar(bigint,text,text,integer)','f2cd15a1e78a1f2132ef3bf9a06fe69d',true,true),
    ('ops.fn_guardar_snapshot_caterpillar(bigint,text)','81f1e930d6c527fa1e95372d79320bc7',true,true),
    ('operacion.fn_registrar_remision_caterpillar(bigint,text,text,bigint,date,text,jsonb)','10f24f8a090a4b3246e708018ec9a432',true,true),
    ('ops.fn_finalizar_caterpillar(bigint,text,text,text,text)','997d8d733d6849636cab0f282c1ef944',true,true),
    ('ops.fn_fallo_caterpillar(bigint,text,text,text)','ea0fc6d1dee94b2eb8631c9453c514ef',true,true)
  ) expected(signature,body_hash,definer,worker_execute) LOOP
    SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f.signature);
    IF NOT FOUND OR pg_get_userbyid(proc_row.proowner)<>'postgres' OR proc_row.prosecdef<>f.definer
      OR proc_row.provolatile::text IS DISTINCT FROM (CASE WHEN f.definer THEN 'v' ELSE 'i' END)
      OR proc_row.proisstrict IS DISTINCT FROM (f.signature='ops.fn_cat_key_text_015(text)')
      OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR md5(replace(proc_row.prosrc,chr(13),''))<>f.body_hash THEN RAISE EXCEPTION '016 function definition drift'; END IF;
    expected_count:=expected_count+1;
    IF EXISTS(SELECT 1 FROM aclexplode(proc_row.proacl) acl WHERE acl.grantee<>proc_row.proowner AND acl.is_grantable) THEN RAISE EXCEPTION '016 grant option drift'; END IF;
    FOR r IN SELECT oid,rolname FROM pg_roles WHERE NOT rolsuper AND rolname<>'postgres' LOOP
      IF has_function_privilege(r.oid,proc_row.oid,'EXECUTE') IS DISTINCT FROM (r.rolname='n8n_cat_prod' AND f.worker_execute) THEN RAISE EXCEPTION '016 effective function privilege drift'; END IF;
    END LOOP;
    IF has_function_privilege('public',proc_row.oid,'EXECUTE') THEN RAISE EXCEPTION '016 PUBLIC execute drift'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('ops','operacion') AND p.proname=ANY(ARRAY[
    'fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar','fn_reprocesar_reservar_caterpillar','fn_guardar_snapshot_caterpillar','fn_registrar_remision_caterpillar','fn_finalizar_caterpillar','fn_fallo_caterpillar']))<>expected_count THEN RAISE EXCEPTION '016 unexpected overload'; END IF;
  FOREACH legacy IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
    'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    IF has_function_privilege('n8n_cat_prod',legacy,'EXECUTE') THEN RAISE EXCEPTION '016 legacy bypass'; END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones','operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales'] LOOP
    IF has_table_privilege('n8n_cat_prod',t,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege('n8n_cat_prod',t,'INSERT,UPDATE') THEN RAISE EXCEPTION '016 DML bypass'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND d.caterpillar_admission IS NULL AND (d.nombre_archivo ~ '[\\/:*?"<>|[:cntrl:]]' OR ops.fn_cat_key_text_015(d.nombre_archivo) !~ '\.(XLSX|XLSM|XLS)$')) THEN
    RAISE EXCEPTION '016 historical Caterpillar document names cannot be verified by the gate; every admission would be REVIEW (HISTORY_UNAVAILABLE)'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('operacion.autorizaciones_regeneracion_caterpillar') AND relkind='r' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION '016 regeneration table missing'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='operacion.autorizaciones_regeneracion_caterpillar'::regclass AND contype='u')<>2
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='operacion.autorizaciones_regeneracion_caterpillar'::regclass AND contype='f')<>3 THEN RAISE EXCEPTION '016 regeneration uniqueness/reference drift'; END IF;
  FOR f IN SELECT * FROM (VALUES
    ('operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)','884ffa20d8f4b9d4561d807c9e2a4851')
  ) expected(signature,body_hash) LOOP
    SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f.signature);
    IF NOT FOUND OR NOT proc_row.prosecdef OR pg_get_userbyid(proc_row.proowner)<>'postgres' OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR md5(replace(proc_row.prosrc,chr(13),''))<>f.body_hash OR has_function_privilege('public',proc_row.oid,'EXECUTE') THEN RAISE EXCEPTION '016 regeneration function definition drift'; END IF;
  END LOOP;
  FOR r IN SELECT oid,rolname FROM pg_roles WHERE NOT rolsuper AND rolname<>'postgres' AND rolname !~ '^pg_' LOOP
    IF has_function_privilege(r.oid,'operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)'::regprocedure,'EXECUTE') IS DISTINCT FROM (r.rolname='daubert_hub_app') THEN RAISE EXCEPTION '016 authorize privilege drift'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid='operacion.autorizaciones_regeneracion_caterpillar'::regclass)) a
    WHERE a.grantee<>(SELECT relowner FROM pg_class WHERE oid='operacion.autorizaciones_regeneracion_caterpillar'::regclass)
      AND NOT (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='daubert_hub_app') AND a.privilege_type='SELECT' AND NOT a.is_grantable)) THEN RAISE EXCEPTION '016 regeneration table ACL drift'; END IF;
END $postcheck$;
SELECT 'POSTCHECK_016_PASS' AS result;
COMMIT;
