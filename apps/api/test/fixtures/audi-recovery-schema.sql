CREATE SCHEMA core;
CREATE SCHEMA ops;
CREATE SCHEMA operacion;
CREATE SCHEMA security;
CREATE ROLE daubert_hub_test_user;
GRANT USAGE ON SCHEMA ops TO daubert_hub_test_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT EXECUTE ON FUNCTIONS TO daubert_hub_test_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA operacion GRANT INSERT ON TABLES TO daubert_hub_test_user;

CREATE TABLE security.users (
  user_id bigint PRIMARY KEY,display_name text NOT NULL,email text NOT NULL,
  role text NOT NULL,status text NOT NULL,must_change_password boolean NOT NULL
);
INSERT INTO security.users VALUES
  (1,'Admin','admin@example.invalid','ADMIN','ACTIVE',false),
  (2,'General','general@example.invalid','GENERAL','ACTIVE',false),
  (3,'Inactive','inactive@example.invalid','ADMIN','INACTIVE',false),
  (4,'Pending','pending@example.invalid','ADMIN','ACTIVE',true);

CREATE TABLE core.documentos (documento_id bigint PRIMARY KEY);
INSERT INTO core.documentos SELECT generate_series(1,10);
CREATE TABLE ops.automatizaciones (automatizacion_id bigint PRIMARY KEY,codigo text NOT NULL UNIQUE);
INSERT INTO ops.automatizaciones VALUES (1,'REMISIONES_AUDI'),(2,'REMISIONES_CATERPILLAR');
CREATE TABLE ops.ejecuciones_automatizacion (
  ejecucion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  automatizacion_id bigint NOT NULL REFERENCES ops.automatizaciones,
  documento_origen_id bigint NOT NULL REFERENCES core.documentos,
  n8n_execution_id text,estado text NOT NULL DEFAULT 'PROCESANDO',
  finalizada_en timestamptz,error_nodo text,error_mensaje text,
  reproceso_de_id bigint REFERENCES ops.ejecuciones_automatizacion
);
CREATE UNIQUE INDEX uq_ejecuciones_automatizacion_reproceso_unico
  ON ops.ejecuciones_automatizacion(reproceso_de_id) WHERE reproceso_de_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ejecuciones_automatizacion_procesando
  ON ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id) WHERE estado = 'PROCESANDO';
CREATE UNIQUE INDEX uq_ejecuciones_automatizacion_completada_original
  ON ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id)
  WHERE estado = 'COMPLETADA' AND reproceso_de_id IS NULL;

CREATE TABLE operacion.series_documentales (
  serie_id bigint PRIMARY KEY,codigo text NOT NULL UNIQUE,estatus text NOT NULL,siguiente_folio bigint NOT NULL
);
INSERT INTO operacion.series_documentales VALUES (1,'REMISION_AUDI','ACTIVA',988);
CREATE TABLE ops.automatizacion_series_proceso (
  automatizacion_id bigint REFERENCES ops.automatizaciones,serie_id bigint REFERENCES operacion.series_documentales,
  empresa_cliente_id bigint NOT NULL,estatus text NOT NULL
);
INSERT INTO ops.automatizacion_series_proceso VALUES (1,1,10,'ACTIVA');
CREATE TABLE operacion.reservas_folios (
  reserva_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejecucion_id bigint REFERENCES ops.ejecuciones_automatizacion,serie_id bigint REFERENCES operacion.series_documentales,
  folio_inicial bigint NOT NULL,folio_final bigint NOT NULL,cantidad int NOT NULL,estatus text NOT NULL,
  finalizada_en timestamptz,UNIQUE (ejecucion_id,serie_id),
  CHECK (cantidad > 0 AND folio_final = folio_inicial + cantidad - 1),
  CHECK ((estatus = 'RESERVADA') = (finalizada_en IS NULL))
);
CREATE TABLE operacion.remisiones (
  remision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejecucion_id bigint NOT NULL REFERENCES ops.ejecuciones_automatizacion,
  serie_id bigint NOT NULL REFERENCES operacion.series_documentales,
  folio bigint NOT NULL,empresa_cliente_id bigint NOT NULL,fecha_documento date NOT NULL,
  estatus text NOT NULL DEFAULT 'PENDIENTE',pdf_path text,motivo_cancelacion text
);
CREATE UNIQUE INDEX uq_remisiones_serie_folio_no_cancelada ON operacion.remisiones(serie_id,folio)
  WHERE estatus <> 'CANCELADA';
CREATE TABLE operacion.remision_detalle (
  detalle_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  remision_id bigint NOT NULL REFERENCES operacion.remisiones,codigo_interno text,part_number text,
  descripcion text,cantidad_texto text NOT NULL CHECK (btrim(cantidad_texto) <> '')
);

-- Adapted from the 015 fixture, retaining the shared allocator signature and transactional behavior.
CREATE FUNCTION operacion.reservar_folios_para_ejecucion(p_exec bigint,p_series text,p_quantity integer)
RETURNS TABLE(reserva_id bigint,folio_inicial bigint,folio_final bigint,cantidad integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE s operacion.series_documentales%ROWTYPE; r operacion.reservas_folios%ROWTYPE;
BEGIN
  IF p_quantity < 1 OR NOT EXISTS (
    SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id = p_exec AND e.estado = 'PROCESANDO'
  ) THEN RAISE EXCEPTION 'invalid reservation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_exec || ':' || p_series,0));
  SELECT * INTO STRICT s FROM operacion.series_documentales WHERE codigo = p_series AND estatus = 'ACTIVA' FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM ops.automatizacion_series_proceso rt
    JOIN ops.ejecuciones_automatizacion e USING (automatizacion_id)
    WHERE e.ejecucion_id = p_exec AND rt.serie_id = s.serie_id AND rt.estatus = 'ACTIVA')
    THEN RAISE EXCEPTION 'inactive route'; END IF;
  SELECT * INTO r FROM operacion.reservas_folios x WHERE x.ejecucion_id = p_exec AND x.serie_id = s.serie_id;
  IF FOUND THEN
    IF r.cantidad <> p_quantity THEN RAISE EXCEPTION 'quantity changed' USING ERRCODE = '23505'; END IF;
    RETURN QUERY SELECT r.reserva_id,r.folio_inicial,r.folio_final,r.cantidad;
    RETURN;
  END IF;
  INSERT INTO operacion.reservas_folios(ejecucion_id,serie_id,folio_inicial,folio_final,cantidad,estatus)
    VALUES(p_exec,s.serie_id,s.siguiente_folio,s.siguiente_folio+p_quantity-1,p_quantity,'RESERVADA') RETURNING * INTO r;
  UPDATE operacion.series_documentales SET siguiente_folio = r.folio_final+1 WHERE serie_id = s.serie_id;
  RETURN QUERY SELECT r.reserva_id,r.folio_inicial,r.folio_final,r.cantidad;
END;
$fn$;

CREATE FUNCTION operacion.reservar_folios(p_serie text,p_cantidad int) RETURNS bigint
LANGUAGE sql AS $fn$
  SELECT siguiente_folio FROM operacion.series_documentales WHERE codigo = p_serie FOR UPDATE
$fn$;
CREATE FUNCTION ops.fn_cat_fixture() RETURNS boolean LANGUAGE sql AS $fn$ SELECT true $fn$;
