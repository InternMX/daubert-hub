BEGIN READ ONLY;
DO $$ BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED'; END IF;
  IF (SELECT enabled FROM cat_recovery_test.settings) IS DISTINCT FROM false THEN RAISE EXCEPTION 'CAT_RECOVERY_MUST_REMAIN_DISABLED'; END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='cat_recovery_test.attest(uuid,text,text)'::regprocedure),chr(13),'')) IS DISTINCT FROM '9c1e13a897f7c5ff7bc121669e328915' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ATTEST_025_DRIFT'; END IF;
END $$;
SELECT 'CAT_RECOVERY_026_PRECHECK_PASS';
ROLLBACK;
