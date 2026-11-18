-- ISOLATED PROTOTYPE, NOT A MIGRATION. No application/worker grants or live integration.
DO $$ BEGIN
  IF current_database() IN ('daubert_global', 'daubert_hub_test')
     OR current_setting('cat_recovery.sandbox', true) IS DISTINCT FROM 'isolated' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ISOLATED_SANDBOX_REQUIRED';
  END IF;
END $$;

CREATE SCHEMA cat_recovery_prototype;
REVOKE ALL ON SCHEMA cat_recovery_prototype FROM PUBLIC;

-- A future filesystem coordinator must produce these records; a browser checkbox is NOT evidence.
-- The runner supplies synthetic attestations, not proof about any real filesystem or delivery.
CREATE TABLE cat_recovery_prototype.evidence (
  evidence_id uuid PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES operacion.reservas_folios(reserva_id),
  inventory_sha256 text NOT NULL CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
  delivery_state text NOT NULL CHECK (delivery_state IN ('UNDELIVERED', 'DELIVERED', 'UNKNOWN')),
  output_clear boolean NOT NULL,
  quarantine_verified boolean NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE cat_recovery_prototype.recoveries (
  request_id uuid PRIMARY KEY,
  original_reservation_id bigint NOT NULL UNIQUE REFERENCES operacion.reservas_folios(reserva_id),
  new_reservation_id bigint NOT NULL UNIQUE REFERENCES operacion.reservas_folios(reserva_id),
  child_execution_id bigint NOT NULL UNIQUE REFERENCES ops.ejecuciones_automatizacion(ejecucion_id),
  evidence_id uuid NOT NULL UNIQUE REFERENCES cat_recovery_prototype.evidence(evidence_id),
  admin_id bigint NOT NULL REFERENCES security.users(user_id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  next_folio_before bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION cat_recovery_prototype.recover(
  p_parent bigint, p_child bigint, p_evidence uuid, p_request uuid,
  p_admin bigint, p_reason text, p_confirmed boolean
) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  parent ops.ejecuciones_automatizacion%ROWTYPE;
  child ops.ejecuciones_automatizacion%ROWTYPE;
  source operacion.reservas_folios%ROWTYPE;
  series operacion.series_documentales%ROWTYPE;
  proof cat_recovery_prototype.evidence%ROWTYPE;
  previous cat_recovery_prototype.recoveries%ROWTYPE;
  new_id bigint;
BEGIN
  IF current_database() IN ('daubert_global', 'daubert_hub_test')
     OR current_setting('cat_recovery.sandbox', true) IS DISTINCT FROM 'isolated' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ISOLATED_SANDBOX_REQUIRED';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_READ_COMMITTED_REQUIRED';
  END IF;
  IF p_confirmed IS DISTINCT FROM true OR p_request IS NULL OR p_evidence IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'CAT_RECOVERY_EXPLICIT_CONFIRMATION_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM security.users u WHERE u.user_id=p_admin
    AND u.role='ADMIN' AND u.status='ACTIVE' AND NOT u.must_change_password) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;

  -- Serializes competing recovery requests for one parent before an audit row exists.
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_RECOVERY:' || p_parent::text, 0));
  SELECT * INTO parent FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_parent FOR UPDATE;
  IF NOT FOUND OR parent.estado <> 'ERROR' OR NOT EXISTS (
    SELECT 1 FROM ops.automatizaciones a WHERE a.automatizacion_id=parent.automatizacion_id
      AND a.codigo='REMISIONES_CATERPILLAR' AND a.estatus='ACTIVA'
  ) THEN RAISE EXCEPTION 'CAT_RECOVERY_PARENT_NOT_FAILED_CATERPILLAR'; END IF;

  SELECT * INTO previous FROM cat_recovery_prototype.recoveries r WHERE r.request_id=p_request;
  IF FOUND THEN
    IF previous.child_execution_id IS DISTINCT FROM p_child OR previous.evidence_id IS DISTINCT FROM p_evidence
      OR previous.admin_id IS DISTINCT FROM p_admin OR previous.reason IS DISTINCT FROM btrim(p_reason)
      OR NOT EXISTS (SELECT 1 FROM operacion.reservas_folios r
        WHERE r.reserva_id=previous.original_reservation_id AND r.ejecucion_id=p_parent) THEN
      RAISE EXCEPTION 'CAT_RECOVERY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN previous.new_reservation_id;
  END IF;

  IF (SELECT count(*) FROM operacion.reservas_folios r WHERE r.ejecucion_id=p_parent) <> 1 THEN
    RAISE EXCEPTION 'CAT_RECOVERY_SINGLE_RESERVATION_REQUIRED';
  END IF;
  SELECT * INTO STRICT source FROM operacion.reservas_folios r WHERE r.ejecucion_id=p_parent FOR UPDATE;
  IF source.estatus <> 'ABANDONADA' THEN RAISE EXCEPTION 'CAT_RECOVERY_RESERVATION_NOT_ABANDONED'; END IF;
  IF EXISTS (SELECT 1 FROM cat_recovery_prototype.recoveries r WHERE r.original_reservation_id=source.reserva_id) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ALREADY_RECOVERED';
  END IF;

  -- Same row lock used by BOTH real reservation functions; never UPDATE siguiente_folio.
  SELECT * INTO STRICT series FROM operacion.series_documentales s WHERE s.serie_id=source.serie_id FOR UPDATE;
  IF series.estatus <> 'ACTIVA' OR series.siguiente_folio <> source.folio_final + 1 THEN
    RAISE EXCEPTION 'CAT_RECOVERY_NOT_LAST_RANGE';
  END IF;
  IF EXISTS (SELECT 1 FROM operacion.reservas_folios r WHERE r.serie_id=source.serie_id
    AND (r.reserva_id > source.reserva_id OR r.folio_final > source.folio_final)) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_LATER_RESERVATION';
  END IF;
  IF EXISTS (SELECT 1 FROM operacion.reservas_folios r WHERE r.serie_id=source.serie_id
    AND r.reserva_id<>source.reserva_id AND r.estatus<>'ABANDONADA'
    AND r.folio_inicial<=source.folio_final AND r.folio_final>=source.folio_inicial) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_OVERLAPPING_RESERVATION';
  END IF;
  IF EXISTS (SELECT 1 FROM operacion.remisiones r WHERE r.ejecucion_id=p_parent
    OR (r.serie_id=source.serie_id AND r.folio BETWEEN source.folio_inicial AND source.folio_final)) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_REMISSION_EXISTS'; -- Includes CANCELADA: history is evidence of emission.
  END IF;

  SELECT * INTO child FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_child FOR UPDATE;
  IF NOT FOUND OR child.estado<>'PROCESANDO' OR child.reproceso_de_id IS DISTINCT FROM p_parent
    OR child.automatizacion_id<>parent.automatizacion_id OR child.documento_origen_id<>parent.documento_origen_id THEN
    RAISE EXCEPTION 'CAT_RECOVERY_CHILD_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ops.automatizacion_series_proceso r WHERE r.automatizacion_id=parent.automatizacion_id
    AND r.serie_id=source.serie_id AND r.estatus='ACTIVA') THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ROUTE_UNAVAILABLE';
  END IF;
  -- Conservative prototype: blocks ANY other active execution of Caterpillar, including one not yet reserved.
  IF EXISTS (SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.automatizacion_id=parent.automatizacion_id
    AND e.estado='PROCESANDO' AND e.ejecucion_id<>p_child) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_OTHER_EXECUTION_PROCESSING';
  END IF;
  IF EXISTS (SELECT 1 FROM operacion.reservas_folios r WHERE r.ejecucion_id=p_child) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_CHILD_ALREADY_RESERVED';
  END IF;

  SELECT * INTO proof FROM cat_recovery_prototype.evidence e WHERE e.evidence_id=p_evidence FOR UPDATE;
  IF NOT FOUND OR proof.reservation_id<>source.reserva_id OR proof.delivery_state<>'UNDELIVERED'
    OR NOT proof.output_clear OR NOT proof.quarantine_verified
    OR proof.verified_at < clock_timestamp() - interval '5 minutes' OR proof.verified_at > clock_timestamp() THEN
    RAISE EXCEPTION 'CAT_RECOVERY_FILES_OR_DELIVERY_UNPROVEN';
  END IF;

  INSERT INTO operacion.reservas_folios(ejecucion_id,serie_id,folio_inicial,folio_final,cantidad,estatus)
    VALUES(p_child,source.serie_id,source.folio_inicial,source.folio_final,source.cantidad,'RESERVADA')
    RETURNING reserva_id INTO new_id;
  INSERT INTO cat_recovery_prototype.recoveries(request_id,original_reservation_id,new_reservation_id,
    child_execution_id,evidence_id,admin_id,reason,next_folio_before)
    VALUES(p_request,source.reserva_id,new_id,p_child,p_evidence,p_admin,btrim(p_reason),series.siguiente_folio);
  RETURN new_id;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA cat_recovery_prototype FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cat_recovery_prototype FROM PUBLIC;
