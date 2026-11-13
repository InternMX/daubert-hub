-- TEST only. Preserve installed 025; renew custody only through a fresh trusted-coordinator attestation.
-- SQL cannot inspect files/delivery: keep enabled=false until a reviewed coordinator rechecks both before EVERY attest.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ DECLARE definition text; BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  IF (SELECT enabled FROM cat_recovery_test.settings) IS DISTINCT FROM false THEN RAISE EXCEPTION 'CAT_RECOVERY_MUST_REMAIN_DISABLED'; END IF;
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO') THEN RAISE EXCEPTION 'CAT_RECOVERY_IDLE_CUTOVER_REQUIRED'; END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='cat_recovery_test.attest(uuid,text,text)'::regprocedure),chr(13),'')) IS DISTINCT FROM '9c1e13a897f7c5ff7bc121669e328915' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ATTEST_025_DRIFT'; END IF;
  definition:=pg_get_functiondef('cat_recovery_test.attest(uuid,text,text)'::regprocedure);
  definition:=replace(definition,
    'IF r.state=''READY'' AND r.manifest=p_manifest AND r.manifest_sha256=p_sha256 THEN RETURN; END IF;',
    'IF r.state=''READY'' AND (r.manifest IS DISTINCT FROM p_manifest OR r.manifest_sha256 IS DISTINCT FROM p_sha256) THEN RAISE EXCEPTION ''CAT_RECOVERY_ATTESTATION_CONFLICT''; END IF;');
  definition:=replace(definition,'IF r.state<>''PREPARING'' THEN','IF r.state NOT IN (''PREPARING'',''READY'') THEN');
  EXECUTE definition; -- CREATE OR REPLACE preserves ownership, search_path and the dedicated coordinator ACL.
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='cat_recovery_test.attest(uuid,text,text)'::regprocedure),chr(13),''))<>'6176757b7a987d105b7aba6f410ea9d2' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ATTEST_026_PATCH_FAILED'; END IF;
END $$;
COMMIT;
