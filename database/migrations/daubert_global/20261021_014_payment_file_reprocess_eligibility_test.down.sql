-- 014 (TEST ONLY): reversa. Restaura el cuerpo original de la 013 (sin evaluador) y elimina las funciones de la 014.
-- No hay datos asociados. La funcion de la 013 conserva sus permisos (CREATE OR REPLACE).
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'solo daubert_hub_test'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION core.fn_consultar_archivo_notificacion_pago(
  p_archivo_id bigint, p_correo_id bigint, p_adjunto_origen_id text, p_zip_sha256 text,
  p_entrada_indice integer, p_file_sha256 text,
  p_tomar boolean DEFAULT false, p_reproceso boolean DEFAULT false, p_version_esperada integer DEFAULT NULL
) RETURNS TABLE (
  resultado text, archivo_id bigint, empresa_id bigint, asignacion_version integer, asignacion_activa boolean,
  estado_identidad text, estado_operativo text, tomado boolean, detalle text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE
  v_file core.archivos_notificacion_pago%ROWTYPE;
  v_asig core.asignaciones_archivo_notificacion_pago%ROWTYPE;
  v_activa boolean := false;
  v_correo_estado text;
  v_res_estado text;
  v_borr_estado text;
  v_resultado text;
  v_detalle text := NULL;
  v_tomado boolean := false;
BEGIN
  IF p_archivo_id IS NULL OR p_correo_id IS NULL OR p_adjunto_origen_id IS NULL OR p_zip_sha256 IS NULL
     OR p_entrada_indice IS NULL OR p_file_sha256 IS NULL THEN
    RETURN QUERY SELECT 'CONFLICTO_IDENTIDAD'::text, p_archivo_id, NULL::bigint, NULL::integer, false, NULL::text, NULL::text, false, 'ARGUMENTOS_INCOMPLETOS'::text;
    RETURN;
  END IF;

  -- Mismo espacio de bloqueo que el registro, la toma, las mutaciones del Hub y el despacho de reproceso.
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT f.* INTO v_file FROM core.archivos_notificacion_pago f WHERE f.archivo_id = p_archivo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'CONFLICTO_IDENTIDAD'::text, p_archivo_id, NULL::bigint, NULL::integer, false, NULL::text, NULL::text, false, 'ARCHIVO_NO_REGISTRADO'::text;
    RETURN;
  END IF;

  SELECT a.* INTO v_asig FROM core.asignaciones_archivo_notificacion_pago a WHERE a.archivo_id = p_archivo_id AND a.estatus = 'ACTIVA';
  v_activa := FOUND;

  IF v_file.correo_id IS DISTINCT FROM p_correo_id OR v_file.adjunto_origen_id IS DISTINCT FROM p_adjunto_origen_id
     OR v_file.zip_sha256 IS DISTINCT FROM p_zip_sha256 OR v_file.entrada_indice IS DISTINCT FROM p_entrada_indice
     OR v_file.file_sha256 IS DISTINCT FROM p_file_sha256 THEN
    v_resultado := 'CONFLICTO_IDENTIDAD'; v_detalle := 'PROCEDENCIA_DISTINTA';
  ELSIF v_file.estado_identidad = 'AMBIGUA' THEN
    v_resultado := 'IDENTIDAD_AMBIGUA';
  ELSIF v_file.estado_identidad <> 'VERIFICADA' THEN
    v_resultado := 'IDENTIDAD_NO_VERIFICADA';
  ELSIF p_version_esperada IS NOT NULL AND (CASE WHEN v_activa THEN v_asig.version ELSE 0 END) <> p_version_esperada THEN
    -- version esperada 0 = "sin asignacion activa": detecta cambios del Hub entre la consulta y la toma
    v_resultado := 'CONFLICTO_VERSION'; v_detalle := 'VERSION_ACTUAL=' || (CASE WHEN v_activa THEN v_asig.version ELSE 0 END)::text;
  ELSIF v_file.estado_operativo IN ('SIN_EFECTOS', 'REPROCESO_SOLICITADO') THEN
    v_resultado := CASE WHEN v_activa THEN 'PROCESABLE_ASIGNADO' ELSE 'PROCESABLE_SIN_ASIGNACION' END;
  ELSIF v_file.estado_operativo = 'INCIERTO' THEN
    v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'ESTADO_INCIERTO';
  ELSE
    -- INICIADO: solo se autoriza una nueva toma con evidencia de idempotencia sobre la empresa asignada.
    IF NOT v_activa OR NOT COALESCE(p_reproceso, false) THEN
      v_resultado := 'YA_TOMADO'; v_detalle := CASE WHEN NOT v_activa THEN 'SIN_ASIGNACION_ACTIVA' ELSE 'NO_ES_REPROCESO' END;
    ELSE
      SELECT c.estado INTO v_correo_estado FROM core.correos_notificacion_pago c WHERE c.correo_id = p_correo_id;
      SELECT r.estado::text INTO v_res_estado FROM core.resultados_notificacion_pago r
        WHERE r.correo_id = p_correo_id AND r.empresa_id = v_asig.empresa_id;
      SELECT b.estado INTO v_borr_estado FROM core.borradores_notificacion_pago b
        WHERE b.correo_id = p_correo_id AND b.empresa_id = v_asig.empresa_id;
      IF v_res_estado IN ('LISTO', 'OMITIDO') THEN
        v_resultado := 'COMPLETADO'; v_detalle := 'RESULTADO_' || v_res_estado;
      ELSIF v_correo_estado IS DISTINCT FROM 'PENDIENTE' THEN
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'CORREO_NO_PENDIENTE';
      ELSIF v_res_estado IS NULL THEN
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'TOMADO_SIN_RESULTADO';
      ELSIF v_borr_estado = 'PENDIENTE' THEN
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'BORRADOR_PENDIENTE';
      ELSIF v_res_estado IN ('MANUAL', 'ERROR') THEN
        v_resultado := 'REINTENTO_ASIGNADO'; v_detalle := 'RESULTADO_' || v_res_estado;
      ELSE
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'RESULTADO_DESCONOCIDO';
      END IF;
    END IF;
  END IF;

  IF COALESCE(p_tomar, false) AND v_resultado IN ('PROCESABLE_ASIGNADO', 'PROCESABLE_SIN_ASIGNACION', 'REINTENTO_ASIGNADO') THEN
    UPDATE core.archivos_notificacion_pago f SET estado_operativo = 'INICIADO',
      updated_at = clock_timestamp(), updated_by = session_user WHERE f.archivo_id = p_archivo_id;
    v_tomado := true;
  END IF;

  RETURN QUERY SELECT v_resultado, v_file.archivo_id,
    CASE WHEN v_activa THEN v_asig.empresa_id END, CASE WHEN v_activa THEN v_asig.version END,
    v_activa, v_file.estado_identidad, v_file.estado_operativo, v_tomado, v_detalle;
END $fn$;

DROP FUNCTION IF EXISTS core.fn_reproceso_asignaciones_puntuales(bigint);
DROP FUNCTION IF EXISTS core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean);
COMMIT;
