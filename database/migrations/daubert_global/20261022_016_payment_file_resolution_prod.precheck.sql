-- 016 PRODUCCION - PRECHECK. SOLO LECTURA. Ejecutar con un administrador en daubert_global DESPUES de la 015 y ANTES del up de la 016.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database() AS base, current_user AS usuario;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '016 es solo para daubert_global (conectado a %)', current_database(); END IF;
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN RAISE EXCEPTION 'Se requiere una conexion administrativa con CREATE en core'; END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NULL OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NULL THEN RAISE EXCEPTION 'Falta la migracion 015'; END IF;
  IF to_regprocedure('core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean)') IS NULL THEN RAISE EXCEPTION 'Falta fn_resolver_archivo_notificacion_pago (015)'; END IF;
  IF to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)') IS NOT NULL THEN RAISE EXCEPTION '016 ya aplicada: la funcion existe'; END IF;
END $guard$;
SELECT p.oid::regprocedure AS funcion_existente FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core' AND (p.proname LIKE 'fn_%archivo%notificacion_pago' OR p.proname = 'fn_bloquear_archivos_reproceso_pago') ORDER BY 1;
ROLLBACK;
