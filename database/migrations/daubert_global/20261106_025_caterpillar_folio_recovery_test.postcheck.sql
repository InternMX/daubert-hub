BEGIN READ ONLY;
DO $$ DECLARE b record; BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED'; END IF;
  IF (SELECT enabled FROM cat_recovery_test.settings) THEN RAISE EXCEPTION 'CAT_RECOVERY_MUST_REMAIN_DISABLED'; END IF;
  IF (SELECT count(*) FROM cat_recovery_test.gate_backup)<>2 THEN RAISE EXCEPTION 'CAT_RECOVERY_GATE_BACKUP_INCOMPLETE'; END IF;
  FOR b IN SELECT * FROM cat_recovery_test.gate_backup LOOP
    IF md5(pg_get_functiondef(to_regprocedure(b.signature)))<>b.installed_md5 THEN RAISE EXCEPTION 'CAT_RECOVERY_GATE_CHANGED'; END IF;
  END LOOP;
  IF has_function_privilege('daubert_hub_test_user','cat_recovery_test.start(uuid,text)','EXECUTE')
    OR has_function_privilege('n8n_cat_test','cat_recovery_test.attest(uuid,text,text)','EXECUTE')
    OR has_table_privilege('n8n_cat_test','cat_recovery_test.requests','INSERT,UPDATE,DELETE')
    OR has_table_privilege('daubert_hub_test_user','cat_recovery_test.requests','INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'CAT_RECOVERY_PRIVILEGE_BYPASS'; END IF;
END $$;
SELECT 'CAT_RECOVERY_025_POSTCHECK_PASS_DISABLED';
ROLLBACK;
