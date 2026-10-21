-- 017 PRODUCCION - POSTCHECK. Parte A: SOLO LECTURA. Parte B: humo con SET LOCAL ROLE n8n_app dentro de una transaccion que se descarta.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE
  v_eva oid; v_dis oid; v_con oid; v_rol text;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '017 postcheck es solo para daubert_global'; END IF;
  v_eva := to_regprocedure('core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean)');
  v_dis := to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)');
  v_con := to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)');
  IF v_eva IS NULL OR v_dis IS NULL OR v_con IS NULL THEN RAISE EXCEPTION 'Faltan funciones de la 016/017'; END IF;
  -- El evaluador es interno: nadie lo ejecuta directamente (lo invocan las funciones SECURITY DEFINER).
  FOREACH v_rol IN ARRAY ARRAY['n8n_app', 'daubert_hub_app'] LOOP
    IF has_function_privilege(v_rol, v_eva, 'EXECUTE') THEN RAISE EXCEPTION '% no debe ejecutar el evaluador', v_rol; END IF;
  END LOOP;
  -- Elegibilidad de reproceso: solo el Hub.
  IF NOT has_function_privilege('daubert_hub_app', v_dis, 'EXECUTE') THEN RAISE EXCEPTION 'El Hub debe poder consultar la elegibilidad'; END IF;
  IF has_function_privilege('n8n_app', v_dis, 'EXECUTE') THEN RAISE EXCEPTION 'n8n_app no debe ejecutar la elegibilidad'; END IF;
  -- La 016 conserva sus permisos tras el CREATE OR REPLACE.
  IF NOT has_function_privilege('n8n_app', v_con, 'EXECUTE') OR has_function_privilege('daubert_hub_app', v_con, 'EXECUTE') THEN RAISE EXCEPTION 'La consulta (016) perdio o amplio permisos'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid IN (v_eva, v_dis, v_con) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC conserva EXECUTE';
  END IF;
END $check$;
SELECT current_database() AS verified_database, '017 postcheck (A) OK' AS result;
ROLLBACK;

-- Parte B: humo. Requiere que el administrador pueda hacer SET ROLE n8n_app. Solo toma el advisory lock de la transaccion y se descarta.
BEGIN;
SET LOCAL ROLE n8n_app;
SELECT resultado, detalle FROM core.fn_consultar_archivo_notificacion_pago(-1, -1, 'x', repeat('0', 64), 0, repeat('0', 64), false, false, NULL);
-- Esperado: CONFLICTO_IDENTIDAD | ARCHIVO_NO_REGISTRADO
ROLLBACK;
