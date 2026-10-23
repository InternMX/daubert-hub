-- LOGICAL rollback: retain all evidence, audit, table and column. No payment data are deleted/reset.
-- Quiesce mutations and unpublish/drain the NEW payment parent/children BEFORE this file.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '019 DOWN requires daubert_global'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as the existing object owner postgres'; END IF;
  IF to_regclass('core.recuperaciones_notificacion_pago') IS NULL THEN RAISE EXCEPTION '019 not installed'; END IF;
  IF md5(replace(pg_get_functiondef('core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)'::regprocedure),chr(13),'')) <> '6ba23771b31e8e044faef6517154c9f1'
     OR md5(replace(pg_get_functiondef('core.fn_bloquear_archivos_reproceso_pago(bigint)'::regprocedure),chr(13),'')) <> '98e2927bf8fd35e2a48291b3cf72463c' THEN
    RAISE EXCEPTION 'Installed function drift: do not overwrite a later change';
  END IF;
  IF EXISTS (SELECT 1 FROM core.recuperaciones_notificacion_pago WHERE estado <> 'FINALIZADO') THEN
    RAISE EXCEPTION 'Unresolved processing owner: do not force rollback or fabricate completion';
  END IF;
END $guard$;

-- Exact pre-019 bodies (migration 015), verified against the live read-only baseline.
CREATE OR REPLACE FUNCTION core.fn_archivo_notificacion_asignable(p_archivo_id bigint, p_correo_id bigint, p_bloquear boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE v_correo core.correos_notificacion_pago%ROWTYPE;
BEGIN
  IF p_bloquear THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
    SELECT * INTO v_correo FROM core.correos_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  ELSE
    SELECT * INTO v_correo FROM core.correos_notificacion_pago WHERE correo_id = p_correo_id;
  END IF;
  IF NOT FOUND OR v_correo.estado NOT IN ('ERROR', 'PROCESADO') THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM core.archivos_notificacion_pago f
    WHERE f.archivo_id = p_archivo_id AND f.correo_id = p_correo_id
      AND f.estado_identidad = 'VERIFICADA' AND f.estado_operativo = 'SIN_EFECTOS')
    AND NOT EXISTS (SELECT 1 FROM core.resultados_notificacion_pago WHERE correo_id = p_correo_id)
    AND NOT EXISTS (SELECT 1 FROM core.borradores_notificacion_pago WHERE correo_id = p_correo_id);
END $fn$;

CREATE OR REPLACE FUNCTION core.fn_bloquear_archivos_reproceso_pago(p_correo_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  UPDATE core.archivos_notificacion_pago SET estado_operativo = 'REPROCESO_SOLICITADO',
    updated_at = clock_timestamp(),
    updated_by = COALESCE(NULLIF(current_setting('app.user_id', true), ''), session_user)
    WHERE correo_id = p_correo_id AND estado_operativo = 'SIN_EFECTOS';
END $fn$;

REVOKE ALL ON FUNCTION core.fn_iniciar_recuperacion_pago(bigint,text),
  core.fn_observar_archivos_pago_sin_efectos(bigint,text,jsonb), core.fn_finalizar_recuperacion_pago(bigint,text),
  core.fn_destino_asignacion_pago_disponible(bigint,bigint) FROM PUBLIC, daubert_hub_app, n8n_app;
REVOKE ALL ON core.recuperaciones_notificacion_pago FROM PUBLIC, daubert_hub_app, n8n_app;
DO $verify$
BEGIN
  IF md5(replace(pg_get_functiondef('core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)'::regprocedure),chr(13),'')) <> '72d4a136868329c8258c0479a09facc7'
     OR md5(replace(pg_get_functiondef('core.fn_bloquear_archivos_reproceso_pago(bigint)'::regprocedure),chr(13),'')) <> '4cd80be8f694670024553205fa7f605d' THEN
    RAISE EXCEPTION 'Restored definitions do not match the recorded baseline';
  END IF;
END $verify$;
COMMIT;
