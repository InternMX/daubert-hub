-- MANUAL ONLY (TEST). Refuses once any authorization exists; restores the validated 015 reprocess definition.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '017 rollback only in TEST'; END IF;
END $guard$;
SELECT pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
LOCK TABLE operacion.autorizaciones_regeneracion_caterpillar IN ACCESS EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS(SELECT 1 FROM operacion.autorizaciones_regeneracion_caterpillar) THEN RAISE EXCEPTION '017 authorizations exist; rollback refused'; END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)')),chr(13),''))<>'7bbb0715fc8db4ff0a7252c7db13f81c' THEN
    RAISE EXCEPTION '017 rollback refuses definition drift'; END IF;
END $empty$;
CREATE OR REPLACE FUNCTION ops.fn_reprocesar_reservar_caterpillar_test(p_parent bigint,p_worker text,p_series text,p_quantity integer)
RETURNS TABLE(decision text,reason text,can_emit boolean,worker_id text,ejecucion_id bigint,reserva_id bigint,
  folio_inicial bigint,folio_final bigint,cantidad integer,legacy_unverified integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE par record; doc core.documentos%ROWTYPE; ctx jsonb; old_ctx jsonb; old record; child record; claim record; reserved record;
  own_id bigint; created boolean:=false; legacy_count integer:=0; route_count integer; normalized_old_name text;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CAT_ATOMIC_TEST_READ_COMMITTED_REQUIRED' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  IF p_parent IS NULL OR p_parent<=0 OR p_worker IS NULL OR length(btrim(p_worker)) NOT BETWEEN 1 AND 128 OR p_worker<>btrim(p_worker)
    OR p_series IS NULL OR p_quantity IS NULL OR p_quantity<1 THEN RAISE EXCEPTION 'CAT_ATOMIC_INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT e.documento_origen_id AS document_id INTO par FROM ops.ejecuciones_automatizacion e
    JOIN ops.automatizaciones a USING(automatizacion_id) WHERE e.ejecucion_id=p_parent AND a.codigo='REMISIONES_CATERPILLAR';
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_ATOMIC_SOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  SELECT * INTO doc FROM core.documentos WHERE documento_id=par.document_id AND tipo_documento='PROGRAMACION_ENTREGA';
  IF NOT FOUND OR doc.empresa_id IS NULL OR EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE e.documento_origen_id=doc.documento_id AND a.codigo<>'REMISIONES_CATERPILLAR') THEN RAISE EXCEPTION 'CAT_ATOMIC_SOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  ctx:=ops.fn_cat_snapshot_015(doc.empresa_id,doc.nombre_archivo,doc.caterpillar_admission);
  -- Historical documents have no V1 snapshot: the evidence needed to re-emit safely does not exist, so refuse explicitly.
  IF ctx IS NULL THEN RETURN QUERY SELECT 'REVIEW','REPROCESS_SNAPSHOT_REQUIRED',false,NULL::text,NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,0; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_015:'||(ctx->'scope')::text,0));
  SELECT * INTO doc FROM core.documentos WHERE documento_id=par.document_id FOR UPDATE;
  IF NOT FOUND OR ctx IS DISTINCT FROM ops.fn_cat_snapshot_015(doc.empresa_id,doc.nombre_archivo,doc.caterpillar_admission)
    THEN RAISE EXCEPTION 'CAT_ATOMIC_SOURCE_CHANGED' USING ERRCODE='55000'; END IF;
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
  SELECT e.estado AS parent_state INTO par FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_parent FOR UPDATE;
  SELECT e.ejecucion_id AS child_id,e.estado AS child_state,e.n8n_execution_id AS owner_id INTO child
    FROM ops.ejecuciones_automatizacion e WHERE e.reproceso_de_id=p_parent;
  IF FOUND THEN
    IF child.child_state='PROCESANDO' AND child.owner_id=p_worker THEN own_id:=child.child_id;
    ELSIF child.child_state='PROCESANDO' THEN
      RETURN QUERY SELECT 'BLOCK','REPROCESS_IN_PROGRESS',false,child.owner_id,child.child_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    ELSE RETURN QUERY SELECT 'BLOCK','ALREADY_REPROCESSED',false,NULL::text,child.child_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    END IF;
  ELSE
    IF par.parent_state NOT IN ('ERROR','CANCELADA') THEN
      RETURN QUERY SELECT 'BLOCK','PARENT_NOT_REPROCESSABLE',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    END IF;
    -- A failed run that already registered live remissions is a partial emission: it needs reconciliation, never a second emission.
    IF EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_parent AND m.estatus IS DISTINCT FROM 'CANCELADA') THEN
      RETURN QUERY SELECT 'REVIEW','PARENT_HAS_ACTIVE_REMISSIONS',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    END IF;
    IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
      WHERE e.documento_origen_id=doc.documento_id AND a.codigo='REMISIONES_CATERPILLAR' AND e.estado IN ('PROCESANDO','COMPLETADA')) THEN
      RETURN QUERY SELECT 'BLOCK','PROGRAM_IN_PROGRESS_OR_EMITTED',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
    END IF;
    -- Other documents: same conflict policy as the admission gate. The parent's own document lineage was resolved above.
    FOR old IN SELECT d.*,e.ejecucion_id AS execution_id,e.estado AS execution_state
      FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id
      JOIN ops.automatizaciones a ON a.automatizacion_id=e.automatizacion_id
      WHERE d.empresa_id=doc.empresa_id AND a.codigo='REMISIONES_CATERPILLAR' AND d.documento_id<>doc.documento_id ORDER BY e.ejecucion_id LOOP
      IF old.caterpillar_admission IS NULL THEN
        IF old.nombre_archivo~ '[\\/:*?"<>|[:cntrl:]]' OR ops.fn_cat_key_text_015(old.nombre_archivo)!~ '\.(XLSX|XLSM|XLS)$' THEN
          RETURN QUERY SELECT 'REVIEW','HISTORY_UNAVAILABLE',false,NULL::text,NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
        END IF;
        normalized_old_name:=btrim(regexp_replace(ops.fn_cat_key_text_015(old.nombre_archivo),'\.(XLSX|XLSM|XLS)$',''));
        IF normalized_old_name=ctx->>'name' THEN
          RETURN QUERY SELECT 'REVIEW','LEGACY_NAME_MATCH',false,NULL::text,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
        END IF;
        CONTINUE;
      END IF;
      old_ctx:=ops.fn_cat_snapshot_015(old.empresa_id,old.nombre_archivo,old.caterpillar_admission);
      IF old_ctx IS NULL THEN RETURN QUERY SELECT 'REVIEW','HISTORY_UNAVAILABLE',false,NULL::text,NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN; END IF;
      IF old_ctx->'scope' IS DISTINCT FROM ctx->'scope' THEN CONTINUE; END IF;
      IF old_ctx->'key'=ctx->'key' OR (old_ctx->'manifest'=ctx->'manifest' AND old.execution_state IN ('PROCESANDO','COMPLETADA','CANCELADA')) THEN
        RETURN QUERY SELECT 'REVIEW','OTHER_DOCUMENT_CONFLICT_REVIEW',false,NULL::text,old.execution_id,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
    END LOOP;
    SELECT * INTO STRICT claim FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',doc.documento_id,p_worker,NULL,p_parent);
    IF claim.motivo<>'REPROCESS_CREATED' THEN RAISE EXCEPTION 'CAT_ATOMIC_UNEXPECTED_EXECUTION_RESULT' USING ERRCODE='55000'; END IF;
    own_id:=claim.ejecucion_id; created:=true;
  END IF;
  PERFORM 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=own_id AND e.estado='PROCESANDO' AND e.n8n_execution_id=p_worker AND e.reproceso_de_id=p_parent FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_ATOMIC_OWNER_CHANGED' USING ERRCODE='55000'; END IF;
  SELECT * INTO STRICT reserved FROM operacion.reservar_folios_para_ejecucion(own_id,p_series,p_quantity);
  RETURN QUERY SELECT 'ADMIT',CASE WHEN created THEN 'REPROCESS_ACQUIRED' ELSE 'OWNED_RETRY' END,true,p_worker,own_id,
    reserved.reserva_id,reserved.folio_inicial,reserved.folio_final,reserved.cantidad,legacy_count;
END $fn$;
DROP FUNCTION operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text);
DROP TABLE operacion.autorizaciones_regeneracion_caterpillar;
COMMIT;
