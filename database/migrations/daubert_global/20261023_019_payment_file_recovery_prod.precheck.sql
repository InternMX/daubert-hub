-- READ ONLY; prepared, not executed as a production migration during preparation.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '019 requires daubert_global'; END IF;
  IF to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)') IS NULL THEN RAISE EXCEPTION '017 required'; END IF;
  IF to_regclass('core.recuperaciones_notificacion_pago') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='core.archivos_notificacion_pago'::regclass
                AND attname='sin_efectos_ejecucion' AND NOT attisdropped) THEN RAISE EXCEPTION '019 already installed or retained after rollback'; END IF;
  IF md5(replace(pg_get_functiondef('core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)'::regprocedure),chr(13),'')) <> '72d4a136868329c8258c0479a09facc7'
     OR md5(replace(pg_get_functiondef('core.fn_bloquear_archivos_reproceso_pago(bigint)'::regprocedure),chr(13),'')) <> '4cd80be8f694670024553205fa7f605d' THEN
    RAISE EXCEPTION 'Function baseline drift; refresh UP/DOWN first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='daubert_hub_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='n8n_app') THEN RAISE EXCEPTION 'Production roles missing'; END IF;
END $guard$;
SELECT current_database(), current_user;
SELECT p.oid::regprocedure, md5(replace(pg_get_functiondef(p.oid),chr(13),'')) AS definition_md5, p.proacl
FROM pg_proc p WHERE p.oid IN ('core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)'::regprocedure,
  'core.fn_bloquear_archivos_reproceso_pago(bigint)'::regprocedure);
-- Informational: a historical PENDIENTE is not proof that an n8n execution is active.
SELECT estado, count(*) FROM core.correos_notificacion_pago GROUP BY estado;
ROLLBACK;
