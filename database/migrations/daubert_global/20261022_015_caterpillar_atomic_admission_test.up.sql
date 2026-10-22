-- PREPARED ONLY, NOT APPLIED. TEST-only wrappers; no tables/columns or allocator changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE relation_name text; signature text;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '015 requires postgres exclusively in TEST'; END IF;
  IF current_setting('server_version_num')::int<180000 OR current_setting('server_encoding')<>'UTF8'
    OR NOT EXISTS(SELECT 1 FROM pg_collation WHERE collname='pg_unicode_fast' AND collnamespace='pg_catalog'::regnamespace) THEN
    RAISE EXCEPTION '015 requires PostgreSQL 18 Unicode collation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission' AND atttypid='jsonb'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION '015 requires 014'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_test' AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN
    RAISE EXCEPTION '015 requires the non-administrative dedicated TEST role'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>'n8n_cat_test' AND (pg_has_role('n8n_cat_test',oid,'MEMBER') OR pg_has_role('n8n_cat_test',oid,'SET'))) THEN
    RAISE EXCEPTION '015 dedicated TEST role membership requires review'; END IF;
  FOREACH relation_name IN ARRAY ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones',
    'operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales'] LOOP
    IF has_table_privilege('n8n_cat_test',relation_name,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      OR has_any_column_privilege('n8n_cat_test',relation_name,'INSERT,UPDATE') THEN RAISE EXCEPTION '015 direct DML bypass; review TEST role'; END IF;
  END LOOP;
  IF has_schema_privilege('n8n_cat_test','core','CREATE') OR has_schema_privilege('n8n_cat_test','ops','CREATE') OR has_schema_privilege('n8n_cat_test','operacion','CREATE') OR has_schema_privilege('n8n_cat_test','public','CREATE') THEN
    RAISE EXCEPTION '015 unsafe schema CREATE privilege'; END IF;
  IF NOT has_schema_privilege('n8n_cat_test','core','USAGE') OR NOT has_schema_privilege('n8n_cat_test','ops','USAGE') OR NOT has_schema_privilege('n8n_cat_test','operacion','USAGE') THEN
    RAISE EXCEPTION '015 missing schema USAGE'; END IF;
  FOREACH signature IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)',
    'operacion.reservar_folios_para_ejecucion(bigint,text,integer)','operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)',
    'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
      WHERE p.oid=to_regprocedure(signature) AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='n8n_cat_test')
        AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable) THEN RAISE EXCEPTION '015 requires reviewed direct legacy grants for reversible cutover'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('ops','operacion') AND p.proname=ANY(ARRAY[
    'fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar_test',
    'fn_registrar_remision_caterpillar_test','fn_finalizar_caterpillar_test','fn_fallo_caterpillar_test'])) THEN RAISE EXCEPTION '015 objects already exist'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE a.codigo='REMISIONES_CATERPILLAR'
      AND (e.estado='PROCESANDO' OR d.caterpillar_admission IS NOT NULL)) THEN RAISE EXCEPTION '015 requires a reviewed idle cutover; no snapshot-backed executions'; END IF;
END $guard$;

-- Match JavaScript NFC/trim/whitespace/uppercase without changing V1 canonicalization.
CREATE FUNCTION ops.fn_cat_key_text_015(p_text text) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog,pg_temp AS $fn$
  SELECT upper(btrim(regexp_replace(normalize(p_text,NFC),
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')) COLLATE "pg_unicode_fast")
$fn$;

-- Validate the persisted trusted V1 envelope; NOT another canonicalizer or a hash identity.
CREATE FUNCTION ops.fn_cat_snapshot_015(p_company bigint,p_name text,p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE m jsonb; k jsonb; expected_key jsonb; scope jsonb; name_key text; d jsonb; line jsonb; dt text;
BEGIN
  IF p_company IS NULL OR p_company<=0 OR p_snapshot->>'version' IS DISTINCT FROM 'CAT_ADMISSION_V1'
    OR jsonb_typeof(p_snapshot->'programmingKey') IS DISTINCT FROM 'string' OR jsonb_typeof(p_snapshot->'manifestCanonical') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  m:=(p_snapshot->>'manifestCanonical')::jsonb; k:=(p_snapshot->>'programmingKey')::jsonb; scope:=m->'scope';
  IF m->>'version' IS DISTINCT FROM 'CAT_OPERATIONAL_CONTENT_V1' OR jsonb_typeof(scope) IS DISTINCT FROM 'array' OR jsonb_array_length(scope)<>5
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope) x WHERE jsonb_typeof(x)<>'string')
    OR btrim(scope->>0)='' OR btrim(scope->>1)='' OR btrim(scope->>3)='' THEN RETURN NULL; END IF;
  dt:=m->>'deliveryDate';
  IF dt IS NULL OR dt!~ '^\d{4}-\d{2}-\d{2}$' OR to_char(to_date(dt,'YYYY-MM-DD'),'YYYY-MM-DD')<>dt THEN RETURN NULL; END IF;
  IF p_name IS NULL OR p_name~ '[\\/:*?"<>|[:cntrl:]]' THEN RETURN NULL; END IF;
  name_key:=ops.fn_cat_key_text_015(p_name);
  IF name_key IS NULL OR name_key~ '[\\/:*?"<>|[:cntrl:]]' OR left(name_key,2)='~$' OR name_key!~ '\.(XLSX|XLSM|XLS)$' THEN RETURN NULL; END IF;
  name_key:=btrim(regexp_replace(name_key,'\.(XLSX|XLSM|XLS)$',''));
  IF name_key='' THEN RETURN NULL; END IF;
  expected_key:=jsonb_build_array('CAT_ADMISSION_V1',p_company::text,ops.fn_cat_key_text_015(scope->>0),
    ops.fn_cat_key_text_015(scope->>1),ops.fn_cat_key_text_015(scope->>2),name_key);
  IF k IS DISTINCT FROM expected_key OR m->>'grouping' IS DISTINCT FROM (CASE WHEN scope->>0='CAT_TORREON' THEN 'POR_OC' ELSE 'POR_ARTICULO' END)
    OR jsonb_typeof(m->'documents') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'documents')<1 THEN RETURN NULL; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(m->'documents') LOOP
    IF jsonb_typeof(d->'purchaseOrder') IS DISTINCT FROM 'string' OR btrim(d->>'purchaseOrder')='' OR jsonb_typeof(d->'lines') IS DISTINCT FROM 'array'
      OR jsonb_array_length(d->'lines')<1 OR (m->>'grouping'='POR_ARTICULO' AND jsonb_array_length(d->'lines')<>1) THEN RETURN NULL; END IF;
    FOR line IN SELECT value FROM jsonb_array_elements(d->'lines') LOOP
      IF jsonb_typeof(line) IS DISTINCT FROM 'array' OR jsonb_array_length(line)<>5 OR jsonb_typeof(line->0) IS DISTINCT FROM 'string'
        OR btrim(line->>0)='' OR jsonb_typeof(line->1) IS DISTINCT FROM 'string' OR jsonb_typeof(line->2) IS DISTINCT FROM 'string'
        OR line->>2 IS DISTINCT FROM d->>'purchaseOrder' OR jsonb_typeof(line->3) IS DISTINCT FROM 'number' OR (line->>3)::numeric<=0
        OR line->>4 IS NULL OR NOT (line->>4=ANY(ARRAY['BOLSAS','HOJAS','ROLLOS','PAQUETES','PIEZAS'])) THEN RETURN NULL; END IF;
    END LOOP;
  END LOOP;
  IF m->>'grouping'='POR_OC' AND (SELECT count(*)<>count(DISTINCT value->>'purchaseOrder') FROM jsonb_array_elements(m->'documents')) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('key',k,'scope',k-5-0,'manifest',m,'quantity',jsonb_array_length(m->'documents'),
    'name',name_key,'processKey',(scope->>0)||'|'||(scope->>1)||'|'||(scope->>2));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $fn$;

CREATE FUNCTION ops.fn_admitir_reservar_caterpillar_test(p_document bigint,p_worker text,p_series text,p_quantity integer)
RETURNS TABLE(decision text,reason text,can_emit boolean,worker_id text,ejecucion_id bigint,reserva_id bigint,
  folio_inicial bigint,folio_final bigint,cantidad integer,legacy_unverified integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE doc core.documentos%ROWTYPE; ctx jsonb; old_ctx jsonb; old record; claim record; reserved record;
  own_id bigint; created boolean:=false; legacy_count integer:=0; route_count integer; normalized_old_name text;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CAT_ATOMIC_TEST_READ_COMMITTED_REQUIRED' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  IF p_document IS NULL OR p_document<=0 OR p_worker IS NULL OR length(btrim(p_worker)) NOT BETWEEN 1 AND 128 OR p_worker<>btrim(p_worker)
    OR p_series IS NULL OR p_quantity IS NULL OR p_quantity<1 THEN RAISE EXCEPTION 'CAT_ATOMIC_INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT * INTO doc FROM core.documentos WHERE documento_id=p_document AND tipo_documento='PROGRAMACION_ENTREGA';
  IF NOT FOUND OR doc.empresa_id IS NULL OR EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE e.documento_origen_id=p_document AND a.codigo<>'REMISIONES_CATERPILLAR') THEN RAISE EXCEPTION 'CAT_ATOMIC_SOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  ctx:=ops.fn_cat_snapshot_015(doc.empresa_id,doc.nombre_archivo,doc.caterpillar_admission);
  IF ctx IS NULL THEN RETURN QUERY SELECT 'REVIEW','HISTORY_UNAVAILABLE',false,NULL::text,NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,0; RETURN; END IF;
  -- One scope lock serializes both programming-name and renamed-content decisions. No global lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_015:'||(ctx->'scope')::text,0));
  SELECT * INTO doc FROM core.documentos WHERE documento_id=p_document FOR UPDATE;
  IF NOT FOUND OR doc.tipo_documento<>'PROGRAMACION_ENTREGA'
    OR EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
      WHERE e.documento_origen_id=p_document AND a.codigo<>'REMISIONES_CATERPILLAR')
    OR ctx IS DISTINCT FROM ops.fn_cat_snapshot_015(doc.empresa_id,doc.nombre_archivo,doc.caterpillar_admission) THEN RAISE EXCEPTION 'CAT_ATOMIC_SOURCE_CHANGED' USING ERRCODE='55000'; END IF;
  IF p_quantity<>(ctx->>'quantity')::integer THEN RAISE EXCEPTION 'CAT_ATOMIC_QUANTITY_MISMATCH' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO route_count FROM (
    SELECT r.ruta_id FROM ops.automatizacion_series_proceso r JOIN ops.automatizaciones a USING(automatizacion_id)
      JOIN operacion.series_documentales s USING(serie_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND a.estatus='ACTIVA'
        AND r.llave_proceso=ctx->>'processKey' AND r.estatus='ACTIVA' AND s.estatus='ACTIVA' AND s.codigo=p_series FOR SHARE OF r
  ) allowed_routes;
  IF route_count<>1 THEN RAISE EXCEPTION 'CAT_ATOMIC_ROUTE_NOT_ALLOWED' USING ERRCODE='55000'; END IF;
  SELECT count(DISTINCT d.documento_id)::integer INTO legacy_count FROM core.documentos d
    JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE d.empresa_id=doc.empresa_id AND a.codigo='REMISIONES_CATERPILLAR' AND d.caterpillar_admission IS NULL;
  FOR old IN SELECT d.*,e.ejecucion_id AS execution_id,e.estado AS execution_state,e.n8n_execution_id AS owner_id,
      EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=e.ejecucion_id) AS has_remissions,
      EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=e.ejecucion_id AND m.estatus='CANCELADA') AS has_cancelled
    FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id
    JOIN ops.automatizaciones a ON a.automatizacion_id=e.automatizacion_id
    WHERE d.empresa_id=doc.empresa_id AND a.codigo='REMISIONES_CATERPILLAR' ORDER BY e.ejecucion_id LOOP
    IF old.caterpillar_admission IS NULL THEN
      IF old.nombre_archivo~ '[\\/:*?"<>|[:cntrl:]]' OR ops.fn_cat_key_text_015(old.nombre_archivo)!~ '\.(XLSX|XLSM|XLS)$' THEN
        RETURN QUERY SELECT 'REVIEW','HISTORY_UNAVAILABLE',false,NULL::text,NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
      normalized_old_name:=btrim(regexp_replace(ops.fn_cat_key_text_015(old.nombre_archivo),'\.(XLSX|XLSM|XLS)$',''));
      IF normalized_old_name=ctx->>'name' THEN
        RETURN QUERY SELECT 'REVIEW','LEGACY_NAME_MATCH',false,NULL::text,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
      IF NULLIF(lower(btrim(old.hash_archivo)),'') IS NOT NULL
        AND lower(btrim(old.hash_archivo))=NULLIF(lower(btrim(doc.hash_archivo)),'') THEN
        RETURN QUERY SELECT 'REVIEW','LEGACY_FILE_MATCH',false,NULL::text,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
      CONTINUE; -- No scope or manifest is invented for legacy rows. See documented retrospective limit.
    END IF;
    old_ctx:=ops.fn_cat_snapshot_015(old.empresa_id,old.nombre_archivo,old.caterpillar_admission);
    IF old_ctx IS NULL THEN RETURN QUERY SELECT 'REVIEW','HISTORY_UNAVAILABLE',false,NULL::text,NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN; END IF;
    IF old_ctx->'scope' IS DISTINCT FROM ctx->'scope' THEN CONTINUE; END IF;
    IF old_ctx->'key'=ctx->'key' THEN
      IF old.execution_state='PROCESANDO' THEN
        IF old.documento_id=p_document AND old.owner_id=p_worker THEN own_id:=old.execution_id; CONTINUE; END IF;
        RETURN QUERY SELECT 'BLOCK','PROGRAM_IN_PROGRESS',false,old.owner_id,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
      RETURN QUERY SELECT 'BLOCK',CASE WHEN old.execution_state='CANCELADA' OR old.has_cancelled THEN 'REGENERATION_AUTHORIZATION_REQUIRED'
        WHEN old.execution_state='ERROR' THEN 'MANUAL_REPROCESS_REQUIRED' ELSE 'PROGRAM_ALREADY_EMITTED' END,
        false,NULL::text,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    END IF;
    IF old_ctx->'manifest'=ctx->'manifest' AND (old.execution_state IN ('PROCESANDO','COMPLETADA','CANCELADA') OR old.has_remissions) THEN
      RETURN QUERY SELECT 'REVIEW','MANIFEST_MATCH_REVIEW',false,NULL::text,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    END IF;
  END LOOP;
  IF own_id IS NULL THEN
    SELECT * INTO STRICT claim FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',p_document,p_worker,NULL,NULL);
    IF claim.motivo<>'CREATED' THEN RAISE EXCEPTION 'CAT_ATOMIC_UNEXPECTED_EXECUTION_RESULT' USING ERRCODE='55000'; END IF;
    own_id:=claim.ejecucion_id; created:=true;
  END IF;
  PERFORM 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=own_id AND e.estado='PROCESANDO' AND e.n8n_execution_id=p_worker FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_ATOMIC_OWNER_CHANGED' USING ERRCODE='55000'; END IF;
  SELECT * INTO STRICT reserved FROM operacion.reservar_folios_para_ejecucion(own_id,p_series,p_quantity);
  RETURN QUERY SELECT 'ADMIT',CASE WHEN created THEN 'ACQUIRED' ELSE 'OWNED_RETRY' END,true,p_worker,own_id,
    reserved.reserva_id,reserved.folio_inicial,reserved.folio_final,reserved.cantidad,legacy_count;
END $fn$;

-- Shared ownership check for later mutations. Acquire scope BEFORE execution, as in admission.
CREATE FUNCTION ops.fn_cat_worker_015(p_execution bigint,p_worker text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE c jsonb; d record; actual_owner text;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_setting('transaction_isolation')<>'read committed' OR p_worker IS NULL OR btrim(p_worker)='' THEN
    RAISE EXCEPTION 'CAT_ATOMIC_WORKER_CONTEXT_REQUIRED' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  SELECT doc.empresa_id,doc.nombre_archivo,doc.caterpillar_admission INTO d FROM ops.ejecuciones_automatizacion e
    JOIN ops.automatizaciones a USING(automatizacion_id) JOIN core.documentos doc ON doc.documento_id=e.documento_origen_id
    WHERE e.ejecucion_id=p_execution AND a.codigo='REMISIONES_CATERPILLAR';
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_ATOMIC_EXECUTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  c:=ops.fn_cat_snapshot_015(d.empresa_id,d.nombre_archivo,d.caterpillar_admission);
  IF c IS NULL THEN RAISE EXCEPTION 'CAT_ATOMIC_SNAPSHOT_REQUIRED' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_015:'||(c->'scope')::text,0));
  SELECT n8n_execution_id INTO actual_owner FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=p_execution FOR UPDATE;
  IF actual_owner IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'CAT_ATOMIC_NOT_OWNER' USING ERRCODE='42501'; END IF;
END $fn$;

CREATE FUNCTION operacion.fn_registrar_remision_caterpillar_test(p_execution bigint,p_worker text,p_series text,p_folio bigint,p_date date,p_pdf text,p_details jsonb)
RETURNS TABLE(remision_id bigint,ya_existia boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
  PERFORM ops.fn_cat_worker_015(p_execution,p_worker);
  RETURN QUERY SELECT * FROM operacion.fn_registrar_remision_generada(p_execution,p_series,p_folio,p_date,p_pdf,p_details);
END $fn$;
CREATE FUNCTION ops.fn_finalizar_caterpillar_test(p_execution bigint,p_worker text,p_state text,p_node text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS TABLE(ejecucion_id bigint,ya_estaba_finalizada boolean,estado_final text,reservas_aplicadas integer,reservas_abandonadas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
  PERFORM ops.fn_cat_worker_015(p_execution,p_worker);
  RETURN QUERY SELECT * FROM ops.fn_finalizar_ejecucion_automatizacion(p_execution,p_state,p_node,p_error);
END $fn$;
CREATE FUNCTION ops.fn_fallo_caterpillar_test(p_execution bigint,p_worker text,p_node text,p_error text)
RETURNS TABLE(ejecucion_id bigint,ya_registrado boolean,intentos_fallidos integer,max_intentos integer,error_final boolean,estado_actual text,reservas_abandonadas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
  PERFORM ops.fn_cat_worker_015(p_execution,p_worker);
  RETURN QUERY SELECT * FROM ops.fn_registrar_fallo_ejecucion(p_execution,p_worker,p_node,p_error);
END $fn$;

-- Strip default ACL leakage on NEW objects only. Restore neither PUBLIC nor other automation roles.
DO $acl$
DECLARE f record; grant_row record; principal text; legacy text;
BEGIN
  FOR f IN SELECT p.oid,p.proowner,p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('ops','operacion') AND p.proname=ANY(ARRAY['fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015',
      'fn_admitir_reservar_caterpillar_test','fn_registrar_remision_caterpillar_test','fn_finalizar_caterpillar_test','fn_fallo_caterpillar_test']) LOOP
    FOR grant_row IN SELECT DISTINCT grantee FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=f.oid),acldefault('f',f.proowner))) WHERE grantee<>f.proowner LOOP
      principal:=CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END;
      EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM '||principal;
    END LOOP;
  END LOOP;
  FOREACH legacy IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)',
    'operacion.reservar_folios_para_ejecucion(bigint,text,integer)','operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)',
    'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION '||legacy||' FROM n8n_cat_test';
    IF has_function_privilege('n8n_cat_test',legacy,'EXECUTE') THEN RAISE EXCEPTION '015 legacy bypass remains through membership/PUBLIC'; END IF;
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer),
  operacion.fn_registrar_remision_caterpillar_test(bigint,text,text,bigint,date,text,jsonb),
  ops.fn_finalizar_caterpillar_test(bigint,text,text,text,text),ops.fn_fallo_caterpillar_test(bigint,text,text,text) TO n8n_cat_test;
COMMIT;
