-- READ ONLY. Run with an administrative TEST connection. No production execution.
BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION '012 is TEST-only; connected to %', current_database();
  END IF;
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN
    RAISE EXCEPTION 'Administrative TEST connection with CREATE on core is required';
  END IF;
  IF to_regclass('core.correos_notificacion_pago') IS NULL
     OR to_regclass('core.empresas') IS NULL
     OR to_regclass('core.resultados_notificacion_pago') IS NULL
     OR to_regclass('core.borradores_notificacion_pago') IS NULL
     OR to_regprocedure('audit.fn_registrar_cambio()') IS NULL THEN
    RAISE EXCEPTION 'Missing existing payment/audit infrastructure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user') THEN
    RAISE EXCEPTION 'Expected TEST application roles are missing';
  END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NOT NULL
     OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NOT NULL THEN
    RAISE EXCEPTION '012 objects already exist; inspect instead of overwriting';
  END IF;
END $guard$;
SELECT current_database() AS verified_database, '012 precheck OK' AS result;
ROLLBACK;
