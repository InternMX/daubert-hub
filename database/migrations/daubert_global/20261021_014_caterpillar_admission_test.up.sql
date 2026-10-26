-- PREPARED ONLY. NOT APPLIED. TEST only; no backfill, grants, triggers or business-data changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '014 requires postgres exclusively in daubert_hub_test';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
    WHERE oid=to_regclass('core.documentos') AND relkind='r' AND pg_get_userbyid(relowner)='postgres') THEN
    RAISE EXCEPTION '014 requires the known core.documentos table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission' AND NOT attisdropped) THEN
    RAISE EXCEPTION '014 column already exists; refusing replacement';
  END IF;
END $guard$;
ALTER TABLE core.documentos ADD COLUMN caterpillar_admission JSONB NULL;
COMMIT;
