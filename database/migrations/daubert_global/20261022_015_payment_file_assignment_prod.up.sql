-- Administrative connection required. Does not change existing tables/workflows/roles.
-- New objects only; no historical backfill and no registration endpoint for the browser.
-- 015 (012 TEST) (PRODUCCION). Candidata: NO aplicar sin autorizacion expresa. Ver docs/automations/payment-notifications/production-rollout.md
-- Tablas y funciones de registro/asignacion puntual de archivos de Notificaciones de Pago.
-- Cuerpo de tablas y funciones identico a la migracion TEST equivalente (validada en daubert_hub_test); solo cambian las guardas de base y los permisos.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN
    RAISE EXCEPTION '015 is PRODUCTION-only (daubert_global); connected to %', current_database();
  END IF;
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN
    RAISE EXCEPTION 'Administrative connection with CREATE on core is required';
  END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NOT NULL
     OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NOT NULL THEN
    RAISE EXCEPTION '015 objects already exist; refusing to replace them';
  END IF;
END $guard$;

CREATE TABLE core.archivos_notificacion_pago (
  archivo_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correo_id bigint NOT NULL REFERENCES core.correos_notificacion_pago(correo_id) ON DELETE RESTRICT,
  adjunto_origen_id text NOT NULL CHECK (length(btrim(adjunto_origen_id)) BETWEEN 1 AND 2048),
  zip_sha256 text NOT NULL CHECK (zip_sha256 ~ '^[0-9a-f]{64}$'),
  entrada_indice integer NOT NULL CHECK (entrada_indice >= 0),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  nombre_archivo text NOT NULL CHECK (length(btrim(nombre_archivo)) BETWEEN 1 AND 1000),
  alias_detectado text,
  codigo_error text CHECK (codigo_error IS NULL OR codigo_error ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  estado_identidad text NOT NULL DEFAULT 'NO_VERIFICADA'
    CHECK (estado_identidad IN ('NO_VERIFICADA', 'VERIFICADA', 'AMBIGUA')),
  estado_operativo text NOT NULL DEFAULT 'INCIERTO'
    CHECK (estado_operativo IN ('INCIERTO', 'SIN_EFECTOS', 'REPROCESO_SOLICITADO', 'INICIADO')),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_archivo_notificacion_origen UNIQUE (correo_id, adjunto_origen_id, zip_sha256, entrada_indice)
);
CREATE INDEX idx_archivo_notificacion_correo ON core.archivos_notificacion_pago(correo_id);

CREATE TABLE core.asignaciones_archivo_notificacion_pago (
  archivo_id bigint PRIMARY KEY REFERENCES core.archivos_notificacion_pago(archivo_id) ON DELETE RESTRICT,
  empresa_id bigint NOT NULL REFERENCES core.empresas(empresa_id) ON DELETE RESTRICT,
  estatus text NOT NULL CHECK (estatus IN ('ACTIVA', 'REVOCADA')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER trg_audit_archivo_notificacion_pago
AFTER INSERT OR UPDATE OR DELETE ON core.archivos_notificacion_pago
FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('archivo_id');
CREATE TRIGGER trg_audit_asignacion_archivo_notificacion_pago
AFTER INSERT OR UPDATE OR DELETE ON core.asignaciones_archivo_notificacion_pago
FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('archivo_id');

-- Shared lock namespace: trusted registration/claim, Hub assignment and Hub dispatch must
-- serialize by correo. A file hash is never used as the occurrence identifier.
CREATE FUNCTION core.fn_registrar_archivo_notificacion_pago(
  p_correo_id bigint, p_adjunto_origen_id text, p_zip_sha256 text,
  p_entrada_indice integer, p_file_sha256 text, p_nombre_archivo text,
  p_alias_detectado text DEFAULT NULL, p_codigo_error text DEFAULT NULL,
  p_identidad_verificada boolean DEFAULT false, p_sin_efectos_verificado boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE
  v_file core.archivos_notificacion_pago%ROWTYPE;
  v_correo core.correos_notificacion_pago%ROWTYPE;
  v_ambigua boolean;
  v_operativo text := 'INCIERTO';
BEGIN
  IF p_correo_id IS NULL OR p_correo_id <= 0 OR p_adjunto_origen_id IS NULL
     OR btrim(p_adjunto_origen_id) = '' OR p_entrada_indice IS NULL OR p_entrada_indice < 0
     OR p_zip_sha256 IS NULL OR p_zip_sha256 !~ '^[0-9a-f]{64}$'
     OR p_file_sha256 IS NULL OR p_file_sha256 !~ '^[0-9a-f]{64}$'
     OR p_nombre_archivo IS NULL OR btrim(p_nombre_archivo) = '' THEN
    RAISE EXCEPTION 'PAYMENT_FILE_INVALID_PROVENANCE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT * INTO v_correo FROM core.correos_notificacion_pago WHERE correo_id = p_correo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_MAIL_NOT_FOUND'; END IF;
  SELECT * INTO v_file FROM core.archivos_notificacion_pago
    WHERE correo_id = p_correo_id AND adjunto_origen_id = p_adjunto_origen_id
      AND zip_sha256 = p_zip_sha256 AND entrada_indice = p_entrada_indice FOR UPDATE;
  IF FOUND THEN
    IF v_file.file_sha256 IS DISTINCT FROM p_file_sha256 OR v_file.nombre_archivo IS DISTINCT FROM p_nombre_archivo THEN
      UPDATE core.archivos_notificacion_pago SET estado_identidad = 'AMBIGUA',
        updated_at = clock_timestamp(), updated_by = session_user
        WHERE archivo_id = v_file.archivo_id;
    END IF;
    -- Idempotent re-registration NEVER resets a claim/uncertain state or replaces immutable
    -- provenance. Reconciliation of an ambiguous/old file is intentionally out of scope.
    RETURN v_file.archivo_id;
  END IF;
  v_ambigua := EXISTS (SELECT 1 FROM core.archivos_notificacion_pago
    WHERE correo_id = p_correo_id AND adjunto_origen_id = p_adjunto_origen_id
      AND zip_sha256 <> p_zip_sha256);
  IF v_ambigua THEN
    UPDATE core.archivos_notificacion_pago SET estado_identidad = 'AMBIGUA',
      updated_at = clock_timestamp(), updated_by = session_user
      WHERE correo_id = p_correo_id AND adjunto_origen_id = p_adjunto_origen_id;
  END IF;
  -- Positive attestation is accepted ONLY from the trusted registrar, before an initial
  -- processing run. Missing attestation, legacy errors and any persisted effects fail closed.
  IF p_identidad_verificada AND p_sin_efectos_verificado AND NOT v_ambigua
     AND v_correo.estado = 'PENDIENTE'
     AND NOT EXISTS (SELECT 1 FROM core.resultados_notificacion_pago WHERE correo_id = p_correo_id)
     AND NOT EXISTS (SELECT 1 FROM core.borradores_notificacion_pago WHERE correo_id = p_correo_id) THEN
    v_operativo := 'SIN_EFECTOS';
  END IF;
  INSERT INTO core.archivos_notificacion_pago (
    correo_id, adjunto_origen_id, zip_sha256, entrada_indice, file_sha256, nombre_archivo,
    alias_detectado, codigo_error, estado_identidad, estado_operativo, created_by, updated_by
  ) VALUES (
    p_correo_id, p_adjunto_origen_id, p_zip_sha256, p_entrada_indice, p_file_sha256, p_nombre_archivo,
    p_alias_detectado, p_codigo_error,
    CASE WHEN v_ambigua THEN 'AMBIGUA' WHEN p_identidad_verificada THEN 'VERIFICADA' ELSE 'NO_VERIFICADA' END,
    v_operativo, session_user, session_user
  ) RETURNING archivo_id INTO v_file.archivo_id;
  RETURN v_file.archivo_id;
END $fn$;

-- Read/claim contract for the trusted extractor. All provenance must match; a mismatch must
-- stop that file rather than silently fall back to aliases. tomar=true freezes assignments
-- BEFORE any copy/draft effect, in the same transaction as resolving the selected company.
CREATE FUNCTION core.fn_resolver_archivo_notificacion_pago(
  p_archivo_id bigint, p_correo_id bigint, p_adjunto_origen_id text, p_zip_sha256 text,
  p_entrada_indice integer, p_file_sha256 text, p_tomar boolean DEFAULT false
) RETURNS TABLE (archivo_id bigint, empresa_id bigint, asignacion_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
DECLARE v_file core.archivos_notificacion_pago%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  SELECT f.* INTO v_file FROM core.archivos_notificacion_pago f WHERE f.archivo_id = p_archivo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_FILE_NOT_FOUND'; END IF;
  IF v_file.correo_id IS DISTINCT FROM p_correo_id OR v_file.adjunto_origen_id IS DISTINCT FROM p_adjunto_origen_id
     OR v_file.zip_sha256 IS DISTINCT FROM p_zip_sha256 OR v_file.entrada_indice IS DISTINCT FROM p_entrada_indice
     OR v_file.file_sha256 IS DISTINCT FROM p_file_sha256 OR v_file.estado_identidad <> 'VERIFICADA' THEN
    RAISE EXCEPTION 'PAYMENT_FILE_IDENTITY_MISMATCH';
  END IF;
  IF v_file.estado_operativo NOT IN ('SIN_EFECTOS', 'REPROCESO_SOLICITADO') THEN
    RAISE EXCEPTION 'PAYMENT_FILE_EFFECTS_UNCERTAIN';
  END IF;
  IF p_tomar THEN
    UPDATE core.archivos_notificacion_pago f SET estado_operativo = 'INICIADO',
      updated_at = clock_timestamp(), updated_by = session_user WHERE f.archivo_id = p_archivo_id;
  END IF;
  RETURN QUERY SELECT v_file.archivo_id, a.empresa_id, a.version
    FROM (SELECT 1) one_row LEFT JOIN core.asignaciones_archivo_notificacion_pago a
      ON a.archivo_id = p_archivo_id AND a.estatus = 'ACTIVA';
END $fn$;

-- Narrow security helper: the Hub must not need general SELECT access to Outlook draft IDs.
-- Also locks the correo row so a cooperating processing claim cannot cross a Hub mutation.
CREATE FUNCTION core.fn_archivo_notificacion_asignable(p_archivo_id bigint, p_correo_id bigint, p_bloquear boolean DEFAULT false)
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

-- Hub dispatch freezes registered files even on an uncertain webhook outcome. It cannot
-- manufacture identities or reset safety. Caller holds the same correo transaction lock.
CREATE FUNCTION core.fn_bloquear_archivos_reproceso_pago(p_correo_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, core AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || p_correo_id::text, 0));
  UPDATE core.archivos_notificacion_pago SET estado_operativo = 'REPROCESO_SOLICITADO',
    updated_at = clock_timestamp(),
    updated_by = COALESCE(NULLIF(current_setting('app.user_id', true), ''), session_user)
    WHERE correo_id = p_correo_id AND estado_operativo = 'SIN_EFECTOS';
END $fn$;

REVOKE ALL ON core.archivos_notificacion_pago, core.asignaciones_archivo_notificacion_pago
  FROM PUBLIC, n8n_app, daubert_hub_app;
REVOKE ALL ON SEQUENCE core.archivos_notificacion_pago_archivo_id_seq
  FROM PUBLIC, n8n_app, daubert_hub_app;
GRANT SELECT ON core.archivos_notificacion_pago TO daubert_hub_app;
GRANT SELECT, INSERT, UPDATE ON core.asignaciones_archivo_notificacion_pago TO daubert_hub_app;
REVOKE ALL ON FUNCTION core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean) FROM PUBLIC, daubert_hub_app;
REVOKE ALL ON FUNCTION core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean) FROM PUBLIC, daubert_hub_app;
REVOKE ALL ON FUNCTION core.fn_archivo_notificacion_asignable(bigint,bigint,boolean) FROM PUBLIC, n8n_app;
REVOKE ALL ON FUNCTION core.fn_bloquear_archivos_reproceso_pago(bigint) FROM PUBLIC, n8n_app;
GRANT EXECUTE ON FUNCTION core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean) TO n8n_app;
-- fn_resolver (012) NO se concede a n8n_app: el workflow usa fn_consultar (016), que ya incluye la resolucion y la toma.
GRANT EXECUTE ON FUNCTION core.fn_archivo_notificacion_asignable(bigint,bigint,boolean) TO daubert_hub_app;
GRANT EXECUTE ON FUNCTION core.fn_bloquear_archivos_reproceso_pago(bigint) TO daubert_hub_app;

DO $verify$
BEGIN
  IF has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'INSERT')
     OR has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'UPDATE')
     OR has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'DELETE')
     OR has_function_privilege('daubert_hub_app', 'core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean)', 'EXECUTE')
     OR has_function_privilege('daubert_hub_app', 'core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unsafe Hub access to trusted registry';
  END IF;
END $verify$;
COMMIT;
