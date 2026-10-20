-- 013 (TEST ONLY): postcheck. No modifica datos (la prueba con argumentos invalidos no escribe nada).
\set ON_ERROR_STOP on
SELECT current_database();
DO $chk$
DECLARE
  v_oid oid := to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)');
  v_row record;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'solo daubert_hub_test'; END IF;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'La funcion no existe'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN RAISE EXCEPTION 'Debe ser SECURITY DEFINER'; END IF;
  IF (SELECT proconfig::text FROM pg_proc WHERE oid = v_oid) NOT LIKE '%search_path=pg_catalog, core%' THEN RAISE EXCEPTION 'search_path no fijado'; END IF;
  IF has_function_privilege('n8n_app_test', v_oid, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION 'n8n_app_test debe poder ejecutarla'; END IF;
  IF has_function_privilege('daubert_hub_test_user', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'El Hub no debe poder ejecutarla'; END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = v_oid)))) a
             WHERE a.grantee = 0) THEN RAISE EXCEPTION 'PUBLIC no debe tener EXECUTE'; END IF;
  IF has_function_privilege('n8n_app', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'n8n_app no debe tener EXECUTE (concederlo es una decision aparte)'; END IF;
  -- 012 intacta
  IF to_regprocedure('core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)') IS NULL THEN RAISE EXCEPTION '012 alterada'; END IF;
  -- Humo: argumentos incompletos y archivo inexistente devuelven estado estructurado, sin excepcion
  SELECT * INTO v_row FROM core.fn_consultar_archivo_notificacion_pago(NULL, NULL, NULL, NULL, NULL, NULL);
  IF v_row.resultado <> 'CONFLICTO_IDENTIDAD' THEN RAISE EXCEPTION 'argumentos nulos: %', v_row.resultado; END IF;
  SELECT * INTO v_row FROM core.fn_consultar_archivo_notificacion_pago(-1, 1, 'x', repeat('0', 64), 0, repeat('0', 64));
  IF v_row.resultado <> 'CONFLICTO_IDENTIDAD' OR v_row.detalle <> 'ARCHIVO_NO_REGISTRADO' THEN RAISE EXCEPTION 'archivo inexistente: % %', v_row.resultado, v_row.detalle; END IF;
  RAISE NOTICE '013 postcheck OK';
END $chk$;
-- Permisos efectivos de n8n_app_test sobre las funciones de archivos (esperado: registrar, resolver y consultar)
SELECT p.oid::regprocedure AS funcion FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core' AND p.prokind = 'f' AND has_function_privilege('n8n_app_test', p.oid, 'EXECUTE') ORDER BY 1;
