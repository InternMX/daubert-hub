BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'TEST ONLY'; END IF;
  IF to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)') IS NULL THEN RAISE EXCEPTION '014 required'; END IF;
  IF to_regclass('core.recuperaciones_notificacion_pago') IS NOT NULL THEN RAISE EXCEPTION '018 already installed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_app_test') THEN RAISE EXCEPTION 'Isolated TEST role required'; END IF;
END $guard$;
SELECT current_database(), current_user;
ROLLBACK;
