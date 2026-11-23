BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ DECLARE b record; BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CAT_RECOVERY_TEST_OWNER_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
  IF EXISTS(SELECT 1 FROM cat_recovery_test.requests) THEN RAISE EXCEPTION 'CAT_RECOVERY_HISTORY_MUST_BE_RETAINED'; END IF;
  FOR b IN SELECT * FROM cat_recovery_test.gate_backup LOOP
    IF md5(pg_get_functiondef(to_regprocedure(b.signature)))<>b.installed_md5 THEN RAISE EXCEPTION 'CAT_RECOVERY_GATE_CHANGED'; END IF;
    EXECUTE b.definition;
  END LOOP;
END $$;
DROP SCHEMA cat_recovery_test CASCADE;
COMMIT;
