BEGIN READ ONLY;
DO $$ BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED'; END IF;
  IF to_regnamespace('cat_recovery_test') IS NOT NULL THEN RAISE EXCEPTION 'CAT_RECOVERY_ALREADY_INSTALLED'; END IF;
  IF to_regprocedure('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)') IS NULL
    OR to_regprocedure('ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer)') IS NULL THEN RAISE EXCEPTION 'CAT_RECOVERY_REAL_GATES_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cat_recovery_test_coordinator' AND NOT rolcanlogin
    AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication)) THEN RAISE EXCEPTION 'CAT_RECOVERY_DEDICATED_COORDINATOR_ROLE_REQUIRED'; END IF;
  IF has_function_privilege('n8n_cat_test','operacion.reservar_folios_para_ejecucion(bigint,text,integer)','EXECUTE')
    OR has_table_privilege('n8n_cat_test','operacion.reservas_folios','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_any_column_privilege('n8n_cat_test','operacion.reservas_folios','INSERT,UPDATE')
    OR has_table_privilege('n8n_cat_test','operacion.series_documentales','UPDATE')
    OR has_any_column_privilege('n8n_cat_test','operacion.series_documentales','UPDATE') THEN RAISE EXCEPTION 'CAT_RECOVERY_LEGACY_OR_DML_BYPASS'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO') THEN RAISE EXCEPTION 'CAT_RECOVERY_IDLE_CUTOVER_REQUIRED'; END IF;
END $$;
SELECT 'CAT_RECOVERY_025_PRECHECK_PASS';
ROLLBACK;
