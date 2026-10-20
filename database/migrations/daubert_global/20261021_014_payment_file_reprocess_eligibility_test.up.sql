-- 014 (TEST ONLY). Nunca ejecutar en daubert_global. Conexion administrativa requerida.
-- 1) Evaluador compartido (interno, solo lectura) con las reglas de la 013 para un archivo.
-- 2) La funcion de la 013 pasa a delegar en el evaluador: MISMA firma, MISMO contrato, mismos permisos.
-- 3) fn_reproceso_asignaciones_puntuales(correo): consulta de solo lectura para el Hub (elegibilidad de reproceso).
-- No hay tablas nuevas ni modificaciones de datos. El Hub NO recibe permisos de registro ni de toma.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION '014 es solo para daubert_hub_test (conectado a %)', current_database();
  END IF;
  IF to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)') IS NULL THEN
    RAISE EXCEPTION 'Falta la migracion 013';
  END IF;
  IF to_regprocedure('core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '014 ya aplicada';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------------------------------------------
-- Evaluador: reglas de identidad, estado operativo y evidencia de reintento. NO valida procedencia ni version
-- (eso es de la consulta de la 013), NO bloquea filas, NO toma archivos.
--   p_reproceso : el consumidor esta en un reproceso (sin eso un archivo INICIADO es YA_TOMADO)
--   p_despacho  : evaluacion previa al despacho del Hub (el correo aun esta ERROR/PROCESADO, no PENDIENTE)
CREATE FUNCTION core.fn_evaluar_archivo_notificacion_pago(
  p_archivo_id bigint, p_reproceso boolean DEFAULT false, p_despacho boolean DEFAULT false
) RETURNS TABLE (
  resultado text, empresa_id bigint, asignacion_version integer, asignacion_activa boolean,
  estado_identidad text, estado_operativo text, detalle text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE
  v_file core.archivos_notificacion_pago%ROWTYPE;
  v_asig core.asignaciones_archivo_notificacion_pago%ROWTYPE;
  v_activa boolean := false;
  v_correo_estado text;
  v_res_estado text;
  v_borr_estado text;
  v_resultado text;
  v_detalle text := NULL;
BEGIN
  SELECT f.* INTO v_file FROM core.archivos_notificacion_pago f WHERE f.archivo_id = p_archivo_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'CONFLICTO_IDENTIDAD'::text, NULL::bigint, NULL::integer, false, NULL::text, NULL::text, 'ARCHIVO_NO_REGISTRADO'::text;
    RETURN;
  END IF;
  SELECT a.* INTO v_asig FROM core.asignaciones_archivo_notificacion_pago a WHERE a.archivo_id = p_archivo_id AND a.estatus = 'ACTIVA';
  v_activa := FOUND;

  IF v_file.estado_identidad = 'AMBIGUA' THEN
    v_resultado := 'IDENTIDAD_AMBIGUA';
  ELSIF v_file.estado_identidad <> 'VERIFICADA' THEN
    v_resultado := 'IDENTIDAD_NO_VERIFICADA';
  ELSIF v_file.estado_operativo IN ('SIN_EFECTOS', 'REPROCESO_SOLICITADO') THEN
    v_resultado := CASE WHEN v_activa THEN 'PROCESABLE_ASIGNADO' ELSE 'PROCESABLE_SIN_ASIGNACION' END;
  ELSIF v_file.estado_operativo = 'INCIERTO' THEN
    v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'ESTADO_INCIERTO';
  ELSIF v_file.estado_operativo = 'INICIADO' THEN
    -- INICIADO: solo se autoriza una nueva toma con evidencia de idempotencia sobre la empresa asignada.
    IF NOT v_activa OR NOT COALESCE(p_reproceso, false) THEN
      v_resultado := 'YA_TOMADO'; v_detalle := CASE WHEN NOT v_activa THEN 'SIN_ASIGNACION_ACTIVA' ELSE 'NO_ES_REPROCESO' END;
    ELSE
      SELECT c.estado INTO v_correo_estado FROM core.correos_notificacion_pago c WHERE c.correo_id = v_file.correo_id;
      SELECT r.estado::text INTO v_res_estado FROM core.resultados_notificacion_pago r
        WHERE r.correo_id = v_file.correo_id AND r.empresa_id = v_asig.empresa_id;
      SELECT b.estado INTO v_borr_estado FROM core.borradores_notificacion_pago b
        WHERE b.correo_id = v_file.correo_id AND b.empresa_id = v_asig.empresa_id;
      IF v_res_estado IN ('LISTO', 'OMITIDO') THEN
        v_resultado := 'COMPLETADO'; v_detalle := 'RESULTADO_' || v_res_estado;
      ELSIF (NOT COALESCE(p_despacho, false) AND v_correo_estado IS DISTINCT FROM 'PENDIENTE')
         OR (COALESCE(p_despacho, false) AND v_correo_estado IS DISTINCT FROM 'ERROR' AND v_correo_estado IS DISTINCT FROM 'PROCESADO') THEN
        v_resultado := 'EFECTOS_INCIERTOS';
        v_detalle := CASE WHEN COALESCE(p_despacho, false) THEN 'CORREO_NO_REPROCESABLE' ELSE 'CORREO_NO_PENDIENTE' END;
      ELSIF v_res_estado IS NULL THEN
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'TOMADO_SIN_RESULTADO';
      ELSIF v_borr_estado = 'PENDIENTE' THEN
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'BORRADOR_PENDIENTE';
      ELSIF v_borr_estado IS NOT NULL AND v_borr_estado NOT IN ('CREADO', 'ERROR') THEN
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'BORRADOR_DESCONOCIDO';
      ELSIF v_res_estado IN ('MANUAL', 'ERROR') THEN
        v_resultado := 'REINTENTO_ASIGNADO'; v_detalle := 'RESULTADO_' || v_res_estado;
      ELSE
        v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'RESULTADO_DESCONOCIDO';
      END IF;
    END IF;
  ELSE
    v_resultado := 'EFECTOS_INCIERTOS'; v_detalle := 'ESTADO_DESCONOCIDO';
  END IF;

  RETURN QUERY SELECT v_resultado,
    CASE WHEN v_activa THEN v_asig.empresa_id END, CASE WHEN v_activa THEN v_asig.version END,
    v_activa, v_file.estado_identidad, v_file.estado_operativo, v_detalle;
END $fn$;
REVOKE ALL ON FUNCTION core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean) FROM PUBLIC;
DO $revoke$
DECLARE v_rol text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['n8n_app_test', 'n8n_app', 'daubert_hub_test_user', 'daubert_hub_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean) FROM %I', v_rol);
    END IF;
  END LOOP;
END $revoke$;

-- ---------------------------------------------------------------------------------------------------------------
-- 013 -> delega en el evaluador. Misma firma, mismo RETURNS TABLE, mismo orden de precedencia
-- (procedencia -> identidad -> version -> estado operativo). CREATE OR REPLACE conserva los permisos existentes.
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
  v_e record;
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

  SELECT * INTO v_e FROM core.fn_evaluar_archivo_notificacion_pago(p_archivo_id, COALESCE(p_reproceso, false), false);

  IF v_file.correo_id IS DISTINCT FROM p_correo_id OR v_file.adjunto_origen_id IS DISTINCT FROM p_adjunto_origen_id
     OR v_file.zip_sha256 IS DISTINCT FROM p_zip_sha256 OR v_file.entrada_indice IS DISTINCT FROM p_entrada_indice
     OR v_file.file_sha256 IS DISTINCT FROM p_file_sha256 THEN
    v_resultado := 'CONFLICTO_IDENTIDAD'; v_detalle := 'PROCEDENCIA_DISTINTA';
  ELSIF v_e.resultado IN ('IDENTIDAD_AMBIGUA', 'IDENTIDAD_NO_VERIFICADA') THEN
    v_resultado := v_e.resultado; v_detalle := v_e.detalle;
  ELSIF p_version_esperada IS NOT NULL AND (CASE WHEN v_e.asignacion_activa THEN v_e.asignacion_version ELSE 0 END) <> p_version_esperada THEN
    -- version esperada 0 = "sin asignacion activa": detecta cambios del Hub entre la consulta y la toma
    v_resultado := 'CONFLICTO_VERSION';
    v_detalle := 'VERSION_ACTUAL=' || (CASE WHEN v_e.asignacion_activa THEN v_e.asignacion_version ELSE 0 END)::text;
  ELSE
    v_resultado := v_e.resultado; v_detalle := v_e.detalle;
  END IF;

  IF COALESCE(p_tomar, false) AND v_resultado IN ('PROCESABLE_ASIGNADO', 'PROCESABLE_SIN_ASIGNACION', 'REINTENTO_ASIGNADO') THEN
    UPDATE core.archivos_notificacion_pago f SET estado_operativo = 'INICIADO',
      updated_at = clock_timestamp(), updated_by = session_user WHERE f.archivo_id = p_archivo_id;
    v_tomado := true;
  END IF;

  RETURN QUERY SELECT v_resultado, v_file.archivo_id, v_e.empresa_id, v_e.asignacion_version, v_e.asignacion_activa,
    v_e.estado_identidad, v_e.estado_operativo, v_tomado, v_detalle;
END $fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- Elegibilidad de reproceso para el Hub (SOLO LECTURA). Evalua TODOS los archivos con asignacion puntual activa del correo.
-- elegible = true solo si cada uno es seguro: procesable/reintentable con evidencia, o ya completado.
-- Cualquier otro estado, un resultado desconocido o una empresa asignada inactiva bloquea. Sin asignaciones -> elegible.
CREATE FUNCTION core.fn_reproceso_asignaciones_puntuales(p_correo_id bigint)
RETURNS TABLE (elegible boolean, asignaciones_activas integer, bloqueos jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE
  v_total integer := 0;
  v_bloqueos jsonb := '[]'::jsonb;
  v_arch record;
  v_e record;
BEGIN
  IF p_correo_id IS NULL OR NOT EXISTS (SELECT 1 FROM core.correos_notificacion_pago c WHERE c.correo_id = p_correo_id) THEN
    RETURN QUERY SELECT false, 0, jsonb_build_array(jsonb_build_object('archivo_id', NULL, 'resultado', 'CORREO_NO_ENCONTRADO', 'detalle', NULL));
    RETURN;
  END IF;
  FOR v_arch IN
    SELECT f.archivo_id, a.empresa_id
    FROM core.archivos_notificacion_pago f
    JOIN core.asignaciones_archivo_notificacion_pago a ON a.archivo_id = f.archivo_id
    WHERE f.correo_id = p_correo_id AND a.estatus = 'ACTIVA'
    ORDER BY f.archivo_id
  LOOP
    v_total := v_total + 1;
    SELECT * INTO v_e FROM core.fn_evaluar_archivo_notificacion_pago(v_arch.archivo_id, true, true);
    IF v_e.resultado IS NULL OR v_e.resultado NOT IN ('PROCESABLE_ASIGNADO', 'REINTENTO_ASIGNADO', 'COMPLETADO') THEN
      v_bloqueos := v_bloqueos || jsonb_build_array(jsonb_build_object(
        'archivo_id', v_arch.archivo_id::text, 'resultado', COALESCE(v_e.resultado, 'DESCONOCIDO'), 'detalle', v_e.detalle));
    ELSIF NOT EXISTS (SELECT 1 FROM core.empresas e WHERE e.empresa_id = v_arch.empresa_id AND e.estatus = 'ACTIVO') THEN
      v_bloqueos := v_bloqueos || jsonb_build_array(jsonb_build_object(
        'archivo_id', v_arch.archivo_id::text, 'resultado', 'EMPRESA_ASIGNADA_NO_ACTIVA', 'detalle', NULL));
    END IF;
  END LOOP;
  RETURN QUERY SELECT jsonb_array_length(v_bloqueos) = 0, v_total, v_bloqueos;
END $fn$;

REVOKE ALL ON FUNCTION core.fn_reproceso_asignaciones_puntuales(bigint) FROM PUBLIC;
DO $revoke$
DECLARE v_rol text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['n8n_app_test', 'n8n_app', 'daubert_hub_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION core.fn_reproceso_asignaciones_puntuales(bigint) FROM %I', v_rol);
    END IF;
  END LOOP;
END $revoke$;
GRANT EXECUTE ON FUNCTION core.fn_reproceso_asignaciones_puntuales(bigint) TO daubert_hub_test_user;
COMMIT;
