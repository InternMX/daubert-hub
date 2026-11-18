BEGIN;
SET LOCAL lock_timeout = '10s';

DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '027 requires postgres exclusively in daubert_hub_test';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('ops','operacion') AND p.proname LIKE '%audi_test'
  ) THEN
    RAISE EXCEPTION '027 requires review of existing Audi TEST functions';
  END IF;
END;
$guard$;

CREATE TABLE ops.acciones_recuperacion_ejecucion (
  accion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejecucion_id bigint NOT NULL REFERENCES ops.ejecuciones_automatizacion ON DELETE RESTRICT,
  accion text NOT NULL CHECK (accion IN ('REPROCESS','RECONCILE','STOP','CANCEL')),
  estado text NOT NULL CHECK (estado IN ('EN_CURSO','COMPLETADA','FALLIDA','EXPIRADA')),
  motivo text NOT NULL CHECK (motivo = btrim(motivo) AND length(motivo) BETWEEN 1 AND 500),
  actor_user_id bigint REFERENCES security.users ON DELETE SET NULL,
  actor_nombre text NOT NULL,
  actor_email text NOT NULL,
  request_id text NOT NULL UNIQUE,
  worker text,
  token_fencing uuid,
  ultimo_latido_en timestamptz,
  expira_en timestamptz NOT NULL,
  ejecucion_hija_id bigint REFERENCES ops.ejecuciones_automatizacion ON DELETE RESTRICT,
  codigo_resultado text,
  resultado jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CHECK ((estado = 'EN_CURSO') = (finished_at IS NULL))
);

CREATE UNIQUE INDEX uq_audi_recuperacion_en_curso
  ON ops.acciones_recuperacion_ejecucion(ejecucion_id) WHERE estado = 'EN_CURSO';

-- Tracks provenance without changing the shared reservation ledger.
CREATE TABLE operacion.reservas_admitidas_audi_test (
  ejecucion_id bigint PRIMARY KEY REFERENCES ops.ejecuciones_automatizacion ON DELETE RESTRICT,
  reserva_id bigint NOT NULL UNIQUE REFERENCES operacion.reservas_folios ON DELETE RESTRICT
);

CREATE TABLE operacion.artefactos_ejecucion (
  artefacto_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejecucion_id bigint NOT NULL REFERENCES ops.ejecuciones_automatizacion ON DELETE RESTRICT,
  accion_id bigint REFERENCES ops.acciones_recuperacion_ejecucion ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN ('REMISION_PDF','HOJAS_IDENTIFICACION_PDF')),
  remision_id bigint REFERENCES operacion.remisiones ON DELETE RESTRICT,
  folio bigint,
  ruta text NOT NULL CHECK (btrim(ruta) <> ''),
  tamano_bytes bigint CHECK (tamano_bytes > 0),
  sha256 char(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  estado text NOT NULL CHECK (estado IN ('VERIFICADO','FALTANTE')),
  version int NOT NULL CHECK (version >= 1),
  reemplaza_artefacto_id bigint UNIQUE REFERENCES operacion.artefactos_ejecucion ON DELETE RESTRICT,
  worker text NOT NULL,
  verificado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((tipo = 'REMISION_PDF') = (remision_id IS NOT NULL)),
  CHECK ((version = 1) = (reemplaza_artefacto_id IS NULL)),
  CHECK (estado <> 'VERIFICADO' OR (tamano_bytes IS NOT NULL AND sha256 IS NOT NULL))
);

CREATE UNIQUE INDEX uq_audi_artefacto_version
  ON operacion.artefactos_ejecucion(ejecucion_id,tipo,COALESCE(remision_id,0),version);

CREATE FUNCTION ops.fn_proteger_historial_audi_test() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'acciones_recuperacion_ejecucion' AND TG_OP = 'UPDATE' AND OLD.estado = 'EN_CURSO' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AUDI_RECOVERY_HISTORY_IMMUTABLE' USING ERRCODE = '55000';
END;
$fn$;

CREATE TRIGGER trg_audi_accion_terminal BEFORE UPDATE OR DELETE ON ops.acciones_recuperacion_ejecucion
  FOR EACH ROW EXECUTE FUNCTION ops.fn_proteger_historial_audi_test();
CREATE TRIGGER trg_audi_evidencia_inmutable BEFORE UPDATE OR DELETE ON operacion.artefactos_ejecucion
  FOR EACH ROW EXECUTE FUNCTION ops.fn_proteger_historial_audi_test();

CREATE FUNCTION ops.fn_elegibilidad_audi_test(p_ejecucion bigint, p_accion text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  e ops.ejecuciones_automatizacion%ROWTYPE;
  v_reserva text;
BEGIN
  SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x
    JOIN ops.automatizaciones a USING (automatizacion_id)
    WHERE x.ejecucion_id = p_ejecucion AND a.codigo = 'REMISIONES_AUDI';
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT r.estatus INTO v_reserva FROM operacion.reservas_admitidas_audi_test m
    JOIN operacion.reservas_folios r USING (reserva_id) WHERE m.ejecucion_id = p_ejecucion;
  IF p_accion = 'STOP' AND e.estado = 'PROCESANDO' AND e.n8n_execution_id IS NOT NULL THEN RETURN 'ELIGIBLE'; END IF;
  IF v_reserva IS NULL THEN RETURN 'LEGACY_EXECUTION'; END IF;

  CASE p_accion
    WHEN 'REPROCESS' THEN
      IF e.estado NOT IN ('ERROR','CANCELADA') THEN RETURN 'NOT_ELIGIBLE_STATE'; END IF;
      IF EXISTS (SELECT 1 FROM operacion.artefactos_ejecucion WHERE ejecucion_id = p_ejecucion)
        THEN RETURN 'PARTIAL_ARTIFACTS'; END IF;
      IF v_reserva = 'RESERVADA' OR EXISTS (SELECT 1 FROM operacion.remisiones
        WHERE ejecucion_id = p_ejecucion AND estatus <> 'CANCELADA')
        THEN RETURN 'PENDING_RECONCILIATION'; END IF;
      IF EXISTS (SELECT 1 FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id = p_ejecucion)
        THEN RETURN 'ALREADY_REPROCESSED'; END IF;
    WHEN 'RECONCILE' THEN
      IF e.estado = 'COMPLETADA' THEN RETURN 'ALREADY_COMPLETED'; END IF;
      IF e.estado <> 'ERROR' OR v_reserva <> 'RESERVADA' THEN RETURN 'NOT_ELIGIBLE_STATE'; END IF;
    WHEN 'CANCEL' THEN
      IF e.estado = 'CANCELADA' THEN RETURN 'ALREADY_CANCELLED'; END IF;
      IF EXISTS (SELECT 1 FROM operacion.remisiones WHERE ejecucion_id = p_ejecucion AND estatus = 'GENERADA')
        THEN RETURN 'REMISSIONS_ISSUED'; END IF;
      IF EXISTS (SELECT 1 FROM operacion.artefactos_ejecucion WHERE ejecucion_id = p_ejecucion AND estado = 'VERIFICADO')
        THEN RETURN 'PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION'; END IF;
      IF e.estado NOT IN ('ERROR','PROCESANDO') OR v_reserva <> 'RESERVADA' THEN RETURN 'NOT_ELIGIBLE_STATE'; END IF;
    ELSE RETURN 'NOT_ELIGIBLE_STATE';
  END CASE;
  RETURN 'ELIGIBLE';
END;
$fn$;

CREATE FUNCTION ops.fn_validar_intento_audi_test(p_accion_id bigint, p_worker text, p_token uuid, p_claim boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  a ops.acciones_recuperacion_ejecucion%ROWTYPE;
BEGIN
  SELECT * INTO a FROM ops.acciones_recuperacion_ejecucion WHERE accion_id = p_accion_id FOR UPDATE;
  IF NOT FOUND OR a.estado <> 'EN_CURSO' THEN RETURN 'STALE_ATTEMPT'; END IF;
  IF a.expira_en <= clock_timestamp() THEN
    UPDATE ops.acciones_recuperacion_ejecucion SET estado = 'EXPIRADA',
      codigo_resultado = 'LEASE_EXPIRED', finished_at = clock_timestamp() WHERE accion_id = p_accion_id;
    RETURN 'ATTEMPT_EXPIRED';
  END IF;
  IF p_claim THEN
    IF a.worker IS NOT NULL AND a.worker IS DISTINCT FROM p_worker THEN RETURN 'ALREADY_CLAIMED'; END IF;
    IF NULLIF(btrim(p_worker),'') IS NULL THEN RETURN 'STALE_ATTEMPT'; END IF;
  ELSIF p_token IS NULL OR a.worker IS DISTINCT FROM p_worker OR a.token_fencing IS DISTINCT FROM p_token THEN
    RETURN 'STALE_ATTEMPT';
  END IF;
  RETURN 'VALID';
END;
$fn$;

CREATE FUNCTION ops.fn_renovar_intento_audi_test(p_accion_id bigint)
RETURNS timestamptz LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  UPDATE ops.acciones_recuperacion_ejecucion
  SET ultimo_latido_en = clock_timestamp(), expira_en = clock_timestamp() + interval '15 minutes'
  WHERE accion_id = p_accion_id RETURNING expira_en
$fn$;

CREATE FUNCTION ops.fn_autorizar_accion_audi_test(
  p_ejecucion bigint, p_accion text, p_motivo text, p_expected_revision text,
  p_actor_user_id bigint, p_request_id text
) RETURNS TABLE(outcome text, accion_id bigint, revision text, attempt_estado text, claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  e ops.ejecuciones_automatizacion%ROWTYPE;
  a ops.acciones_recuperacion_ejecucion%ROWTYPE;
  v_nombre text;
  v_email text;
  c_lease constant interval := interval '15 minutes';
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'AUDI_RECOVERY_READ_COMMITTED_REQUIRED' USING ERRCODE = '55000';
  END IF;
  SELECT display_name, email INTO v_nombre, v_email FROM security.users
    WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND status = 'ACTIVE' AND NOT must_change_password FOR SHARE;
  IF NOT FOUND THEN outcome := 'FORBIDDEN'; RETURN NEXT; RETURN; END IF;

  SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x JOIN ops.automatizaciones au USING (automatizacion_id)
    WHERE x.ejecucion_id = p_ejecucion AND au.codigo = 'REMISIONES_AUDI' FOR UPDATE OF x;
  IF NOT FOUND THEN outcome := 'NOT_FOUND'; RETURN NEXT; RETURN; END IF;
  PERFORM 1 FROM operacion.reservas_folios WHERE ejecucion_id = p_ejecucion ORDER BY reserva_id FOR UPDATE;
  PERFORM 1 FROM operacion.remisiones WHERE ejecucion_id = p_ejecucion ORDER BY remision_id FOR UPDATE;
  IF NULLIF(btrim(p_request_id),'') IS NULL OR btrim(p_motivo) IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 1 AND 500 THEN
    outcome := 'INVALID_REQUEST'; RETURN NEXT; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('audi-recovery:' || p_request_id,0));
  UPDATE ops.acciones_recuperacion_ejecucion x SET estado = 'EXPIRADA',
    codigo_resultado = 'LEASE_EXPIRED', finished_at = clock_timestamp()
    WHERE x.ejecucion_id = p_ejecucion AND x.estado = 'EN_CURSO' AND x.expira_en <= clock_timestamp();
  SELECT * INTO a FROM ops.acciones_recuperacion_ejecucion x WHERE x.request_id = p_request_id;
  IF FOUND THEN
    IF a.ejecucion_id = p_ejecucion AND a.accion = p_accion AND a.actor_user_id = p_actor_user_id AND a.motivo = btrim(p_motivo) THEN
      outcome := 'AUTHORIZED'; accion_id := a.accion_id; revision := a.resultado->>'revision';
      attempt_estado := a.estado; claimed := a.worker IS NOT NULL;
    ELSE outcome := 'INVALID_REQUEST'; END IF;
    RETURN NEXT; RETURN;
  END IF;
  SELECT e.estado || ':' || COALESCE(max(x.accion_id),0) INTO revision
    FROM ops.acciones_recuperacion_ejecucion x WHERE x.ejecucion_id = p_ejecucion;
  SELECT * INTO a FROM ops.acciones_recuperacion_ejecucion x WHERE x.ejecucion_id = p_ejecucion AND x.estado = 'EN_CURSO';
  IF FOUND THEN
    outcome := 'ACTION_IN_PROGRESS'; accion_id := a.accion_id;
    attempt_estado := a.estado; claimed := a.worker IS NOT NULL;
    RETURN NEXT; RETURN;
  END IF;
  outcome := ops.fn_elegibilidad_audi_test(p_ejecucion,p_accion);
  IF outcome <> 'ELIGIBLE' THEN RETURN NEXT; RETURN; END IF;
  IF p_accion IN ('RECONCILE','CANCEL') AND p_expected_revision IS DISTINCT FROM revision THEN
    outcome := 'STALE_REVISION'; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO ops.acciones_recuperacion_ejecucion AS x
    (ejecucion_id,accion,estado,motivo,actor_user_id,actor_nombre,actor_email,request_id,expira_en,resultado)
    VALUES (p_ejecucion,p_accion,'EN_CURSO',btrim(p_motivo),p_actor_user_id,v_nombre,v_email,p_request_id,
      clock_timestamp() + c_lease,jsonb_build_object('revision',revision))
    RETURNING x.accion_id INTO accion_id;
  outcome := 'AUTHORIZED'; attempt_estado := 'EN_CURSO'; claimed := false;
  RETURN NEXT;
END;
$fn$;

CREATE FUNCTION ops.fn_reclamar_accion_audi_test(p_accion_id bigint,p_worker text)
RETURNS TABLE(outcome text,token_fencing uuid,expira_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,NULL,true);
  IF outcome = 'VALID' THEN
    UPDATE ops.acciones_recuperacion_ejecucion a
      SET worker = p_worker, token_fencing = gen_random_uuid()
      WHERE accion_id = p_accion_id AND worker IS NULL;
    IF FOUND THEN PERFORM ops.fn_renovar_intento_audi_test(p_accion_id); END IF;
    SELECT a.token_fencing,a.expira_en INTO token_fencing,expira_en
      FROM ops.acciones_recuperacion_ejecucion a WHERE a.accion_id = p_accion_id;
    outcome := 'CLAIMED';
  END IF;
  RETURN NEXT;
END;
$fn$;

CREATE FUNCTION ops.fn_latido_accion_audi_test(p_accion_id bigint,p_worker text,p_token uuid)
RETURNS TABLE(outcome text,expira_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,p_token,false);
  IF outcome = 'VALID' THEN
    outcome := 'RENEWED'; expira_en := ops.fn_renovar_intento_audi_test(p_accion_id);
  END IF;
  RETURN NEXT;
END;
$fn$;

CREATE FUNCTION ops.fn_expirar_acciones_audi_test(p_limite int DEFAULT 100)
RETURNS TABLE(accion_id bigint) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  WITH vencidas AS (
    SELECT a.accion_id FROM ops.acciones_recuperacion_ejecucion a
      JOIN ops.ejecuciones_automatizacion e USING (ejecucion_id)
      JOIN ops.automatizaciones au USING (automatizacion_id)
      WHERE au.codigo = 'REMISIONES_AUDI' AND a.estado = 'EN_CURSO' AND a.expira_en <= clock_timestamp()
      ORDER BY a.expira_en,a.accion_id LIMIT greatest(0,least(coalesce(p_limite,100),1000)) FOR UPDATE OF a SKIP LOCKED
  )
  UPDATE ops.acciones_recuperacion_ejecucion a SET estado = 'EXPIRADA', codigo_resultado = 'LEASE_EXPIRED',
    finished_at = clock_timestamp() FROM vencidas v WHERE a.accion_id = v.accion_id RETURNING a.accion_id
$fn$;

CREATE FUNCTION ops.fn_fallar_despacho_accion_audi_test(p_accion_id bigint,p_codigo text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_outcome text;
BEGIN
  v_outcome := ops.fn_validar_intento_audi_test(p_accion_id,NULL,NULL,true);
  IF v_outcome IN ('STALE_ATTEMPT','ATTEMPT_EXPIRED') AND NOT EXISTS (
    SELECT 1 FROM ops.acciones_recuperacion_ejecucion WHERE accion_id = p_accion_id AND estado = 'EN_CURSO'
  ) THEN RETURN v_outcome; END IF;
  UPDATE ops.acciones_recuperacion_ejecucion SET estado = 'FALLIDA', codigo_resultado = p_codigo,
    finished_at = clock_timestamp() WHERE accion_id = p_accion_id AND estado = 'EN_CURSO' AND worker IS NULL;
  IF NOT FOUND THEN RETURN 'ACTION_IN_PROGRESS'; END IF;
  RETURN 'FALLIDA';
END;
$fn$;

CREATE FUNCTION ops.fn_cerrar_accion_audi_test(p_accion_id bigint,p_worker text,p_token uuid,p_codigo text,p_error text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_outcome text;
BEGIN
  v_outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,p_token,false);
  IF v_outcome <> 'VALID' THEN RETURN v_outcome; END IF;
  PERFORM ops.fn_renovar_intento_audi_test(p_accion_id);
  UPDATE ops.acciones_recuperacion_ejecucion
    SET estado = CASE WHEN accion = 'STOP' AND p_error IS NULL
      AND p_codigo IN ('STOP_REQUESTED','NOT_RUNNING','ALREADY_FINISHED') THEN 'COMPLETADA' ELSE 'FALLIDA' END,
      codigo_resultado = p_codigo, error = p_error, finished_at = clock_timestamp()
    WHERE accion_id = p_accion_id RETURNING estado INTO v_outcome;
  RETURN v_outcome;
END;
$fn$;

CREATE FUNCTION ops.fn_admitir_reservar_audi_test(
  p_documento_id bigint,p_worker text,p_cantidad integer,p_remisiones jsonb,
  p_reproceso_de_id bigint DEFAULT NULL,p_accion_id bigint DEFAULT NULL,p_token uuid DEFAULT NULL
) RETURNS TABLE(outcome text,ejecucion_id bigint,reserva_id bigint,folio_inicial bigint,folio_final bigint,cantidad integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  e ops.ejecuciones_automatizacion%ROWTYPE;
  v_attempt ops.acciones_recuperacion_ejecucion%ROWTYPE;
  r operacion.reservas_folios%ROWTYPE;
  v_automatizacion bigint;
  v_serie bigint;
  v_cliente bigint;
  v_remision bigint;
  v_folio bigint;
  v_item jsonb;
  v_constraint text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'AUDI_RECOVERY_READ_COMMITTED_REQUIRED' USING ERRCODE = '55000';
  END IF;
  IF num_nonnulls(p_reproceso_de_id,p_accion_id,p_token) NOT IN (0,3) THEN
    outcome := 'STALE_ATTEMPT'; RETURN NEXT; RETURN;
  END IF;
  IF NULLIF(btrim(p_worker),'') IS NULL OR coalesce(p_cantidad,0) < 1
    OR jsonb_typeof(p_remisiones) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_ADMISSION' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_remisiones) <> p_cantidad THEN
    RAISE EXCEPTION 'INVALID_ADMISSION_QUANTITY' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM core.documentos WHERE documento_id = p_documento_id FOR UPDATE;
  IF NOT FOUND THEN
    outcome := CASE WHEN p_reproceso_de_id IS NULL THEN 'NOT_FOUND' ELSE 'STALE_ATTEMPT' END;
    RETURN NEXT; RETURN;
  END IF;
  SELECT a.automatizacion_id,s.serie_id,rt.empresa_cliente_id
    INTO STRICT v_automatizacion,v_serie,v_cliente
    FROM ops.automatizaciones a JOIN ops.automatizacion_series_proceso rt USING (automatizacion_id)
    JOIN operacion.series_documentales s USING (serie_id)
    WHERE a.codigo = 'REMISIONES_AUDI' AND rt.estatus = 'ACTIVA'
      AND s.codigo = 'REMISION_AUDI' AND s.estatus = 'ACTIVA'
    FOR SHARE OF a,rt;
  IF p_reproceso_de_id IS NOT NULL THEN
    SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x
      WHERE x.ejecucion_id = p_reproceso_de_id AND x.documento_origen_id = p_documento_id
        AND x.automatizacion_id = v_automatizacion FOR UPDATE;
    IF NOT FOUND THEN outcome := 'STALE_ATTEMPT'; RETURN NEXT; RETURN; END IF;
    PERFORM 1 FROM operacion.reservas_folios WHERE reservas_folios.ejecucion_id = p_reproceso_de_id
      ORDER BY reservas_folios.reserva_id FOR UPDATE;
    PERFORM 1 FROM operacion.remisiones WHERE remisiones.ejecucion_id = p_reproceso_de_id
      ORDER BY remision_id FOR UPDATE;
    SELECT ar.* INTO v_attempt FROM ops.acciones_recuperacion_ejecucion ar
      WHERE ar.accion_id = p_accion_id FOR UPDATE;
    IF NOT FOUND OR v_attempt.accion <> 'REPROCESS' OR v_attempt.ejecucion_id <> p_reproceso_de_id
      OR v_attempt.worker IS DISTINCT FROM p_worker OR v_attempt.token_fencing IS DISTINCT FROM p_token THEN
      outcome := 'STALE_ATTEMPT'; RETURN NEXT; RETURN;
    END IF;

    IF v_attempt.estado = 'COMPLETADA' AND v_attempt.ejecucion_hija_id IS NOT NULL THEN
      PERFORM 1 FROM ops.ejecuciones_automatizacion x
        WHERE x.ejecucion_id = v_attempt.ejecucion_hija_id AND x.estado = 'PROCESANDO'
          AND x.n8n_execution_id = p_worker FOR UPDATE;
      IF FOUND THEN
        SELECT rf.* INTO r FROM operacion.reservas_admitidas_audi_test m
          JOIN operacion.reservas_folios rf USING (reserva_id)
          WHERE m.ejecucion_id = v_attempt.ejecucion_hija_id AND rf.estatus = 'RESERVADA'
            AND rf.cantidad = p_cantidad FOR UPDATE OF rf;
        IF FOUND THEN
          outcome := 'OWNED_RETRY'; ejecucion_id := v_attempt.ejecucion_hija_id;
          reserva_id := r.reserva_id; folio_inicial := r.folio_inicial;
          folio_final := r.folio_final; cantidad := r.cantidad;
          RETURN NEXT; RETURN;
        END IF;
      END IF;
    END IF;

    -- Admission refusals leave the lease unchanged, including expiry on contact.
    BEGIN
      outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,p_token,false);
      IF outcome = 'ATTEMPT_EXPIRED' THEN RAISE SQLSTATE 'A0271'; END IF;
    EXCEPTION WHEN SQLSTATE 'A0271' THEN
      outcome := 'ATTEMPT_EXPIRED';
    END;
    IF outcome <> 'VALID' THEN RETURN NEXT; RETURN; END IF;

    outcome := ops.fn_elegibilidad_audi_test(p_reproceso_de_id,'REPROCESS');
    IF outcome <> 'ELIGIBLE' THEN
      UPDATE ops.acciones_recuperacion_ejecucion SET estado = 'FALLIDA',
        codigo_resultado = outcome, finished_at = clock_timestamp() WHERE accion_id = p_accion_id;
      RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM ops.ejecuciones_automatizacion x
      WHERE x.documento_origen_id = p_documento_id AND x.estado = 'PROCESANDO') THEN
      outcome := 'ALREADY_PROCESSING'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x
      WHERE x.documento_origen_id = p_documento_id AND x.automatizacion_id = v_automatizacion
      ORDER BY x.ejecucion_id DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      SELECT rf.* INTO r FROM operacion.reservas_admitidas_audi_test m
        JOIN operacion.reservas_folios rf USING (reserva_id)
        WHERE m.ejecucion_id = e.ejecucion_id FOR UPDATE OF rf;
      IF e.estado = 'PROCESANDO' AND e.n8n_execution_id = p_worker
        AND r.estatus = 'RESERVADA' AND r.cantidad = p_cantidad THEN
        outcome := 'OWNED_RETRY'; ejecucion_id := e.ejecucion_id;
      ELSIF e.estado = 'ERROR' AND r.estatus = 'RESERVADA' THEN outcome := 'REQUIRES_RECOVERY';
      ELSIF e.estado = 'PROCESANDO' THEN outcome := 'ALREADY_PROCESSING';
      ELSIF e.estado = 'COMPLETADA' THEN outcome := 'ALREADY_COMPLETED';
      ELSE outcome := 'REQUIRES_RECOVERY'; END IF;
      IF outcome = 'OWNED_RETRY' THEN
        reserva_id := r.reserva_id; folio_inicial := r.folio_inicial; folio_final := r.folio_final; cantidad := r.cantidad;
      END IF;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  BEGIN
    INSERT INTO ops.ejecuciones_automatizacion AS x
      (automatizacion_id,documento_origen_id,n8n_execution_id,reproceso_de_id)
      VALUES (v_automatizacion,p_documento_id,p_worker,p_reproceso_de_id)
      RETURNING x.ejecucion_id INTO ejecucion_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'uq_ejecuciones_automatizacion_reproceso_unico' THEN RAISE; END IF;
    outcome := 'ALREADY_REPROCESSED'; RETURN NEXT; RETURN;
  END;
  SELECT f.reserva_id,f.folio_inicial,f.folio_final,f.cantidad
    INTO STRICT reserva_id,folio_inicial,folio_final,cantidad
    FROM operacion.reservar_folios_para_ejecucion(ejecucion_id,'REMISION_AUDI',p_cantidad) f;
  INSERT INTO operacion.reservas_admitidas_audi_test VALUES (ejecucion_id,reserva_id);

  v_folio := folio_inicial;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_remisiones) LOOP
    IF jsonb_typeof(v_item->'detalle') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_ADMISSION_DETAIL' USING ERRCODE = '22023';
    END IF;
    INSERT INTO operacion.remisiones (serie_id,folio,empresa_cliente_id,ejecucion_id,fecha_documento)
      VALUES (v_serie,v_folio,v_cliente,ejecucion_id,(v_item->>'fecha_documento')::date)
      RETURNING remision_id INTO v_remision;
    INSERT INTO operacion.remision_detalle (remision_id,codigo_interno,part_number,descripcion,cantidad_texto)
      SELECT v_remision,d.codigo_interno,d.part_number,d.descripcion,d.cantidad_texto
      FROM jsonb_to_recordset(v_item->'detalle') d(codigo_interno text,part_number text,descripcion text,cantidad_texto text);
    IF v_folio < folio_final THEN v_folio := v_folio + 1; END IF;
  END LOOP;
  IF p_reproceso_de_id IS NULL THEN
    outcome := 'ADMITTED';
  ELSE
    outcome := 'REPROCESS_CREATED';
    UPDATE ops.acciones_recuperacion_ejecucion SET estado = 'COMPLETADA',
      codigo_resultado = outcome, ejecucion_hija_id = fn_admitir_reservar_audi_test.ejecucion_id,
      finished_at = clock_timestamp() WHERE accion_id = p_accion_id;
  END IF;
  RETURN NEXT;
END;
$fn$;

-- Private helper. Public callers lock the execution and validate ownership before writing.
CREATE FUNCTION operacion.fn_insertar_version_audi_test(
  p_ejecucion bigint,p_worker text,p_accion_id bigint,p_tipo text,p_remision_id bigint,
  p_ruta text,p_tamano bigint,p_sha256 text,p_estado text,p_promover boolean
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_previa operacion.artefactos_ejecucion%ROWTYPE;
  v_folio bigint;
  v_outcome text := 'NEW_VERSION';
BEGIN
  IF p_tipo = 'REMISION_PDF' THEN
    SELECT folio INTO v_folio FROM operacion.remisiones
      WHERE remision_id = p_remision_id AND ejecucion_id = p_ejecucion AND estatus <> 'CANCELADA' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_REMISSION' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_sha256 IS NOT NULL AND p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_SHA256' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_previa FROM operacion.artefactos_ejecucion WHERE ejecucion_id = p_ejecucion
    AND tipo = p_tipo AND remision_id IS NOT DISTINCT FROM p_remision_id ORDER BY version DESC LIMIT 1;
  IF FOUND AND ROW(v_previa.estado,v_previa.ruta,v_previa.tamano_bytes,v_previa.sha256::text)
      IS NOT DISTINCT FROM ROW(p_estado,p_ruta,p_tamano,p_sha256) THEN
    v_outcome := 'ALREADY_RECORDED';
  ELSE
    INSERT INTO operacion.artefactos_ejecucion
      (ejecucion_id,accion_id,tipo,remision_id,folio,ruta,tamano_bytes,sha256,estado,version,reemplaza_artefacto_id,worker)
    VALUES (p_ejecucion,p_accion_id,p_tipo,p_remision_id,v_folio,p_ruta,p_tamano,p_sha256,p_estado,
      coalesce(v_previa.version,0)+1,v_previa.artefacto_id,p_worker);
  END IF;
  IF p_promover AND p_tipo = 'REMISION_PDF' AND p_estado = 'VERIFICADO' THEN
    UPDATE operacion.remisiones SET estatus = 'GENERADA', pdf_path = p_ruta
      WHERE remision_id = p_remision_id AND estatus IN ('PENDIENTE','GENERADA')
        AND (estatus <> 'GENERADA' OR pdf_path IS DISTINCT FROM p_ruta);
  END IF;
  RETURN v_outcome;
END;
$fn$;

CREATE FUNCTION operacion.fn_registrar_artefacto_audi_test(
  p_ejecucion bigint,p_worker text,p_accion_id bigint,p_token uuid,p_tipo text,p_remision_id bigint,
  p_ruta text,p_tamano bigint,p_sha256 text,p_estado text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  e ops.ejecuciones_automatizacion%ROWTYPE;
  a ops.acciones_recuperacion_ejecucion%ROWTYPE;
  v_outcome text;
BEGIN
  SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x JOIN ops.automatizaciones au USING (automatizacion_id)
    JOIN operacion.reservas_admitidas_audi_test m USING (ejecucion_id)
    WHERE x.ejecucion_id = p_ejecucion AND au.codigo = 'REMISIONES_AUDI' FOR UPDATE OF x;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF p_accion_id IS NOT NULL THEN
    v_outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,p_token,false);
    IF v_outcome <> 'VALID' THEN RETURN v_outcome; END IF;
    SELECT * INTO a FROM ops.acciones_recuperacion_ejecucion WHERE accion_id = p_accion_id;
    IF a.ejecucion_id <> p_ejecucion OR a.accion NOT IN ('RECONCILE','CANCEL') THEN RETURN 'STALE_ATTEMPT'; END IF;
  END IF;
  IF e.estado IN ('COMPLETADA','CANCELADA') THEN RETURN 'EXECUTION_CLOSED'; END IF;
  IF p_accion_id IS NULL AND (p_token IS NOT NULL OR e.estado <> 'PROCESANDO' OR p_worker IS NULL
    OR e.n8n_execution_id IS DISTINCT FROM p_worker OR EXISTS (
      SELECT 1 FROM ops.acciones_recuperacion_ejecucion WHERE ejecucion_id = p_ejecucion
        AND accion = 'CANCEL' AND estado = 'EN_CURSO' AND expira_en > clock_timestamp()))
    THEN RETURN 'STALE_ATTEMPT'; END IF;
  IF a.accion = 'RECONCILE' AND e.estado <> 'ERROR' THEN RETURN 'NOT_ELIGIBLE_STATE'; END IF;
  v_outcome := operacion.fn_insertar_version_audi_test(p_ejecucion,p_worker,p_accion_id,p_tipo,p_remision_id,
    p_ruta,p_tamano,p_sha256,p_estado,a.accion IS DISTINCT FROM 'CANCEL');
  IF p_accion_id IS NOT NULL THEN PERFORM ops.fn_renovar_intento_audi_test(p_accion_id); END IF;
  RETURN v_outcome;
END;
$fn$;

CREATE FUNCTION ops.fn_finalizar_audi_test(
  p_ejecucion bigint,p_worker text,p_accion_id bigint DEFAULT NULL,p_token uuid DEFAULT NULL
) RETURNS TABLE(outcome text,faltantes jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  e ops.ejecuciones_automatizacion%ROWTYPE;
  r operacion.reservas_folios%ROWTYPE;
BEGIN
  SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x JOIN ops.automatizaciones au USING (automatizacion_id)
    WHERE x.ejecucion_id = p_ejecucion AND au.codigo = 'REMISIONES_AUDI' FOR UPDATE OF x;
  IF NOT FOUND THEN outcome := 'NOT_FOUND'; RETURN NEXT; RETURN; END IF;
  SELECT rf.* INTO r FROM operacion.reservas_admitidas_audi_test m JOIN operacion.reservas_folios rf USING (reserva_id)
    WHERE m.ejecucion_id = p_ejecucion FOR UPDATE OF rf;
  PERFORM 1 FROM operacion.remisiones WHERE ejecucion_id = p_ejecucion ORDER BY remision_id FOR UPDATE;
  IF p_accion_id IS NOT NULL THEN
    outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,p_token,false);
    IF outcome <> 'VALID' THEN RETURN NEXT; RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.acciones_recuperacion_ejecucion
      WHERE accion_id = p_accion_id AND ejecucion_id = p_ejecucion AND accion = 'RECONCILE')
      THEN outcome := 'STALE_ATTEMPT'; RETURN NEXT; RETURN; END IF;
  END IF;
  IF r.estatus IS DISTINCT FROM 'RESERVADA' OR
    (p_accion_id IS NOT NULL AND e.estado <> 'ERROR') OR
    (p_accion_id IS NULL AND (p_token IS NOT NULL OR e.estado <> 'PROCESANDO' OR p_worker IS NULL
      OR e.n8n_execution_id IS DISTINCT FROM p_worker OR EXISTS (
        SELECT 1 FROM ops.acciones_recuperacion_ejecucion WHERE ejecucion_id = p_ejecucion
        AND accion = 'CANCEL' AND estado = 'EN_CURSO' AND expira_en > clock_timestamp())))
    THEN outcome := 'NOT_ELIGIBLE_STATE'; RETURN NEXT; RETURN; END IF;
  faltantes := '[]'::jsonb;
  IF (SELECT count(*) FROM operacion.remisiones WHERE ejecucion_id = p_ejecucion
      AND estatus <> 'CANCELADA') <> r.cantidad OR EXISTS (
    SELECT 1 FROM operacion.remisiones WHERE ejecucion_id = p_ejecucion AND estatus <> 'CANCELADA'
      AND (estatus <> 'GENERADA' OR serie_id <> r.serie_id OR folio NOT BETWEEN r.folio_inicial AND r.folio_final)
  ) THEN faltantes := faltantes || jsonb_build_array('RESERVED_RANGE'); END IF;
  SELECT faltantes || coalesce(jsonb_agg(jsonb_build_object('type','REMISION_PDF','remissionId',m.remision_id::text)), '[]')
    INTO faltantes FROM operacion.remisiones m LEFT JOIN LATERAL (
      SELECT estado,ruta FROM operacion.artefactos_ejecucion a
      WHERE a.ejecucion_id = p_ejecucion AND a.tipo = 'REMISION_PDF' AND a.remision_id = m.remision_id
      ORDER BY version DESC LIMIT 1
    ) v ON true WHERE m.ejecucion_id = p_ejecucion AND m.estatus <> 'CANCELADA'
      AND (v.estado IS DISTINCT FROM 'VERIFICADO' OR v.ruta IS DISTINCT FROM m.pdf_path);
  IF (SELECT estado FROM operacion.artefactos_ejecucion WHERE ejecucion_id = p_ejecucion
      AND tipo = 'HOJAS_IDENTIFICACION_PDF' ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'VERIFICADO'
    THEN faltantes := faltantes || jsonb_build_array('HOJAS_IDENTIFICACION_PDF'); END IF;
  IF EXISTS (SELECT 1 FROM operacion.artefactos_ejecucion a JOIN operacion.remisiones m USING (remision_id)
    WHERE a.ejecucion_id = p_ejecucion AND m.ejecucion_id <> p_ejecucion)
    THEN faltantes := faltantes || jsonb_build_array('FOREIGN_REMISSION'); END IF;
  IF faltantes <> '[]'::jsonb THEN outcome := 'INCOMPLETE'; RETURN NEXT; RETURN; END IF;
  UPDATE ops.ejecuciones_automatizacion SET estado = 'COMPLETADA', finalizada_en = clock_timestamp(),
    error_nodo = NULL,error_mensaje = NULL WHERE ejecucion_id = p_ejecucion;
  UPDATE operacion.reservas_folios SET estatus = 'APLICADA', finalizada_en = clock_timestamp() WHERE reserva_id = r.reserva_id;
  IF p_accion_id IS NOT NULL THEN
    PERFORM ops.fn_renovar_intento_audi_test(p_accion_id);
    UPDATE ops.acciones_recuperacion_ejecucion SET estado = 'COMPLETADA', codigo_resultado = 'COMPLETADA',
      finished_at = clock_timestamp() WHERE accion_id = p_accion_id;
  END IF;
  outcome := 'COMPLETADA'; RETURN NEXT;
END;
$fn$;

CREATE FUNCTION ops.fn_completar_cancelacion_audi_test(
  p_accion_id bigint,p_worker text,p_token uuid,p_n8n_detenida boolean,p_inventario jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  e ops.ejecuciones_automatizacion%ROWTYPE;
  a ops.acciones_recuperacion_ejecucion%ROWTYPE;
  r operacion.reservas_folios%ROWTYPE;
  v_outcome text;
  v_item record;
BEGIN
  SELECT x.* INTO e FROM ops.ejecuciones_automatizacion x
    JOIN ops.acciones_recuperacion_ejecucion ar USING (ejecucion_id)
    JOIN ops.automatizaciones au USING (automatizacion_id)
    WHERE ar.accion_id = p_accion_id AND au.codigo = 'REMISIONES_AUDI' FOR UPDATE OF x;
  IF NOT FOUND THEN RETURN 'STALE_ATTEMPT'; END IF;
  SELECT rf.* INTO r FROM operacion.reservas_admitidas_audi_test m JOIN operacion.reservas_folios rf USING (reserva_id)
    WHERE m.ejecucion_id = e.ejecucion_id FOR UPDATE OF rf;
  PERFORM 1 FROM operacion.remisiones WHERE ejecucion_id = e.ejecucion_id ORDER BY remision_id FOR UPDATE;
  v_outcome := ops.fn_validar_intento_audi_test(p_accion_id,p_worker,p_token,false);
  IF v_outcome <> 'VALID' THEN RETURN v_outcome; END IF;
  SELECT * INTO a FROM ops.acciones_recuperacion_ejecucion WHERE accion_id = p_accion_id;
  IF a.accion <> 'CANCEL' THEN RETURN 'STALE_ATTEMPT'; END IF;
  IF e.estado = 'PROCESANDO' AND p_n8n_detenida IS DISTINCT FROM true THEN
    v_outcome := 'N8N_RUNNING';
  ELSIF e.estado NOT IN ('PROCESANDO','ERROR') OR r.estatus IS DISTINCT FROM 'RESERVADA' THEN
    v_outcome := 'NOT_ELIGIBLE_STATE';
  ELSE
    IF jsonb_typeof(p_inventario) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_INVENTORY' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_inventario)
      i(tipo text,remision_id bigint,ruta text,tamano_bytes bigint,sha256 text,estado text) LOOP
      PERFORM operacion.fn_insertar_version_audi_test(e.ejecucion_id,p_worker,p_accion_id,v_item.tipo,
        v_item.remision_id,v_item.ruta,v_item.tamano_bytes,v_item.sha256,v_item.estado,false);
    END LOOP;
    IF EXISTS (SELECT 1 FROM operacion.remisiones WHERE ejecucion_id = e.ejecucion_id AND estatus = 'GENERADA') THEN
      v_outcome := 'REMISSIONS_ISSUED';
    ELSIF EXISTS (SELECT 1 FROM operacion.artefactos_ejecucion WHERE ejecucion_id = e.ejecucion_id AND estado = 'VERIFICADO') THEN
      v_outcome := 'PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION';
    ELSE
      UPDATE ops.ejecuciones_automatizacion SET estado = 'CANCELADA',finalizada_en = clock_timestamp()
        WHERE ejecucion_id = e.ejecucion_id;
      UPDATE operacion.reservas_folios SET estatus = 'ABANDONADA',finalizada_en = clock_timestamp()
        WHERE reserva_id = r.reserva_id;
      UPDATE operacion.remisiones SET estatus = 'CANCELADA',motivo_cancelacion = a.motivo
        WHERE ejecucion_id = e.ejecucion_id AND estatus = 'PENDIENTE';
      v_outcome := 'COMPLETADA';
    END IF;
  END IF;
  PERFORM ops.fn_renovar_intento_audi_test(p_accion_id);
  UPDATE ops.acciones_recuperacion_ejecucion SET
    estado = CASE WHEN v_outcome = 'COMPLETADA' THEN 'COMPLETADA' ELSE 'FALLIDA' END,
    codigo_resultado = v_outcome,finished_at = clock_timestamp() WHERE accion_id = p_accion_id;
  RETURN v_outcome;
END;
$fn$;

CREATE FUNCTION ops.fn_detalle_recuperacion_audi_test(p_ejecucion bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT jsonb_build_object(
    'model',CASE WHEN r.reserva_id IS NULL THEN 'LEGACY' ELSE 'ATOMIC' END,
    'reservation',CASE WHEN r.reserva_id IS NOT NULL THEN jsonb_build_object(
      'firstFolio',r.folio_inicial::text,'lastFolio',r.folio_final::text,'quantity',r.cantidad,'status',r.estatus) END,
    'revision',e.estado || ':' || coalesce((SELECT max(accion_id) FROM ops.acciones_recuperacion_ejecucion
      WHERE ejecucion_id = p_ejecucion),0),
    'attempts',coalesce((SELECT jsonb_agg((to_jsonb(ar)-'token_fencing'-'actor_email'-'worker'-'request_id')
      || jsonb_build_object('accion_id',ar.accion_id::text,'ejecucion_id',ar.ejecucion_id::text,
        'actor_user_id',ar.actor_user_id::text,'ejecucion_hija_id',ar.ejecucion_hija_id::text,
        'claimed',ar.worker IS NOT NULL) ORDER BY ar.accion_id)
      FROM ops.acciones_recuperacion_ejecucion ar WHERE ar.ejecucion_id = p_ejecucion),'[]'),
    'artifacts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'type',v.tipo,'folio',v.folio::text,'version',v.version,'current',v.version = v.ultima,
      'fileName',regexp_replace(v.ruta,'^.*[/\\]',''),'sizeBytes',v.tamano_bytes,'sha256',v.sha256,
      'status',v.estado,'verifiedAt',v.verificado_en,'actionId',v.accion_id::text) ORDER BY v.artefacto_id)
      FROM (SELECT af.*,max(version) OVER (PARTITION BY tipo,remision_id) ultima
        FROM operacion.artefactos_ejecucion af WHERE af.ejecucion_id = p_ejecucion) v),'[]'),
    'availableActions',(SELECT jsonb_agg(jsonb_build_object(
      'action',ac,'enabled',reason = 'ELIGIBLE','disabledReason',nullif(reason,'ELIGIBLE')))
      FROM (SELECT ac, CASE WHEN EXISTS (SELECT 1 FROM ops.acciones_recuperacion_ejecucion
        WHERE ejecucion_id = p_ejecucion AND estado = 'EN_CURSO' AND expira_en > statement_timestamp())
        THEN 'ACTION_IN_PROGRESS' ELSE ops.fn_elegibilidad_audi_test(p_ejecucion,ac) END reason
        FROM unnest(ARRAY['REPROCESS','RECONCILE','STOP','CANCEL']) ac) eligibility))
  FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones au USING (automatizacion_id)
  LEFT JOIN operacion.reservas_admitidas_audi_test m USING (ejecucion_id)
  LEFT JOIN operacion.reservas_folios r USING (reserva_id)
  WHERE e.ejecucion_id = p_ejecucion AND au.codigo = 'REMISIONES_AUDI'
$fn$;

-- Remove ACL entries inherited from default privileges on new objects only.
DO $acl$
DECLARE entry record;
BEGIN
  FOR entry IN
    SELECT p.oid::regprocedure::text AS ident, x.grantee
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE n.nspname IN ('ops','operacion') AND p.proname IN (
      'fn_proteger_historial_audi_test','fn_elegibilidad_audi_test','fn_validar_intento_audi_test',
      'fn_renovar_intento_audi_test','fn_autorizar_accion_audi_test','fn_reclamar_accion_audi_test',
      'fn_latido_accion_audi_test','fn_expirar_acciones_audi_test','fn_fallar_despacho_accion_audi_test',
      'fn_cerrar_accion_audi_test','fn_admitir_reservar_audi_test','fn_insertar_version_audi_test',
      'fn_registrar_artefacto_audi_test','fn_finalizar_audi_test','fn_completar_cancelacion_audi_test',
      'fn_detalle_recuperacion_audi_test') AND x.grantee <> p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s CASCADE',entry.ident,
      CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END);
  END LOOP;
  FOR entry IN
    SELECT c.oid::regclass::text AS ident,c.relkind,x.grantee
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,
      acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char",c.relowner))) x
    WHERE c.oid IN ('ops.acciones_recuperacion_ejecucion'::regclass,
      'operacion.artefactos_ejecucion'::regclass,'operacion.reservas_admitidas_audi_test'::regclass,
      pg_get_serial_sequence('ops.acciones_recuperacion_ejecucion','accion_id')::regclass,
      pg_get_serial_sequence('operacion.artefactos_ejecucion','artefacto_id')::regclass)
      AND x.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM %s CASCADE',
      CASE WHEN entry.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,entry.ident,
      CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END);
  END LOOP;
END;
$acl$;

GRANT EXECUTE ON FUNCTION ops.fn_detalle_recuperacion_audi_test(bigint),
  ops.fn_autorizar_accion_audi_test(bigint,text,text,text,bigint,text),
  ops.fn_expirar_acciones_audi_test(integer),
  ops.fn_fallar_despacho_accion_audi_test(bigint,text) TO daubert_hub_test_user;

SELECT current_database() AS verified_database,
  to_regclass('ops.acciones_recuperacion_ejecucion') AS attempts,
  to_regclass('operacion.artefactos_ejecucion') AS evidence,
  to_regprocedure('ops.fn_finalizar_audi_test(bigint,text,bigint,uuid)') AS finalize;
COMMIT;
