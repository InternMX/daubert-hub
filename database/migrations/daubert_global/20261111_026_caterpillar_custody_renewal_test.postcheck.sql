BEGIN READ ONLY;
DO $$ BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED'; END IF;
  IF (SELECT enabled FROM cat_recovery_test.settings) IS DISTINCT FROM false THEN RAISE EXCEPTION 'CAT_RECOVERY_MUST_REMAIN_DISABLED'; END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='cat_recovery_test.attest(uuid,text,text)'::regprocedure),chr(13),'')) IS DISTINCT FROM '6176757b7a987d105b7aba6f410ea9d2' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ATTEST_026_DRIFT'; END IF;
  IF NOT has_function_privilege('cat_recovery_test_coordinator','cat_recovery_test.attest(uuid,text,text)','EXECUTE')
    OR has_function_privilege('n8n_cat_test','cat_recovery_test.attest(uuid,text,text)','EXECUTE')
    OR has_function_privilege('daubert_hub_test_user','cat_recovery_test.attest(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ATTEST_PRIVILEGE_BYPASS'; END IF;
END $$;
SELECT 'CAT_RECOVERY_026_POSTCHECK_PASS_DISABLED';
ROLLBACK;
