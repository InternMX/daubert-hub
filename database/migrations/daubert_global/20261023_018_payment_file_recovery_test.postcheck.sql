BEGIN READ ONLY;
DO $check$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'TEST ONLY'; END IF;
  IF to_regclass('core.recuperaciones_notificacion_pago') IS NULL THEN RAISE EXCEPTION '018 missing'; END IF;
  IF has_function_privilege('daubert_hub_test_user', 'core.fn_finalizar_recuperacion_pago(bigint,text)', 'EXECUTE')
     OR has_function_privilege('daubert_hub_test_user', 'core.fn_observar_archivos_pago_sin_efectos(bigint,text,jsonb)', 'EXECUTE')
     OR has_table_privilege('n8n_app_test', 'core.recuperaciones_notificacion_pago', 'UPDATE') THEN
    RAISE EXCEPTION 'Unsafe recovery permissions';
  END IF;
  IF NOT has_function_privilege('n8n_app_test', 'core.fn_finalizar_recuperacion_pago(bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Missing isolated n8n permission';
  END IF;
END $check$;
SELECT current_database(), '018 permissions OK' AS result;
ROLLBACK;
