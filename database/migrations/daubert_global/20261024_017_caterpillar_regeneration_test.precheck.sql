-- READ ONLY. 017 (TEST): commercial regeneration.
BEGIN READ ONLY;
DO $precheck$
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '017 requires postgres exclusively in TEST'; END IF;
  IF to_regclass('operacion.cancelaciones_remisiones') IS NULL OR to_regprocedure('operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION '017 requires the individual cancellation ledger (013)'; END IF;
  IF to_regprocedure('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)') IS NULL OR to_regprocedure('ops.fn_cat_snapshot_015(bigint,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '017 requires 015'; END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)')),chr(13),''))<>'da2088a4bb82bffb90ccd632d6108dde' THEN
    RAISE EXCEPTION '017 expects the validated 015 reprocess definition; review required'; END IF;
  IF to_regclass('operacion.autorizaciones_regeneracion_caterpillar') IS NOT NULL
    OR to_regprocedure('operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)') IS NOT NULL THEN RAISE EXCEPTION '017 objects already exist; refusing replacement'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='daubert_hub_test_user') THEN RAISE EXCEPTION '017 requires the Hub TEST role'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO') THEN
    RAISE EXCEPTION '017 requires an idle Caterpillar worker (no PROCESANDO execution)'; END IF;
END $precheck$;
SELECT 'PRECHECK_017_PASS' AS result;
COMMIT;
