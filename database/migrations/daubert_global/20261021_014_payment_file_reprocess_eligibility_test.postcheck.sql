-- 014 (TEST ONLY): postcheck. No modifica datos.
\set ON_ERROR_STOP on
SELECT current_database();
DO $chk$
DECLARE
  v_eval oid := to_regprocedure('core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean)');
  v_disp oid := to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)');
  v_013 oid := to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)');
  v_row record;
  v_rol text;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'solo daubert_hub_test'; END IF;
  IF v_eval IS NULL OR v_disp IS NULL OR v_013 IS NULL THEN RAISE EXCEPTION 'Faltan funciones (evaluador, despacho o 013)'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_eval) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_disp) THEN RAISE EXCEPTION 'Deben ser SECURITY DEFINER'; END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_eval) <> 's' OR (SELECT provolatile FROM pg_proc WHERE oid = v_disp) <> 's' THEN RAISE EXCEPTION 'Deben ser STABLE (solo lectura)'; END IF;
  IF (SELECT proconfig::text FROM pg_proc WHERE oid = v_eval) NOT LIKE '%search_path=pg_catalog, core%'
     OR (SELECT proconfig::text FROM pg_proc WHERE oid = v_disp) NOT LIKE '%search_path=pg_catalog, core%' THEN RAISE EXCEPTION 'search_path no fijado'; END IF;
  -- Despacho: solo el Hub de TEST
  IF has_function_privilege('daubert_hub_test_user', v_disp, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION 'El Hub debe poder ejecutar la elegibilidad'; END IF;
  FOREACH v_rol IN ARRAY ARRAY['n8n_app_test', 'n8n_app', 'daubert_hub_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) AND has_function_privilege(v_rol, v_disp, 'EXECUTE') THEN
      RAISE EXCEPTION '% no debe ejecutar la elegibilidad', v_rol;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_disp), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = v_disp)))) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC no debe tener EXECUTE en la elegibilidad';
  END IF;
  -- Evaluador: interno
  FOREACH v_rol IN ARRAY ARRAY['n8n_app_test', 'n8n_app', 'daubert_hub_app', 'daubert_hub_test_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) AND has_function_privilege(v_rol, v_eval, 'EXECUTE') THEN
      RAISE EXCEPTION '% no debe ejecutar el evaluador interno', v_rol;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_eval), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = v_eval)))) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC no debe tener EXECUTE en el evaluador';
  END IF;
  -- 013 conserva permisos: n8n_app_test si; el Hub NO (sin toma ni registro)
  IF has_function_privilege('n8n_app_test', v_013, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION 'n8n_app_test perdio EXECUTE sobre la 013'; END IF;
  IF has_function_privilege('daubert_hub_test_user', v_013, 'EXECUTE') THEN RAISE EXCEPTION 'El Hub no debe ejecutar la 013'; END IF;
  IF has_function_privilege('daubert_hub_test_user', 'core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean)', 'EXECUTE')
     OR has_function_privilege('daubert_hub_test_user', 'core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El Hub no debe poder registrar ni tomar archivos';
  END IF;
  -- Humo (sin escritura): correo inexistente y argumentos nulos devuelven estado estructurado
  SELECT * INTO v_row FROM core.fn_reproceso_asignaciones_puntuales(-1);
  IF v_row.elegible IS NOT FALSE OR v_row.bloqueos->0->>'resultado' <> 'CORREO_NO_ENCONTRADO' THEN RAISE EXCEPTION 'correo inexistente: %', v_row; END IF;
  SELECT * INTO v_row FROM core.fn_reproceso_asignaciones_puntuales(NULL);
  IF v_row.elegible IS NOT FALSE THEN RAISE EXCEPTION 'argumento nulo debe bloquear'; END IF;
  SELECT * INTO v_row FROM core.fn_consultar_archivo_notificacion_pago(-1, 1, 'x', repeat('0', 64), 0, repeat('0', 64));
  IF v_row.resultado <> 'CONFLICTO_IDENTIDAD' OR v_row.detalle <> 'ARCHIVO_NO_REGISTRADO' THEN RAISE EXCEPTION '013 alterada: % %', v_row.resultado, v_row.detalle; END IF;
  SELECT * INTO v_row FROM core.fn_evaluar_archivo_notificacion_pago(-1);
  IF v_row.resultado <> 'CONFLICTO_IDENTIDAD' THEN RAISE EXCEPTION 'evaluador: %', v_row.resultado; END IF;
  RAISE NOTICE '014 postcheck OK';
END $chk$;
-- Elegibilidad real de los correos con asignacion puntual activa (solo lectura; informativo)
SELECT f.correo_id, e.elegible, e.asignaciones_activas, e.bloqueos
FROM (SELECT DISTINCT f.correo_id FROM core.archivos_notificacion_pago f JOIN core.asignaciones_archivo_notificacion_pago a USING (archivo_id) WHERE a.estatus = 'ACTIVA') f
CROSS JOIN LATERAL core.fn_reproceso_asignaciones_puntuales(f.correo_id) e
ORDER BY f.correo_id DESC LIMIT 15;
