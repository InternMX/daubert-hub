-- 016 PRODUCCION - POSTCHECK. SOLO LECTURA. Ejecutar con un administrador en daubert_global DESPUES del up de la 016.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE v_oid oid;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '016 postcheck es solo para daubert_global'; END IF;
  v_oid := to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Falta fn_consultar_archivo_notificacion_pago'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN RAISE EXCEPTION 'Debe ser SECURITY DEFINER'; END IF;
  -- Unico EXECUTE adicional del rol compartido n8n_app. El Hub y PUBLIC no la ejecutan.
  IF NOT has_function_privilege('n8n_app', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'n8n_app debe poder consultar/tomar archivos'; END IF;
  IF has_function_privilege('daubert_hub_app', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'El Hub no debe ejecutar la consulta/toma'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = v_oid AND a.grantee = 0) THEN RAISE EXCEPTION 'PUBLIC conserva EXECUTE'; END IF;
END $check$;
\echo 'Funciones de archivos ejecutables por n8n_app (esperado: registrar y consultar, nada mas):'
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core' AND (p.proname LIKE 'fn_%archivo%' OR p.proname LIKE 'fn_%reproceso%') AND has_function_privilege('n8n_app', p.oid, 'EXECUTE') ORDER BY 1;
SELECT current_database() AS verified_database, '016 postcheck OK' AS result;
ROLLBACK;
