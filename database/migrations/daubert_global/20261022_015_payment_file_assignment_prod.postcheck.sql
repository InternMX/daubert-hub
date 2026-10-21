-- 015 PRODUCCION - POSTCHECK. SOLO LECTURA. Ejecutar con un administrador en daubert_global DESPUES del up. Cualquier fallo = RAISE EXCEPTION.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE
  v_reg text := 'core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean)';
  v_res text := 'core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)';
  v_asi text := 'core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)';
  v_blo text := 'core.fn_bloquear_archivos_reproceso_pago(bigint)';
  v_t text;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '015 postcheck es solo para daubert_global'; END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NULL OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NULL THEN RAISE EXCEPTION 'Faltan las tablas de la 015'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('core.archivos_notificacion_pago'::regclass, 'core.asignaciones_archivo_notificacion_pago'::regclass)
        AND NOT tgisinternal AND tgfoid = 'audit.fn_registrar_cambio()'::regprocedure) <> 2 THEN RAISE EXCEPTION 'Faltan los triggers de auditoria'; END IF;
  -- n8n_app (rol COMPARTIDO con Caterpillar/Audi): unicamente EXECUTE sobre registrar; nada sobre tablas ni sobre las demas funciones.
  IF NOT has_function_privilege('n8n_app', v_reg, 'EXECUTE') THEN RAISE EXCEPTION 'n8n_app debe poder registrar archivos'; END IF;
  IF has_function_privilege('n8n_app', v_res, 'EXECUTE') OR has_function_privilege('n8n_app', v_asi, 'EXECUTE') OR has_function_privilege('n8n_app', v_blo, 'EXECUTE') THEN
    RAISE EXCEPTION 'n8n_app tiene EXECUTE de mas';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['core.archivos_notificacion_pago', 'core.asignaciones_archivo_notificacion_pago'] LOOP
    IF has_table_privilege('n8n_app', v_t, 'SELECT') OR has_table_privilege('n8n_app', v_t, 'INSERT') OR has_table_privilege('n8n_app', v_t, 'UPDATE')
       OR has_table_privilege('n8n_app', v_t, 'DELETE') OR has_table_privilege('n8n_app', v_t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'n8n_app no debe tener privilegios directos sobre %', v_t;
    END IF;
  END LOOP;
  -- Hub (daubert_hub_app): lee archivos; gestiona asignaciones; NO escribe identidades ni ejecuta registrar/resolver.
  IF NOT has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'SELECT')
     OR has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'INSERT')
     OR has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'UPDATE')
     OR has_table_privilege('daubert_hub_app', 'core.archivos_notificacion_pago', 'DELETE') THEN RAISE EXCEPTION 'Permisos del Hub sobre archivos incorrectos'; END IF;
  IF NOT has_table_privilege('daubert_hub_app', 'core.asignaciones_archivo_notificacion_pago', 'SELECT')
     OR NOT has_table_privilege('daubert_hub_app', 'core.asignaciones_archivo_notificacion_pago', 'INSERT')
     OR NOT has_table_privilege('daubert_hub_app', 'core.asignaciones_archivo_notificacion_pago', 'UPDATE')
     OR has_table_privilege('daubert_hub_app', 'core.asignaciones_archivo_notificacion_pago', 'DELETE') THEN RAISE EXCEPTION 'Permisos del Hub sobre asignaciones incorrectos'; END IF;
  IF has_function_privilege('daubert_hub_app', v_reg, 'EXECUTE') OR has_function_privilege('daubert_hub_app', v_res, 'EXECUTE') THEN RAISE EXCEPTION 'El Hub no debe registrar ni resolver'; END IF;
  IF NOT has_function_privilege('daubert_hub_app', v_asi, 'EXECUTE') OR NOT has_function_privilege('daubert_hub_app', v_blo, 'EXECUTE') THEN RAISE EXCEPTION 'El Hub necesita asignable/bloquear'; END IF;
  -- PUBLIC no ejecuta nada de la 015.
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid IN (v_reg::regprocedure, v_res::regprocedure, v_asi::regprocedure, v_blo::regprocedure) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC conserva EXECUTE';
  END IF;
END $check$;
SELECT current_database() AS verified_database, '015 postcheck OK' AS result;
ROLLBACK;
