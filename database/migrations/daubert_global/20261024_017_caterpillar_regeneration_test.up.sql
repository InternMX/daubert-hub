-- PREPARED. TEST-only migration 017: commercial regeneration of a COMPLETADA execution whose remissions were ALL formally cancelled.
-- Adds ONE table (the single-use ADMIN authorization record), ONE Hub-facing function, and patches the validated reprocess gate so a COMPLETADA parent is accepted
-- only through that authorization. The technical reprocess rule for ERROR/CANCELADA parents is unchanged. No data is touched.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '017 requires postgres exclusively in TEST'; END IF;
  IF to_regclass('operacion.cancelaciones_remisiones') IS NULL OR to_regprocedure('operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION '017 requires the individual cancellation ledger (013)'; END IF;
  IF to_regprocedure('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)') IS NULL OR to_regprocedure('ops.fn_cat_snapshot_015(bigint,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '017 requires 015'; END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)')),chr(13),''))<>'da2088a4bb82bffb90ccd632d6108dde' THEN
    RAISE EXCEPTION '017 expects the validated 015 reprocess definition; review required'; END IF;
  IF to_regclass('operacion.autorizaciones_regeneracion_caterpillar') IS NOT NULL
    OR to_regprocedure('operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)') IS NOT NULL THEN RAISE EXCEPTION '017 objects already exist; refusing replacement'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='daubert_hub_test_user') THEN RAISE EXCEPTION '017 requires the Hub TEST role'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO') THEN
    RAISE EXCEPTION '017 requires an idle Caterpillar worker (no PROCESANDO execution)'; END IF;
END $guard$;
-- Waits for in-flight 015 calls (they hold this lock shared) before the gate is replaced.
SELECT pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));

CREATE TABLE operacion.autorizaciones_regeneracion_caterpillar (
  autorizacion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejecucion_origen_id bigint NOT NULL UNIQUE REFERENCES ops.ejecuciones_automatizacion(ejecucion_id) ON DELETE RESTRICT,
  motivo text NOT NULL CHECK (motivo = btrim(motivo) AND length(motivo) BETWEEN 1 AND 500),
  usuario_id bigint REFERENCES security.users(user_id) ON DELETE SET NULL,
  usuario_email text NOT NULL CHECK (btrim(usuario_email) <> ''),
  usuario_nombre text NOT NULL CHECK (btrim(usuario_nombre) <> ''),
  autorizada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id text CHECK (request_id IS NULL OR length(btrim(request_id)) BETWEEN 1 AND 200),
  ejecucion_nueva_id bigint UNIQUE REFERENCES ops.ejecuciones_automatizacion(ejecucion_id) ON DELETE RESTRICT,
  CONSTRAINT ck_regeneracion_distinta CHECK (ejecucion_nueva_id IS NULL OR ejecucion_nueva_id <> ejecucion_origen_id)
);

CREATE FUNCTION operacion.fn_autorizar_regeneracion_caterpillar(p_ejecucion_id bigint,p_motivo text,p_usuario_id bigint,p_request_id text)
RETURNS TABLE(resultado text,autorizacion_id bigint,ejecucion_origen_id bigint,motivo text,usuario_id bigint,usuario_email text,usuario_nombre text,
  autorizada_en text,request_id text,ejecucion_nueva_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_email text; v_name text; v_state text; v_doc core.documentos%ROWTYPE; auth operacion.autorizaciones_regeneracion_caterpillar%ROWTYPE; v_result text:='AUTHORIZED';
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  IF p_ejecucion_id IS NULL OR p_ejecucion_id<=0 OR p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 1 AND 500
    OR (p_request_id IS NOT NULL AND length(btrim(p_request_id)) NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'CAT_REGEN_INVALID' USING ERRCODE='22023'; END IF;
  -- Same actor contract as the individual cancellation: the authenticated Hub identity (ADMIN, ACTIVE, password already changed). No credential column is read.
  SELECT u.email,u.display_name INTO v_email,v_name FROM security.users u WHERE u.user_id=p_usuario_id AND u.role='ADMIN' AND u.status='ACTIVE' AND NOT u.must_change_password FOR SHARE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_REGEN_FORBIDDEN' USING ERRCODE='PCR05'; END IF;
  SELECT e.estado,e.documento_origen_id INTO v_state,v_doc.documento_id FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE e.ejecucion_id=p_ejecucion_id AND a.codigo='REMISIONES_CATERPILLAR' FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_REGEN_NOT_FOUND' USING ERRCODE='PCR01'; END IF;
  SELECT * INTO auth FROM operacion.autorizaciones_regeneracion_caterpillar x WHERE x.ejecucion_origen_id=p_ejecucion_id;
  IF FOUND THEN
    v_result:='ALREADY_AUTHORIZED';
  ELSE
    IF v_state<>'COMPLETADA' THEN RAISE EXCEPTION 'CAT_REGEN_STATE' USING ERRCODE='PCR02'; END IF;
    SELECT * INTO v_doc FROM core.documentos WHERE documento_id=v_doc.documento_id AND tipo_documento='PROGRAMACION_ENTREGA';
    -- Historical programs have no V1 snapshot: nothing to compare the regenerated content against, so they are never regenerated automatically.
    IF NOT FOUND OR v_doc.empresa_id IS NULL OR ops.fn_cat_snapshot_015(v_doc.empresa_id,v_doc.nombre_archivo,v_doc.caterpillar_admission) IS NULL THEN RAISE EXCEPTION 'CAT_REGEN_SNAPSHOT_REQUIRED' USING ERRCODE='PCR03'; END IF;
    IF NOT EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_ejecucion_id)
      OR EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_ejecucion_id AND (m.estatus IS DISTINCT FROM 'CANCELADA'
        OR NOT EXISTS(SELECT 1 FROM operacion.cancelaciones_remisiones c WHERE c.remision_id=m.remision_id))) THEN RAISE EXCEPTION 'CAT_REGEN_REMISSIONS' USING ERRCODE='PCR04'; END IF;
    IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.reproceso_de_id=p_ejecucion_id) THEN RAISE EXCEPTION 'CAT_REGEN_CHILD_EXISTS' USING ERRCODE='PCR06'; END IF;
    INSERT INTO operacion.autorizaciones_regeneracion_caterpillar(ejecucion_origen_id,motivo,usuario_id,usuario_email,usuario_nombre,request_id)
      VALUES(p_ejecucion_id,btrim(p_motivo),p_usuario_id,v_email,v_name,p_request_id) RETURNING * INTO auth;
  END IF;
  RETURN QUERY SELECT v_result,auth.autorizacion_id,auth.ejecucion_origen_id,auth.motivo,auth.usuario_id,auth.usuario_email,auth.usuario_nombre,
    to_char(auth.autorizada_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),auth.request_id,auth.ejecucion_nueva_id;
END $fn$;

CREATE OR REPLACE FUNCTION ops.fn_reprocesar_reservar_caterpillar_test(p_parent bigint,p_worker text,p_series text,p_quantity integer)
RETURNS TABLE(decision text,reason text,can_emit boolean,worker_id text,ejecucion_id bigint,reserva_id bigint,
  folio_inicial bigint,folio_final bigint,cantidad integer,legacy_unverified integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE par record; doc core.documentos%ROWTYPE; ctx jsonb; old_ctx jsonb; old record; child record; claim record; reserved record;
  own_id bigint; created boolean:=false; legacy_count integer:=0; route_count integer; normalized_old_name text;
  regen boolean:=false; auth record;
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
    -- Commercial regeneration (017): a COMPLETADA parent is accepted ONLY through a recorded ADMIN authorization (operacion.autorizaciones_regeneracion_caterpillar)
    -- and only while every one of its remissions is formally cancelled. Without the authorization it stays PARENT_NOT_REPROCESSABLE, exactly as before.
    regen:=par.parent_state='COMPLETADA';
    IF regen THEN
      SELECT * INTO auth FROM operacion.autorizaciones_regeneracion_caterpillar x WHERE x.ejecucion_origen_id=p_parent FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'BLOCK','PARENT_NOT_REPROCESSABLE',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
      IF NOT EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_parent)
        OR EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_parent AND (m.estatus IS DISTINCT FROM 'CANCELADA'
          OR NOT EXISTS(SELECT 1 FROM operacion.cancelaciones_remisiones c WHERE c.remision_id=m.remision_id))) THEN
        RETURN QUERY SELECT 'REVIEW','PARENT_HAS_ACTIVE_REMISSIONS',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
    ELSE
      IF par.parent_state NOT IN ('ERROR','CANCELADA') THEN
        RETURN QUERY SELECT 'BLOCK','PARENT_NOT_REPROCESSABLE',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
      -- A failed run that already registered live remissions is a partial emission: it needs reconciliation, never a second emission.
      IF EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_parent AND m.estatus IS DISTINCT FROM 'CANCELADA') THEN
        RETURN QUERY SELECT 'REVIEW','PARENT_HAS_ACTIVE_REMISSIONS',false,NULL::text,p_parent,NULL::bigint,NULL::bigint,NULL::bigint,NULL::integer,legacy_count; RETURN;
      END IF;
    END IF;
    -- Another execution of the same program still counts unless it is the parent itself or a COMPLETADA whose remissions are all cancelled (it no longer holds a live emission).
    IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
      WHERE e.documento_origen_id=doc.documento_id AND a.codigo='REMISIONES_CATERPILLAR' AND e.ejecucion_id<>p_parent
        AND (e.estado='PROCESANDO' OR (e.estado='COMPLETADA' AND NOT (EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=e.ejecucion_id)
          AND NOT EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=e.ejecucion_id AND m.estatus IS DISTINCT FROM 'CANCELADA'))))) THEN
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
    -- The authorization is consumed by exactly one child execution (the child is unique per parent by uq_ejecuciones_automatizacion_reproceso_unico).
    IF regen THEN
      UPDATE operacion.autorizaciones_regeneracion_caterpillar x SET ejecucion_nueva_id=own_id WHERE x.autorizacion_id=auth.autorizacion_id AND x.ejecucion_nueva_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'CAT_REGEN_AUTHORIZATION_ALREADY_USED' USING ERRCODE='55000'; END IF;
    END IF;
  END IF;
  PERFORM 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=own_id AND e.estado='PROCESANDO' AND e.n8n_execution_id=p_worker AND e.reproceso_de_id=p_parent FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_ATOMIC_OWNER_CHANGED' USING ERRCODE='55000'; END IF;
  SELECT * INTO STRICT reserved FROM operacion.reservar_folios_para_ejecucion(own_id,p_series,p_quantity);
  RETURN QUERY SELECT 'ADMIT',CASE WHEN created THEN 'REPROCESS_ACQUIRED' ELSE 'OWNED_RETRY' END,true,p_worker,own_id,
    reserved.reserva_id,reserved.folio_inicial,reserved.folio_final,reserved.cantidad,legacy_count;
END $fn$;

DO $acl$
DECLARE r record; v_role text;
BEGIN
  FOR r IN SELECT DISTINCT acl.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE c.oid='operacion.autorizaciones_regeneracion_caterpillar'::regclass AND acl.grantee<>c.relowner LOOP
    EXECUTE 'REVOKE ALL ON operacion.autorizaciones_regeneracion_caterpillar FROM '||CASE WHEN r.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END;
  END LOOP;
  FOR r IN SELECT DISTINCT acl.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('s', c.relowner))) acl
    WHERE c.oid='operacion.autorizaciones_regeneracion_caterpillar_autorizacion_id_seq'::regclass AND acl.grantee<>c.relowner LOOP
    EXECUTE 'REVOKE ALL ON SEQUENCE operacion.autorizaciones_regeneracion_caterpillar_autorizacion_id_seq FROM '||CASE WHEN r.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END;
  END LOOP;
  FOR r IN SELECT DISTINCT acl.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid='operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)'::regprocedure AND acl.grantee<>p.proowner LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text) FROM '||CASE WHEN r.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END;
  END LOOP;
  v_role := 'daubert_hub_test_user';
  EXECUTE format('GRANT SELECT ON operacion.autorizaciones_regeneracion_caterpillar TO %I', v_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text) TO %I', v_role);
END $acl$;
COMMIT;
