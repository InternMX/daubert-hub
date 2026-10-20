-- 014 (TEST ONLY): precheck. SOLO LECTURA. Ejecutar con un administrador conectado a daubert_hub_test.
\set ON_ERROR_STOP on
SELECT current_database() AS base, current_user AS usuario;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION '014 es solo para daubert_hub_test (conectado a %)', current_database();
  END IF;
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN
    RAISE EXCEPTION 'Se requiere una conexion administrativa con CREATE en core';
  END IF;
  IF to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)') IS NULL THEN
    RAISE EXCEPTION 'Falta la migracion 013';
  END IF;
  IF to_regprocedure('core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean)') IS NOT NULL
     OR to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '014 ya aplicada: las funciones existen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user') THEN
    RAISE EXCEPTION 'Falta el rol daubert_hub_test_user (aplicacion del Hub en TEST)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_app_test') THEN
    RAISE EXCEPTION 'Falta el rol n8n_app_test';
  END IF;
END $guard$;
-- Informativo: permisos actuales de la funcion 013 (deben conservarse tras la 014)
SELECT has_function_privilege('n8n_app_test', 'core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)', 'EXECUTE') AS n8n_app_test_013,
       has_function_privilege('daubert_hub_test_user', 'core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)', 'EXECUTE') AS hub_013;
