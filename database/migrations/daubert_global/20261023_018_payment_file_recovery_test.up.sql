-- TEST ONLY. No historical backfill. Apply as administrator to daubert_hub_test.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION '018 requires daubert_hub_test'; END IF;
  IF to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)') IS NULL THEN RAISE EXCEPTION '014 required'; END IF;
  IF to_regclass('core.recuperaciones_notificacion_pago') IS NOT NULL THEN RAISE EXCEPTION '018 already installed'; END IF;
END $guard$;

ALTER TABLE core.archivos_notificacion_pago ADD COLUMN sin_efectos_ejecucion text;
CREATE TABLE core.recuperaciones_notificacion_pago (
  correo_id bigint PRIMARY KEY REFERENCES core.correos_notificacion_pago(correo_id),
  ejecucion_id text,
  estado text NOT NULL CHECK (estado IN ('SOLICITADO', 'PROCESANDO', 'FINALIZADO')),
  candidatos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidatos) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER trg_audit_recuperacion_notificacion_pago
AFTER INSERT OR UPDATE OR DELETE ON core.recuperaciones_notificacion_pago
FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('correo_id');
REVOKE ALL ON core.recuperaciones_notificacion_pago FROM PUBLIC, daubert_hub_test_user, n8n_app_test;
GRANT SELECT ON core.recuperaciones_notificacion_pago TO daubert_hub_test_user;

-- A committed dispatch remains closed on timeout, crash, or missing completion evidence.
CREATE OR REPLACE FUNCTION core.fn_bloquear_archivos_reproceso_pago(p_correo_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE v_estado text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT estado INTO v_estado FROM core.correos_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado NOT IN ('ERROR', 'PROCESADO') OR EXISTS (
    SELECT 1 FROM core.recuperaciones_notificacion_pago WHERE correo_id = p_correo_id AND estado <> 'FINALIZADO'
  ) THEN RAISE EXCEPTION 'PAYMENT_RECOVERY_BUSY' USING ERRCODE = 'P4091'; END IF;
  INSERT INTO core.recuperaciones_notificacion_pago(correo_id, estado) VALUES (p_correo_id, 'SOLICITADO')
  ON CONFLICT (correo_id) DO UPDATE SET estado = 'SOLICITADO', candidatos = '[]', updated_at = clock_timestamp();
  UPDATE core.archivos_notificacion_pago SET estado_operativo = 'REPROCESO_SOLICITADO',
    sin_efectos_ejecucion = NULL, updated_at = clock_timestamp(),
    updated_by = COALESCE(NULLIF(current_setting('app.user_id', true), ''), session_user)
    WHERE correo_id = p_correo_id AND estado_operativo = 'SIN_EFECTOS';
END $fn$;

-- Only the first n8n execution may enter the processing subworkflow. Same-ID retries do not re-enter.
CREATE FUNCTION core.fn_iniciar_recuperacion_pago(p_correo_id bigint, p_ejecucion_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE v_estado text; v_run core.recuperaciones_notificacion_pago%ROWTYPE;
BEGIN
  IF p_ejecucion_id IS NULL OR btrim(p_ejecucion_id) = '' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT estado INTO v_estado FROM core.correos_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  SELECT * INTO v_run FROM core.recuperaciones_notificacion_pago WHERE correo_id = p_correo_id;
  IF v_estado IS NULL OR v_estado NOT IN ('ERROR', 'PROCESADO')
     OR v_run.estado = 'PROCESANDO' OR v_run.ejecucion_id = p_ejecucion_id THEN RETURN false; END IF;
  INSERT INTO core.recuperaciones_notificacion_pago(correo_id, ejecucion_id, estado)
    VALUES (p_correo_id, p_ejecucion_id, 'PROCESANDO')
  ON CONFLICT (correo_id) DO UPDATE SET ejecucion_id = p_ejecucion_id, estado = 'PROCESANDO',
    candidatos = '[]', updated_at = clock_timestamp();
  RETURN true;
END $fn$;

-- Trusted n8n records rejected alias files BEFORE any supplier effect. This does not rehabilitate them.
CREATE FUNCTION core.fn_observar_archivos_pago_sin_efectos(p_correo_id bigint, p_ejecucion_id text, p_archivos jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE v_item jsonb; v_file core.archivos_notificacion_pago%ROWTYPE; v_run core.recuperaciones_notificacion_pago%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT * INTO v_run FROM core.recuperaciones_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  IF v_run.estado IS DISTINCT FROM 'PROCESANDO' OR v_run.ejecucion_id IS DISTINCT FROM p_ejecucion_id
     OR p_archivos IS NULL OR jsonb_typeof(p_archivos) <> 'array' THEN
    RAISE EXCEPTION 'PAYMENT_RECOVERY_UNPROVEN';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_archivos) LOOP
    SELECT * INTO v_file FROM core.archivos_notificacion_pago
      WHERE archivo_id = (v_item->>'archivo_id')::bigint AND correo_id = p_correo_id FOR UPDATE;
    IF NOT FOUND OR v_file.estado_identidad <> 'VERIFICADA'
       OR v_file.estado_operativo NOT IN ('SIN_EFECTOS', 'REPROCESO_SOLICITADO')
       OR v_item->'tomado' IS DISTINCT FROM 'false'::jsonb
       OR v_file.adjunto_origen_id IS DISTINCT FROM v_item->>'adjunto_origen_id'
       OR v_file.zip_sha256 IS DISTINCT FROM v_item->>'zip_sha256'
       OR v_file.entrada_indice IS DISTINCT FROM (v_item->>'entrada_indice')::integer
       OR v_file.file_sha256 IS DISTINCT FROM v_item->>'file_sha256'
       OR v_file.nombre_archivo IS DISTINCT FROM v_item->>'nombre_archivo'
       OR v_file.codigo_error IS NULL OR v_file.codigo_error NOT IN ('ALIAS_NO_CATALOGADO', 'ALIAS_AMBIGUO')
       OR v_file.codigo_error IS DISTINCT FROM v_item->>'codigo_error' THEN
      RAISE EXCEPTION 'PAYMENT_RECOVERY_UNPROVEN';
    END IF;
  END LOOP;
  UPDATE core.recuperaciones_notificacion_pago SET candidatos = (
    SELECT COALESCE(jsonb_agg(DISTINCT value), '[]') FROM jsonb_array_elements(candidatos || p_archivos)
  ), updated_at = clock_timestamp() WHERE correo_id = p_correo_id;
  RETURN true;
END $fn$;

-- Called by the parent ONLY after Execute Workflow (wait=true) has completed successfully.
CREATE FUNCTION core.fn_finalizar_recuperacion_pago(p_correo_id bigint, p_ejecucion_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE v_run core.recuperaciones_notificacion_pago%ROWTYPE; v_estado text; v_item jsonb; v_count integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT estado INTO v_estado FROM core.correos_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  SELECT * INTO v_run FROM core.recuperaciones_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  IF v_run.ejecucion_id IS DISTINCT FROM p_ejecucion_id OR v_estado IS NULL OR v_estado NOT IN ('ERROR', 'PROCESADO') THEN
    RAISE EXCEPTION 'PAYMENT_RECOVERY_UNPROVEN';
  END IF;
  IF v_run.estado = 'FINALIZADO' THEN RETURN 0; END IF;
  IF v_run.estado IS DISTINCT FROM 'PROCESANDO' THEN RAISE EXCEPTION 'PAYMENT_RECOVERY_UNPROVEN'; END IF;
  -- Revalidate source identity and absence of a claim after ALL processing has finished.
  PERFORM core.fn_observar_archivos_pago_sin_efectos(p_correo_id, p_ejecucion_id, v_run.candidatos);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_run.candidatos) LOOP
    UPDATE core.archivos_notificacion_pago SET estado_operativo = 'SIN_EFECTOS',
      sin_efectos_ejecucion = p_ejecucion_id, updated_at = clock_timestamp(), updated_by = session_user
      WHERE archivo_id = (v_item->>'archivo_id')::bigint AND correo_id = p_correo_id;
    v_count := v_count + 1;
  END LOOP;
  UPDATE core.recuperaciones_notificacion_pago SET estado = 'FINALIZADO', updated_at = clock_timestamp()
    WHERE correo_id = p_correo_id;
  RETURN v_count;
END $fn$;

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
  IF NOT FOUND OR v_correo.estado NOT IN ('ERROR', 'PROCESADO') OR EXISTS (
    SELECT 1 FROM core.recuperaciones_notificacion_pago WHERE correo_id = p_correo_id AND estado <> 'FINALIZADO'
  ) THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM core.archivos_notificacion_pago f
    WHERE f.archivo_id = p_archivo_id AND f.correo_id = p_correo_id AND f.estado_identidad = 'VERIFICADA'
      AND f.estado_operativo = 'SIN_EFECTOS'
      AND (EXISTS (
        SELECT 1 FROM core.recuperaciones_notificacion_pago r WHERE r.correo_id = p_correo_id
          AND r.estado = 'FINALIZADO' AND r.ejecucion_id = f.sin_efectos_ejecucion
      ) OR (
        NOT EXISTS (SELECT 1 FROM core.resultados_notificacion_pago WHERE correo_id = p_correo_id)
        AND NOT EXISTS (SELECT 1 FROM core.borradores_notificacion_pago WHERE correo_id = p_correo_id)
      ))
  );
END $fn$;

-- A new file must not be attached silently to an already processed company's aggregate draft.
CREATE FUNCTION core.fn_destino_asignacion_pago_disponible(p_correo_id bigint, p_empresa_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
  SELECT p_correo_id IS NOT NULL AND p_empresa_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM core.resultados_notificacion_pago WHERE correo_id = p_correo_id AND empresa_id = p_empresa_id)
    AND NOT EXISTS (SELECT 1 FROM core.borradores_notificacion_pago WHERE correo_id = p_correo_id AND empresa_id = p_empresa_id);
$fn$;

REVOKE ALL ON FUNCTION core.fn_iniciar_recuperacion_pago(bigint,text),
  core.fn_observar_archivos_pago_sin_efectos(bigint,text,jsonb), core.fn_finalizar_recuperacion_pago(bigint,text),
  core.fn_destino_asignacion_pago_disponible(bigint,bigint) FROM PUBLIC, daubert_hub_test_user, n8n_app_test;
GRANT EXECUTE ON FUNCTION core.fn_iniciar_recuperacion_pago(bigint,text),
  core.fn_observar_archivos_pago_sin_efectos(bigint,text,jsonb), core.fn_finalizar_recuperacion_pago(bigint,text) TO n8n_app_test;
GRANT EXECUTE ON FUNCTION core.fn_destino_asignacion_pago_disponible(bigint,bigint) TO daubert_hub_test_user;
COMMIT;
