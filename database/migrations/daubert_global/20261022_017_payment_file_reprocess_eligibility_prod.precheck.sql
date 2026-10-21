-- 017 PRODUCCION - PRECHECK. SOLO LECTURA. Ejecutar con un administrador en daubert_global DESPUES de la 016 y ANTES del up de la 017.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database() AS base, current_user AS usuario;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '017 es solo para daubert_global (conectado a %)', current_database(); END IF;
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN RAISE EXCEPTION 'Se requiere una conexion administrativa con CREATE en core'; END IF;
  IF to_regprocedure('core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer)') IS NULL THEN RAISE EXCEPTION 'Falta la migracion 016'; END IF;
  IF to_regprocedure('core.fn_evaluar_archivo_notificacion_pago(bigint,boolean,boolean)') IS NOT NULL
     OR to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)') IS NOT NULL THEN RAISE EXCEPTION '017 ya aplicada parcial o totalmente'; END IF;
END $guard$;
-- La 017 reemplaza la funcion de la 016: no debe haber transacciones largas abiertas (informativo).
SELECT pid, state, now() - xact_start AS antiguedad, left(query, 80) AS consulta FROM pg_stat_activity
WHERE datname = 'daubert_global' AND state <> 'idle' AND xact_start < now() - interval '1 minute' ORDER BY xact_start;
ROLLBACK;
