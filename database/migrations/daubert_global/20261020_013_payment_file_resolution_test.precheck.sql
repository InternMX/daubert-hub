-- 013 (TEST ONLY): precheck. SOLO LECTURA. Ejecutar con un administrador conectado a daubert_hub_test.
\set ON_ERROR_STOP on
SELECT current_database() AS base, current_user AS usuario;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION '013 es solo para daubert_hub_test (conectado a %)', current_database();
  END IF;
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN
    RAISE EXCEPTION 'Se requiere una conexion administrativa con CREATE en core';
  END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NULL
     OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NULL THEN
    RAISE EXCEPTION 'Falta la migracion 012';
  END IF;
  IF to_regprocedure('core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Falta fn_resolver_archivo_notificacion_pago (012)';
  END IF;
  IF to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)') IS NOT NULL THEN
    RAISE EXCEPTION '013 ya aplicada: la funcion existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_app_test') THEN
    RAISE EXCEPTION 'Falta el rol n8n_app_test';
  END IF;
END $guard$;
-- Informativo: la 012 queda intacta (no se modifica ni se reemplaza ninguna funcion existente).
SELECT p.oid::regprocedure AS funcion_existente FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core' AND (p.proname LIKE 'fn_%archivo%notificacion_pago' OR p.proname = 'fn_bloquear_archivos_reproceso_pago') ORDER BY 1;
