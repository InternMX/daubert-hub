-- ISOLATED PGlite contract doubles ONLY. Not Daubert DDL, not copies of the real allocator.
CREATE ROLE n8n_cat_test LOGIN;
CREATE ROLE daubert_hub_test_user LOGIN;
CREATE SCHEMA core; CREATE SCHEMA ops; CREATE SCHEMA operacion;
GRANT USAGE ON SCHEMA core,ops,operacion TO n8n_cat_test,daubert_hub_test_user;
CREATE TABLE core.documentos(documento_id bigint PRIMARY KEY,empresa_id bigint,tipo_documento text NOT NULL,
  nombre_archivo text NOT NULL,hash_archivo text,caterpillar_admission jsonb);
CREATE TABLE ops.automatizaciones(automatizacion_id bigint PRIMARY KEY,codigo text,estatus text);
INSERT INTO ops.automatizaciones VALUES(1,'REMISIONES_CATERPILLAR','ACTIVA');
CREATE TABLE ops.ejecuciones_automatizacion(ejecucion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  automatizacion_id bigint,documento_origen_id bigint,estado text,n8n_execution_id text,reproceso_de_id bigint,
  intentos_fallidos integer DEFAULT 0,max_intentos integer DEFAULT 2,ultimo_fallo_n8n_execution_id text);
CREATE UNIQUE INDEX active_doc ON ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id) WHERE estado='PROCESANDO';
CREATE UNIQUE INDEX completed_original ON ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id) WHERE estado='COMPLETADA' AND reproceso_de_id IS NULL;
CREATE UNIQUE INDEX one_child ON ops.ejecuciones_automatizacion(reproceso_de_id) WHERE reproceso_de_id IS NOT NULL;
CREATE TABLE operacion.series_documentales(serie_id bigint PRIMARY KEY,codigo text,estatus text,siguiente_folio bigint);
INSERT INTO operacion.series_documentales VALUES(1,'SYN_P5','ACTIVA',1000),(2,'SYN_TOR','ACTIVA',2000);
CREATE TABLE ops.automatizacion_series_proceso(ruta_id bigint PRIMARY KEY,automatizacion_id bigint,llave_proceso text,
  serie_id bigint,estatus text,empresa_cliente_id bigint);
INSERT INTO ops.automatizacion_series_proceso VALUES(1,1,'CAT_P3_P4_P5_P6|P5|',1,'ACTIVA',77),(2,1,'CAT_TORREON|TORREON|PLANTA_2',2,'ACTIVA',77);
CREATE TABLE operacion.reservas_folios(reserva_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ejecucion_id bigint,
  serie_id bigint,folio_inicial bigint,folio_final bigint,cantidad integer,estatus text,UNIQUE(ejecucion_id,serie_id));
CREATE TABLE operacion.remisiones(remision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ejecucion_id bigint,
  serie_id bigint,folio bigint,fecha_documento date,pdf_path text,detalles jsonb,estatus text);
CREATE TABLE operacion.remision_detalle(detalle_id bigint PRIMARY KEY,remision_id bigint,cantidad_texto text);
GRANT SELECT ON ALL TABLES IN SCHEMA core,ops,operacion TO n8n_cat_test;

CREATE FUNCTION ops.fn_crear_ejecucion_automatizacion(p_auto text,p_doc bigint,p_worker text,p_run text,p_parent bigint)
RETURNS TABLE(ejecucion_id bigint,ya_existia boolean,motivo text) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE e ops.ejecuciones_automatizacion%ROWTYPE;
BEGIN
  SELECT * INTO e FROM ops.ejecuciones_automatizacion x WHERE x.documento_origen_id=p_doc ORDER BY x.ejecucion_id DESC LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT e.ejecucion_id,true,CASE e.estado WHEN 'PROCESANDO' THEN 'ALREADY_PROCESSING' WHEN 'COMPLETADA' THEN 'ALREADY_COMPLETED' WHEN 'ERROR' THEN 'ALREADY_ERROR' ELSE 'ALREADY_CANCELLED' END; RETURN; END IF;
  INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado,n8n_execution_id,reproceso_de_id)
    VALUES(1,p_doc,'PROCESANDO',p_worker,p_parent) RETURNING * INTO e;
  RETURN QUERY SELECT e.ejecucion_id,false,'CREATED'::text;
END $$;
CREATE FUNCTION operacion.reservar_folios_para_ejecucion(p_exec bigint,p_series text,p_quantity integer)
RETURNS TABLE(reserva_id bigint,folio_inicial bigint,folio_final bigint,cantidad integer) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s operacion.series_documentales%ROWTYPE; r operacion.reservas_folios%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_exec AND e.estado='PROCESANDO') THEN RAISE EXCEPTION 'execution not processing'; END IF;
  SELECT * INTO s FROM operacion.series_documentales WHERE codigo=p_series FOR UPDATE;
  SELECT * INTO r FROM operacion.reservas_folios x WHERE x.ejecucion_id=p_exec AND x.serie_id=s.serie_id;
  IF FOUND THEN IF r.cantidad<>p_quantity THEN RAISE EXCEPTION 'quantity changed'; END IF;
    RETURN QUERY SELECT r.reserva_id,r.folio_inicial,r.folio_final,r.cantidad; RETURN; END IF;
  INSERT INTO operacion.reservas_folios(ejecucion_id,serie_id,folio_inicial,folio_final,cantidad,estatus)
    VALUES(p_exec,s.serie_id,s.siguiente_folio,s.siguiente_folio+p_quantity-1,p_quantity,'RESERVADA') RETURNING * INTO r;
  UPDATE operacion.series_documentales SET siguiente_folio=r.folio_final+1 WHERE serie_id=s.serie_id;
  RETURN QUERY SELECT r.reserva_id,r.folio_inicial,r.folio_final,r.cantidad;
END $$;
CREATE FUNCTION operacion.fn_registrar_remision_generada(p_exec bigint,p_series text,p_folio bigint,p_date date,p_pdf text,p_details jsonb)
RETURNS TABLE(remision_id bigint,ya_existia boolean) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r operacion.remisiones%ROWTYPE; s bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_exec AND e.estado='PROCESANDO') THEN RAISE EXCEPTION 'execution not processing'; END IF;
  SELECT serie_id INTO s FROM operacion.series_documentales WHERE codigo=p_series;
  IF NOT EXISTS(SELECT 1 FROM operacion.reservas_folios f WHERE f.ejecucion_id=p_exec AND f.serie_id=s AND p_folio BETWEEN f.folio_inicial AND f.folio_final) THEN RAISE EXCEPTION 'outside reservation'; END IF;
  SELECT * INTO r FROM operacion.remisiones x WHERE x.serie_id=s AND x.folio=p_folio;
  IF FOUND THEN IF r.ejecucion_id<>p_exec OR r.pdf_path<>p_pdf OR r.detalles<>p_details OR r.fecha_documento<>p_date THEN RAISE EXCEPTION 'changed remission'; END IF;
    RETURN QUERY SELECT r.remision_id,true; RETURN; END IF;
  INSERT INTO operacion.remisiones(ejecucion_id,serie_id,folio,fecha_documento,pdf_path,detalles,estatus)
    VALUES(p_exec,s,p_folio,p_date,p_pdf,p_details,'GENERADA') RETURNING * INTO r;
  RETURN QUERY SELECT r.remision_id,false;
END $$;
CREATE FUNCTION ops.fn_finalizar_ejecucion_automatizacion(p_exec bigint,p_state text,p_node text,p_error text)
RETURNS TABLE(ejecucion_id bigint,ya_estaba_finalizada boolean,estado_final text,reservas_aplicadas integer,reservas_abandonadas integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE state text;
BEGIN
  SELECT estado INTO state FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=p_exec FOR UPDATE;
  IF state<>'PROCESANDO' THEN IF state<>p_state THEN RAISE EXCEPTION 'different final state'; END IF;
    RETURN QUERY SELECT p_exec,true,state,0,0; RETURN; END IF;
  IF p_state='COMPLETADA' AND EXISTS(SELECT 1 FROM operacion.reservas_folios f WHERE f.ejecucion_id=p_exec AND f.cantidad<>(SELECT count(*) FROM operacion.remisiones r WHERE r.ejecucion_id=p_exec AND r.serie_id=f.serie_id AND r.estatus='GENERADA')) THEN RAISE EXCEPTION 'incomplete remissions'; END IF;
  UPDATE ops.ejecuciones_automatizacion SET estado=p_state WHERE ops.ejecuciones_automatizacion.ejecucion_id=p_exec;
  UPDATE operacion.reservas_folios SET estatus=CASE WHEN p_state='COMPLETADA' THEN 'APLICADA' ELSE 'ABANDONADA' END WHERE operacion.reservas_folios.ejecucion_id=p_exec;
  RETURN QUERY SELECT p_exec,false,p_state,CASE WHEN p_state='COMPLETADA' THEN 1 ELSE 0 END,CASE WHEN p_state='COMPLETADA' THEN 0 ELSE 1 END;
END $$;
CREATE FUNCTION ops.fn_registrar_fallo_ejecucion(p_exec bigint,p_worker text,p_node text,p_error text)
RETURNS TABLE(ejecucion_id bigint,ya_registrado boolean,intentos_fallidos integer,max_intentos integer,error_final boolean,estado_actual text,reservas_abandonadas integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE e ops.ejecuciones_automatizacion%ROWTYPE;
BEGIN
  SELECT * INTO e FROM ops.ejecuciones_automatizacion x WHERE x.ejecucion_id=p_exec;
  IF e.ultimo_fallo_n8n_execution_id=p_worker THEN RETURN QUERY SELECT p_exec,true,e.intentos_fallidos,e.max_intentos,false,e.estado,0; RETURN; END IF;
  UPDATE ops.ejecuciones_automatizacion SET intentos_fallidos=ops.ejecuciones_automatizacion.intentos_fallidos+1,ultimo_fallo_n8n_execution_id=p_worker
    WHERE ops.ejecuciones_automatizacion.ejecucion_id=p_exec RETURNING * INTO e;
  RETURN QUERY SELECT p_exec,false,e.intentos_fallidos,e.max_intentos,false,e.estado,0;
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ops,operacion FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint),
  operacion.reservar_folios_para_ejecucion(bigint,text,integer),operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb),
  ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text),ops.fn_registrar_fallo_ejecucion(bigint,text,text,text) TO n8n_cat_test;
