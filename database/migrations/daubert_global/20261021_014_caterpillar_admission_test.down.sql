-- MANUAL ONLY. Never discard snapshots. No automatic infrastructure rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '014 rollback requires postgres exclusively in daubert_hub_test';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE c.oid=to_regclass('core.documentos') AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres'
      AND a.attname='caterpillar_admission' AND NOT a.attisdropped AND a.atttypid='jsonb'::regtype
      AND NOT a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='') THEN
    RAISE EXCEPTION '014 rollback refuses unknown column definition';
  END IF;
END $guard$;
LOCK TABLE core.documentos IN ACCESS EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM core.documentos WHERE caterpillar_admission IS NOT NULL) THEN
    RAISE EXCEPTION '014 snapshots exist; rollback refused';
  END IF;
END $empty$;
ALTER TABLE core.documentos DROP COLUMN caterpillar_admission;
COMMIT;
