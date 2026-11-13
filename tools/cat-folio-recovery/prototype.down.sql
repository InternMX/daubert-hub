-- Only for the isolated prototype; never discard a recovery ledger containing history.
DO $$ BEGIN
  IF current_database() IN ('daubert_global', 'daubert_hub_test')
     OR current_setting('cat_recovery.sandbox', true) IS DISTINCT FROM 'isolated' THEN
    RAISE EXCEPTION 'CAT_RECOVERY_ISOLATED_SANDBOX_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM cat_recovery_prototype.recoveries)
     OR EXISTS (SELECT 1 FROM cat_recovery_prototype.evidence) THEN
    RAISE EXCEPTION 'CAT_RECOVERY_HISTORY_MUST_BE_RETAINED';
  END IF;
END $$;
DROP FUNCTION cat_recovery_prototype.recover(bigint,bigint,uuid,uuid,bigint,text,boolean);
DROP TABLE cat_recovery_prototype.recoveries;
DROP TABLE cat_recovery_prototype.evidence;
DROP SCHEMA cat_recovery_prototype;
