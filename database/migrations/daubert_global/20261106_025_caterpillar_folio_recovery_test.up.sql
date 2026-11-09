-- TEST ONLY. Prepared, not applied to the shared TEST instance. Disabled on installation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  IF to_regnamespace('cat_recovery_test') IS NOT NULL THEN RAISE EXCEPTION 'CAT_RECOVERY_ALREADY_INSTALLED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cat_recovery_test_coordinator' AND NOT rolcanlogin
    AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication)) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_DEDICATED_COORDINATOR_ROLE_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='cat_recovery_test_coordinator')) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_COORDINATOR_MEMBERSHIP_REQUIRES_REVIEW'; END IF;
  IF has_function_privilege('n8n_cat_test','operacion.reservar_folios_para_ejecucion(bigint,text,integer)','EXECUTE')
    OR has_table_privilege('n8n_cat_test','operacion.reservas_folios','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_any_column_privilege('n8n_cat_test','operacion.reservas_folios','INSERT,UPDATE')
    OR has_table_privilege('n8n_cat_test','operacion.series_documentales','UPDATE')
    OR has_any_column_privilege('n8n_cat_test','operacion.series_documentales','UPDATE') THEN
    RAISE EXCEPTION 'CAT_RECOVERY_LEGACY_OR_DML_BYPASS'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO') THEN
    RAISE EXCEPTION 'CAT_RECOVERY_IDLE_CUTOVER_REQUIRED';
  END IF;
END $$;

CREATE SCHEMA cat_recovery_test;
REVOKE ALL ON SCHEMA cat_recovery_test FROM PUBLIC;
CREATE TABLE cat_recovery_test.settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false);
INSERT INTO cat_recovery_test.settings VALUES(true,false);
CREATE TABLE cat_recovery_test.gate_backup(signature text PRIMARY KEY, definition text NOT NULL, installed_md5 text);
CREATE TABLE cat_recovery_test.requests(
  request_id uuid PRIMARY KEY,
  parent_id bigint NOT NULL REFERENCES ops.ejecuciones_automatizacion,
  original_reservation_id bigint NOT NULL REFERENCES operacion.reservas_folios,
  series_id bigint NOT NULL REFERENCES operacion.series_documentales,
  admin_id bigint NOT NULL REFERENCES security.users,
  admin_email text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
  confirmed_no_delivery boolean NOT NULL CHECK(confirmed_no_delivery),
  document_snapshot jsonb NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'PREPARING' CHECK(state IN ('PREPARING','READY','RESERVED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  manifest jsonb,
  manifest_sha256 text,
  verified_at timestamptz,
  worker_id text,
  child_id bigint UNIQUE REFERENCES ops.ejecuciones_automatizacion,
  new_reservation_id bigint UNIQUE REFERENCES operacion.reservas_folios,
  next_folio_before bigint,
  admission_result jsonb,
  rejection_reason text,
  UNIQUE(original_reservation_id)
);
CREATE UNIQUE INDEX cat_recovery_one_fence_per_series ON cat_recovery_test.requests(series_id)
  WHERE state IN ('PREPARING','READY');

CREATE FUNCTION cat_recovery_test.assert_test() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  IF current_database()<>'daubert_hub_test' OR current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_TEST_READ_COMMITTED_REQUIRED'; END IF;
END $$;

CREATE FUNCTION cat_recovery_test.evaluate(p_parent bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE par record; src record; ctx jsonb; codes text[]:=ARRAY[]::text[]; req record;
BEGIN
  PERFORM cat_recovery_test.assert_test();
  SELECT e.*,a.codigo,d.nombre_archivo,d.hash_archivo,d.caterpillar_admission,d.empresa_id INTO par
    FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id
    WHERE e.ejecucion_id=p_parent AND a.codigo='REMISIONES_CATERPILLAR';
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled',false,'databaseEligible',false,'eligible',false,'codes',jsonb_build_array('NOT_FOUND')); END IF;
  IF par.estado<>'ERROR' THEN codes:=array_append(codes,'PARENT_NOT_ERROR'); END IF;
  ctx:=ops.fn_cat_snapshot_015(par.empresa_id,par.nombre_archivo,par.caterpillar_admission);
  IF ctx IS NULL OR par.hash_archivo IS NULL OR par.hash_archivo!~'^[a-f0-9]{64}$' THEN codes:=array_append(codes,'SOURCE_IDENTITY_UNPROVEN'); END IF;
  IF (SELECT count(*) FROM operacion.reservas_folios r WHERE r.ejecucion_id=p_parent)<>1 THEN
    RETURN jsonb_build_object('enabled',false,'databaseEligible',false,'eligible',false,'codes',jsonb_build_array('SINGLE_RESERVATION_REQUIRED'));
  END IF;
  SELECT r.*,s.siguiente_folio,s.codigo AS series_code,s.estatus AS series_status INTO src
    FROM operacion.reservas_folios r JOIN operacion.series_documentales s USING(serie_id) WHERE r.ejecucion_id=p_parent;
  IF src.estatus<>'ABANDONADA' THEN codes:=array_append(codes,'RESERVATION_NOT_ABANDONED'); END IF;
  IF src.series_status<>'ACTIVA' OR src.siguiente_folio<>src.folio_final+1 THEN codes:=array_append(codes,'NOT_LAST_RANGE'); END IF;
  IF EXISTS(SELECT 1 FROM operacion.reservas_folios r WHERE r.serie_id=src.serie_id
    AND (r.reserva_id>src.reserva_id OR r.folio_final>src.folio_final)) THEN codes:=array_append(codes,'LATER_RESERVATION'); END IF;
  IF EXISTS(SELECT 1 FROM operacion.reservas_folios r WHERE r.serie_id=src.serie_id AND r.reserva_id<>src.reserva_id
    AND r.estatus<>'ABANDONADA' AND r.folio_inicial<=src.folio_final AND r.folio_final>=src.folio_inicial) THEN codes:=array_append(codes,'OVERLAP'); END IF;
  IF EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_parent OR
    (m.serie_id=src.serie_id AND m.folio BETWEEN src.folio_inicial AND src.folio_final)) THEN codes:=array_append(codes,'REMISSION_EXISTS'); END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.reproceso_de_id=p_parent) THEN codes:=array_append(codes,'CHILD_EXISTS'); END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.automatizacion_id=par.automatizacion_id AND e.estado='PROCESANDO') THEN
    codes:=array_append(codes,'OTHER_EXECUTION_PROCESSING'); END IF;
  SELECT r.state,r.manifest_sha256,r.verified_at,r.manifest INTO req FROM cat_recovery_test.requests r WHERE r.parent_id=p_parent;
  RETURN jsonb_build_object('parentId',p_parent::text,'plant',COALESCE(ctx->>'processKey','No determinada'),
    'reservationId',src.reserva_id::text,'reservationStatus',src.estatus,'firstFolio',src.folio_inicial::text,'lastFolio',src.folio_final::text,
    'databaseEligible',cardinality(codes)=0,'enabled',(SELECT enabled FROM cat_recovery_test.settings),
    'eligible',COALESCE(cardinality(codes)=0 AND req.state='READY' AND req.verified_at>clock_timestamp()-interval '5 minutes' AND (SELECT enabled FROM cat_recovery_test.settings),false),
    'codes',to_jsonb(codes),'quarantine',jsonb_build_object('state',COALESCE(req.state,'NOT_PREPARED'),'sha256',req.manifest_sha256,
      'fileCount',COALESCE(jsonb_array_length(req.manifest->'files'),0)));
END $$;

CREATE FUNCTION cat_recovery_test.request(p_parent bigint,p_request uuid,p_admin bigint,p_reason text,p_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE par record; src record; ctx jsonb; assessment jsonb; existing cat_recovery_test.requests%ROWTYPE; email text;
BEGIN
  PERFORM cat_recovery_test.assert_test();
  IF NOT (SELECT enabled FROM cat_recovery_test.settings) THEN RAISE EXCEPTION 'CAT_RECOVERY_DISABLED'; END IF;
  IF p_confirmed IS DISTINCT FROM true OR p_request IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'CAT_RECOVERY_CONFIRMATION_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT u.email INTO email FROM security.users u WHERE u.user_id=p_admin AND u.role='ADMIN' AND u.status='ACTIVE' AND NOT u.must_change_password FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_RECOVERY_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT d.*,e.automatizacion_id INTO par FROM ops.ejecuciones_automatizacion e JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE e.ejecucion_id=p_parent;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_RECOVERY_NOT_FOUND'; END IF;
  ctx:=ops.fn_cat_snapshot_015(par.empresa_id,par.nombre_archivo,par.caterpillar_admission);
  IF ctx IS NULL THEN RAISE EXCEPTION 'CAT_RECOVERY_SOURCE_IDENTITY_UNPROVEN'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_015:'||(ctx->'scope')::text,0));
  PERFORM 1 FROM core.documentos d WHERE d.documento_id=par.documento_id FOR UPDATE;
  PERFORM 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_parent FOR UPDATE;
  SELECT r.* INTO src FROM operacion.reservas_folios r WHERE r.ejecucion_id=p_parent;
  PERFORM 1 FROM operacion.series_documentales s WHERE s.serie_id=src.serie_id FOR UPDATE;
  SELECT * INTO existing FROM cat_recovery_test.requests r WHERE r.request_id=p_request;
  IF FOUND THEN
    IF existing.parent_id<>p_parent OR existing.admin_id<>p_admin OR existing.reason<>btrim(p_reason) THEN RAISE EXCEPTION 'CAT_RECOVERY_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('requestId',p_request,'state',existing.state);
  END IF;
  assessment:=cat_recovery_test.evaluate(p_parent);
  IF NOT (assessment->>'databaseEligible')::boolean THEN RAISE EXCEPTION 'CAT_RECOVERY_INELIGIBLE:%',assessment->'codes'; END IF;
  IF EXISTS(SELECT 1 FROM cat_recovery_test.requests r LEFT JOIN ops.ejecuciones_automatizacion e ON e.ejecucion_id=r.child_id
    WHERE r.series_id=src.serie_id AND (r.state IN ('PREPARING','READY') OR (r.state='RESERVED' AND e.estado='PROCESANDO'))) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_SERIES_FENCED'; END IF;
  INSERT INTO cat_recovery_test.requests(request_id,parent_id,original_reservation_id,series_id,admin_id,admin_email,reason,
    confirmed_no_delivery,document_snapshot,source_sha256)
    VALUES(p_request,p_parent,src.reserva_id,src.serie_id,p_admin,email,btrim(p_reason),true,par.caterpillar_admission,par.hash_archivo);
  RETURN jsonb_build_object('requestId',p_request,'state','PREPARING');
END $$;

CREATE FUNCTION cat_recovery_test.attest(p_request uuid,p_manifest_text text,p_sha256 text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r cat_recovery_test.requests%ROWTYPE; src record; p_manifest jsonb:=p_manifest_text::jsonb;
BEGIN
  PERFORM cat_recovery_test.assert_test();
  IF NOT (SELECT enabled FROM cat_recovery_test.settings) THEN RAISE EXCEPTION 'CAT_RECOVERY_DISABLED'; END IF;
  SELECT * INTO STRICT r FROM cat_recovery_test.requests q WHERE q.request_id=p_request FOR UPDATE;
  IF r.state='READY' AND r.manifest=p_manifest AND r.manifest_sha256=p_sha256 THEN RETURN; END IF;
  IF r.state<>'PREPARING' THEN RAISE EXCEPTION 'CAT_RECOVERY_INVALID_STATE'; END IF;
  SELECT * INTO STRICT src FROM operacion.reservas_folios s WHERE s.reserva_id=r.original_reservation_id;
  IF p_manifest IS NULL OR p_sha256 IS NULL OR p_sha256!~'^[0-9a-f]{64}$'
    OR p_sha256<>encode(sha256(convert_to(p_manifest_text,'UTF8')),'hex')
    OR p_manifest->>'version' IS DISTINCT FROM 'CAT_QUARANTINE_V1' OR p_manifest->>'requestId' IS DISTINCT FROM p_request::text
    OR p_manifest->>'reservationId' IS DISTINCT FROM src.reserva_id::text
    OR p_manifest->>'sourceSha256' IS DISTINCT FROM r.source_sha256
    OR p_manifest->>'custody' IS DISTINCT FROM 'ISOLATED_UNRELEASED'
    OR p_manifest->>'outputClear' IS DISTINCT FROM 'true' OR p_manifest->>'complete' IS DISTINCT FROM 'true'
    OR jsonb_typeof(p_manifest->'files') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CAT_RECOVERY_QUARANTINE_UNPROVEN'; END IF;
  IF jsonb_array_length(p_manifest->'files')>src.cantidad OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'files') f
    WHERE f->>'sha256' IS NULL OR (f->>'sha256')!~'^[0-9a-f]{64}$' OR f->>'size' IS NULL OR (f->>'size')!~'^[1-9][0-9]*$'
      OR f->>'folio' IS NULL OR (f->>'folio')!~'^[1-9][0-9]*$' OR (f->>'folio')::bigint NOT BETWEEN src.folio_inicial AND src.folio_final)
    OR (SELECT count(*)<>count(DISTINCT f->>'folio') FROM jsonb_array_elements(p_manifest->'files') f) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_QUARANTINE_UNPROVEN'; END IF;
  UPDATE cat_recovery_test.requests SET state='READY',manifest=p_manifest,manifest_sha256=p_sha256,verified_at=clock_timestamp() WHERE request_id=p_request;
END $$;

-- Called only from the existing admission gates (their SECURITY DEFINER owner retains access).
CREATE FUNCTION cat_recovery_test.reserve(p_parent bigint,p_child bigint,p_worker text,p_series text,p_quantity integer)
RETURNS TABLE(reserva_id bigint,folio_inicial bigint,folio_final bigint,cantidad integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE series record; src record; req cat_recovery_test.requests%ROWTYPE; context_id uuid; doc record; new_id bigint;
BEGIN
  PERFORM cat_recovery_test.assert_test();
  SELECT * INTO STRICT series FROM operacion.series_documentales s WHERE s.codigo=p_series FOR UPDATE;
  context_id:=NULLIF(current_setting('cat.recovery_request_id',true),'')::uuid;
  PERFORM set_config('cat.recovery_duplicate','false',true);
  IF context_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM cat_recovery_test.requests r LEFT JOIN ops.ejecuciones_automatizacion e ON e.ejecucion_id=r.child_id
      WHERE r.series_id=series.serie_id AND (r.state IN ('PREPARING','READY') OR (r.state='RESERVED' AND e.estado='PROCESANDO'))) THEN
      RAISE EXCEPTION 'CAT_RECOVERY_SERIES_FENCED'; END IF;
    RETURN QUERY SELECT * FROM operacion.reservar_folios_para_ejecucion(p_child,p_series,p_quantity); RETURN;
  END IF;
  IF NOT (SELECT enabled FROM cat_recovery_test.settings) THEN RAISE EXCEPTION 'CAT_RECOVERY_DISABLED'; END IF;
  SELECT * INTO STRICT req FROM cat_recovery_test.requests r WHERE r.request_id=context_id FOR UPDATE;
  IF p_parent IS NULL OR req.parent_id<>p_parent OR req.series_id<>series.serie_id THEN RAISE EXCEPTION 'CAT_RECOVERY_CONTEXT_MISMATCH'; END IF;
  IF req.state='RESERVED' AND req.child_id=p_child AND req.worker_id=p_worker THEN
    PERFORM set_config('cat.recovery_duplicate','true',true);
    RETURN QUERY SELECT r.reserva_id,r.folio_inicial,r.folio_final,r.cantidad FROM operacion.reservas_folios r WHERE r.reserva_id=req.new_reservation_id; RETURN;
  END IF;
  IF req.state<>'READY' OR req.verified_at<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'CAT_RECOVERY_QUARANTINE_UNPROVEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM security.users u WHERE u.user_id=req.admin_id AND u.role='ADMIN' AND u.status='ACTIVE' AND NOT u.must_change_password) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ADMIN_REQUIRED'; END IF;
  SELECT d.*,e.estado AS parent_state INTO STRICT doc FROM ops.ejecuciones_automatizacion e JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE e.ejecucion_id=p_parent;
  SELECT * INTO STRICT src FROM operacion.reservas_folios r WHERE r.reserva_id=req.original_reservation_id FOR UPDATE;
  IF doc.parent_state<>'ERROR' OR doc.caterpillar_admission IS DISTINCT FROM req.document_snapshot OR doc.hash_archivo IS DISTINCT FROM req.source_sha256
    OR src.estatus<>'ABANDONADA' OR src.cantidad<>p_quantity OR series.siguiente_folio<>src.folio_final+1
    OR EXISTS(SELECT 1 FROM operacion.reservas_folios r WHERE r.serie_id=series.serie_id AND (r.reserva_id>src.reserva_id OR r.folio_final>src.folio_final)) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_RANGE_OR_SOURCE_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM operacion.remisiones m WHERE m.ejecucion_id=p_parent OR (m.serie_id=series.serie_id AND m.folio BETWEEN src.folio_inicial AND src.folio_final)) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_REMISSION_EXISTS'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO' AND e.ejecucion_id<>p_child) THEN RAISE EXCEPTION 'CAT_RECOVERY_OTHER_EXECUTION_PROCESSING'; END IF;
  INSERT INTO operacion.reservas_folios(ejecucion_id,serie_id,folio_inicial,folio_final,cantidad,estatus)
    VALUES(p_child,src.serie_id,src.folio_inicial,src.folio_final,src.cantidad,'RESERVADA') RETURNING reservas_folios.reserva_id INTO new_id;
  UPDATE cat_recovery_test.requests SET state='RESERVED',worker_id=p_worker,child_id=p_child,new_reservation_id=new_id,
    next_folio_before=series.siguiente_folio WHERE request_id=context_id;
  PERFORM set_config('cat.recovery_acquired','true',true);
  RETURN QUERY SELECT new_id,src.folio_inicial,src.folio_final,src.cantidad;
END $$;

CREATE FUNCTION cat_recovery_test.start(p_request uuid,p_worker text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE req cat_recovery_test.requests%ROWTYPE; gate record; src record;
BEGIN
  PERFORM cat_recovery_test.assert_test();
  IF NOT (SELECT enabled FROM cat_recovery_test.settings) THEN RAISE EXCEPTION 'CAT_RECOVERY_DISABLED'; END IF;
  SELECT * INTO STRICT req FROM cat_recovery_test.requests r WHERE r.request_id=p_request;
  IF req.state='RESERVED' THEN RETURN jsonb_build_object('requestId',p_request,'executionId',req.child_id::text,'reservationId',req.new_reservation_id::text,'canEmit',false,'status','ALREADY_RESERVED',
    'admission',req.admission_result||jsonb_build_object('decision','BLOCK','reason','ALREADY_REPROCESSED','can_emit',false)); END IF;
  IF req.state<>'READY' THEN RAISE EXCEPTION 'CAT_RECOVERY_QUARANTINE_UNPROVEN'; END IF;
  SELECT s.codigo,r.cantidad INTO STRICT src FROM operacion.reservas_folios r JOIN operacion.series_documentales s USING(serie_id) WHERE r.reserva_id=req.original_reservation_id;
  PERFORM set_config('cat.recovery_request_id',p_request::text,true);
  PERFORM set_config('cat.recovery_acquired','false',true);
  SELECT * INTO STRICT gate FROM ops.fn_reprocesar_reservar_caterpillar_test(req.parent_id,p_worker,src.codigo,src.cantidad);
  SELECT * INTO STRICT req FROM cat_recovery_test.requests r WHERE r.request_id=p_request;
  IF req.state<>'RESERVED' THEN RAISE EXCEPTION 'CAT_RECOVERY_ADMISSION_REJECTED:%',gate.reason; END IF;
  IF current_setting('cat.recovery_acquired',true)='true' THEN
    UPDATE cat_recovery_test.requests SET admission_result=to_jsonb(gate) WHERE request_id=p_request;
  END IF;
  RETURN jsonb_build_object('requestId',p_request,'executionId',req.child_id::text,'reservationId',req.new_reservation_id::text,
    'canEmit',gate.can_emit AND current_setting('cat.recovery_acquired',true)='true','status','RESERVED',
    'admission',CASE WHEN current_setting('cat.recovery_acquired',true)='true' THEN to_jsonb(gate)
      ELSE req.admission_result||jsonb_build_object('decision','BLOCK','reason','ALREADY_REPROCESSED','can_emit',false) END);
END $$;

CREATE FUNCTION cat_recovery_test.worker_admission(p_request uuid,p_worker text,p_expected_parent bigint)
RETURNS TABLE(decision text,reason text,can_emit boolean,worker_id text,ejecucion_id bigint,reserva_id bigint,
  folio_inicial bigint,folio_final bigint,cantidad integer,legacy_unverified integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM cat_recovery_test.assert_test();
  IF NOT EXISTS(SELECT 1 FROM cat_recovery_test.requests r WHERE r.request_id=p_request AND r.parent_id=p_expected_parent) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_PARENT_TRANSPORT_MISMATCH'; END IF;
  result:=cat_recovery_test.start(p_request,p_worker);
  RETURN QUERY SELECT a.* FROM jsonb_to_record(result->'admission') AS a(decision text,reason text,can_emit boolean,worker_id text,
    ejecucion_id bigint,reserva_id bigint,folio_inicial bigint,folio_final bigint,cantidad integer,legacy_unverified integer);
END $$;

-- Preserve each real gate definition and change ONLY its reservation seam, not its admission rules.
DO $$
DECLARE v_signature text; original text; patched text; anchor text:='SELECT * INTO STRICT reserved FROM operacion.reservar_folios_para_ejecucion(own_id,p_series,p_quantity);'; replacement text;
  return_anchor text:='RETURN QUERY SELECT ''ADMIT'',CASE WHEN created THEN ''REPROCESS_ACQUIRED'' ELSE ''OWNED_RETRY'' END,true,p_worker,own_id,';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY['ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer)',
    'ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)'] LOOP
    original:=pg_get_functiondef(to_regprocedure(v_signature));
    -- pg_dump on Windows emits CRLF; normalize only CR, never SQL tokens or other whitespace.
    IF md5(replace(original,chr(13),'')) IS DISTINCT FROM (CASE WHEN v_signature LIKE 'ops.fn_reprocesar%'
      THEN 'c572b74411b12c3b43166c08b5c56501' ELSE 'ef6d6be62d23fa570eed7c7cb5c624da' END) THEN
      RAISE EXCEPTION 'CAT_RECOVERY_REAL_GATE_FINGERPRINT_CHANGED:%',v_signature; END IF;
    IF original IS NULL OR (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1
      OR position('CAT_ATOMIC_SCHEMA_015' in original)=0 THEN RAISE EXCEPTION 'CAT_RECOVERY_GATE_DRIFT:%',v_signature; END IF;
    replacement:='SELECT * INTO STRICT reserved FROM cat_recovery_test.reserve(' ||
      CASE WHEN v_signature LIKE 'ops.fn_reprocesar%' THEN 'p_parent' ELSE 'NULL::bigint' END || ',own_id,p_worker,p_series,p_quantity);';
    patched:=replace(original,anchor,replacement);
    IF v_signature LIKE 'ops.fn_reprocesar%' THEN
      IF (length(original)-length(replace(original,return_anchor,'')))/length(return_anchor)<>1 THEN RAISE EXCEPTION 'CAT_RECOVERY_GATE_RETURN_DRIFT'; END IF;
      patched:=replace(patched,return_anchor,
        'RETURN QUERY SELECT CASE WHEN current_setting(''cat.recovery_duplicate'',true)=''true'' THEN ''BLOCK'' ELSE ''ADMIT'' END,' ||
        'CASE WHEN current_setting(''cat.recovery_duplicate'',true)=''true'' THEN ''ALREADY_REPROCESSED'' WHEN created THEN ''REPROCESS_ACQUIRED'' ELSE ''OWNED_RETRY'' END,' ||
        '(current_setting(''cat.recovery_duplicate'',true) IS DISTINCT FROM ''true''),p_worker,own_id,');
    END IF;
    INSERT INTO cat_recovery_test.gate_backup VALUES(v_signature,original,NULL);
    EXECUTE patched;
    UPDATE cat_recovery_test.gate_backup SET installed_md5=md5(pg_get_functiondef(to_regprocedure(v_signature))) WHERE gate_backup.signature=v_signature;
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA cat_recovery_test FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cat_recovery_test FROM PUBLIC;
-- Match 015: strip inherited default ACLs on NEW objects, not only PUBLIC grants.
DO $$ DECLARE obj record; acl record; principal text; BEGIN
  FOR obj IN
    SELECT 'SCHEMA' AS kind,quote_ident(nspname) AS name,nspowner AS owner,nspacl AS acl,'n'::"char" AS acltype
      FROM pg_namespace WHERE nspname='cat_recovery_test'
    UNION ALL SELECT 'TABLE',c.oid::regclass::text,c.relowner,c.relacl,'r'::"char" FROM pg_class c
      WHERE c.relnamespace='cat_recovery_test'::regnamespace AND c.relkind='r'
    UNION ALL SELECT 'FUNCTION',p.oid::regprocedure::text,p.proowner,p.proacl,'f'::"char" FROM pg_proc p
      WHERE p.pronamespace='cat_recovery_test'::regnamespace
  LOOP
    FOR acl IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(obj.acl,acldefault(obj.acltype,obj.owner))) WHERE grantee<>obj.owner LOOP
      principal:=CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(acl.grantee)) END;
      EXECUTE 'REVOKE ALL ON '||obj.kind||' '||obj.name||' FROM '||principal;
    END LOOP;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA cat_recovery_test TO daubert_hub_test_user,n8n_cat_test,cat_recovery_test_coordinator;
GRANT EXECUTE ON FUNCTION cat_recovery_test.evaluate(bigint),cat_recovery_test.request(bigint,uuid,bigint,text,boolean) TO daubert_hub_test_user;
GRANT EXECUTE ON FUNCTION cat_recovery_test.attest(uuid,text,text) TO cat_recovery_test_coordinator;
GRANT EXECUTE ON FUNCTION cat_recovery_test.start(uuid,text) TO n8n_cat_test;
GRANT EXECUTE ON FUNCTION cat_recovery_test.worker_admission(uuid,text,bigint) TO n8n_cat_test;
COMMIT;
