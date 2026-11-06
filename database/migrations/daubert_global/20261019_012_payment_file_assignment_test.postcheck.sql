BEGIN READ ONLY;
DO $check$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION '012 postcheck is TEST-only'; END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NULL
     OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NULL THEN
    RAISE EXCEPTION '012 tables missing';
  END IF;
  IF has_function_privilege('daubert_hub_test_user', 'core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean)', 'EXECUTE')
     OR has_table_privilege('daubert_hub_test_user', 'core.archivos_notificacion_pago', 'INSERT')
     OR has_table_privilege('daubert_hub_test_user', 'core.archivos_notificacion_pago', 'UPDATE') THEN
    RAISE EXCEPTION 'Browser/API role can write trusted identities';
  END IF;
  IF NOT has_function_privilege('n8n_app', 'core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('n8n_app', 'core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)', 'EXECUTE')
     OR NOT has_table_privilege('daubert_hub_test_user', 'core.asignaciones_archivo_notificacion_pago', 'UPDATE') THEN
    RAISE EXCEPTION 'Required new-object permissions missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN (
        'core.archivos_notificacion_pago'::regclass, 'core.asignaciones_archivo_notificacion_pago'::regclass)
      AND NOT tgisinternal AND tgfoid = 'audit.fn_registrar_cambio()'::regprocedure) <> 2 THEN
    RAISE EXCEPTION 'Audit triggers missing';
  END IF;
END $check$;
SELECT current_database() AS verified_database, '012 postcheck OK' AS result;
ROLLBACK;
