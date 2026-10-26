-- Focused contract check, ONLY in the disposable PR17 database (never daubert_global).
-- Run with psql ON_ERROR_STOP=1; fixture rows/role and audit writes are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $guard$
BEGIN
  IF current_database() <> 'review_interrupted' THEN RAISE EXCEPTION 'Disposable PR17 database required'; END IF;
END $guard$;
CREATE ROLE review17_start_noexec NOLOGIN;
GRANT USAGE ON SCHEMA core TO review17_start_noexec;
DO $test$
DECLARE
  v_mail bigint;
  v_other bigint;
  v_label text := 'HUB_TEST_START_CONTRACT_' || txid_current()::text;
BEGIN
  IF has_function_privilege('daubert_hub_app','core.fn_iniciar_recuperacion_pago(bigint,text)','EXECUTE')
     OR has_function_privilege('review17_start_noexec','core.fn_iniciar_recuperacion_pago(bigint,text)','EXECUTE')
     OR NOT has_function_privilege('n8n_app','core.fn_iniciar_recuperacion_pago(bigint,text)','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
                WHERE p.oid='core.fn_iniciar_recuperacion_pago(bigint,text)'::regprocedure AND a.grantee=0) THEN
    RAISE EXCEPTION 'Unexpected start function authorization';
  END IF;
  INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado)
    VALUES (v_label,'ERROR') RETURNING correo_id INTO v_mail;
  SET LOCAL ROLE daubert_hub_app;
  BEGIN
    PERFORM core.fn_iniciar_recuperacion_pago(v_mail,'forged-by-hub');
    RAISE EXCEPTION 'Hub role unexpectedly started a recovery';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE review17_start_noexec;
  BEGIN
    PERFORM core.fn_iniciar_recuperacion_pago(v_mail,'forged-by-unprivileged-role');
    RAISE EXCEPTION 'Unprivileged role unexpectedly started a recovery';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM core.recuperaciones_notificacion_pago WHERE correo_id=v_mail) THEN
    RAISE EXCEPTION 'Denied calls created an owner';
  END IF;
  RAISE NOTICE 'PASS real permission denial for Hub and unprivileged caller; no owner created';

  SET LOCAL ROLE n8n_app;
  IF core.fn_iniciar_recuperacion_pago(v_mail,'manual-owner') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Trusted manual start without SOLICITADO must succeed';
  END IF;
  IF core.fn_iniciar_recuperacion_pago(v_mail,'manual-owner') IS DISTINCT FROM false
     OR core.fn_iniciar_recuperacion_pago(v_mail,'competing-owner') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Duplicate or competing executor entered';
  END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM core.recuperaciones_notificacion_pago
    WHERE correo_id=v_mail AND estado='PROCESANDO' AND ejecucion_id='manual-owner') THEN
    RAISE EXCEPTION 'Manual owner not persisted correctly';
  END IF;
  RAISE NOTICE 'PASS terminal ERROR manual start without reservation; same-ID and competing starts rejected';

  INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado)
    VALUES (v_label || '_processed','PROCESADO') RETURNING correo_id INTO v_other;
  SET LOCAL ROLE n8n_app;
  IF core.fn_iniciar_recuperacion_pago(v_other,NULL) IS DISTINCT FROM false
     OR core.fn_iniciar_recuperacion_pago(v_other,'  ') IS DISTINCT FROM false
     OR core.fn_iniciar_recuperacion_pago(v_other,'processed-manual') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Invalid execution ID/PROCESADO manual contract';
  END IF;
  RESET ROLE;

  INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado)
    VALUES (v_label || '_reserved','ERROR') RETURNING correo_id INTO v_other;
  INSERT INTO core.recuperaciones_notificacion_pago(correo_id,estado) VALUES (v_other,'SOLICITADO');
  SET LOCAL ROLE n8n_app;
  IF core.fn_iniciar_recuperacion_pago(v_other,'hub-dispatched') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Existing SOLICITADO must be claimable by trusted n8n';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS PROCESADO manual start, invalid IDs and Hub reservation consumption';

  INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado)
    VALUES (v_label || '_finalized','ERROR') RETURNING correo_id INTO v_other;
  -- Synthetic initial state, not a finalization of any real execution.
  INSERT INTO core.recuperaciones_notificacion_pago(correo_id,estado,ejecucion_id)
    VALUES (v_other,'FINALIZADO','previous-owner');
  SET LOCAL ROLE n8n_app;
  IF core.fn_iniciar_recuperacion_pago(v_other,'previous-owner') IS DISTINCT FROM false
     OR core.fn_iniciar_recuperacion_pago(v_other,'new-manual-owner') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Finalized replay/new manual execution contract';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS finalized ID replay rejected; fresh authorized manual owner accepted';

  INSERT INTO core.correos_notificacion_pago(outlook_message_id,estado)
    VALUES (v_label || '_pending','PENDIENTE') RETURNING correo_id INTO v_other;
  SET LOCAL ROLE n8n_app;
  IF core.fn_iniciar_recuperacion_pago(v_other,'pending') IS DISTINCT FROM false
     OR core.fn_iniciar_recuperacion_pago(-1,'missing') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Pending/missing mail was accepted';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS PENDIENTE and nonexistent mail rejected';
END $test$;
ROLLBACK;
