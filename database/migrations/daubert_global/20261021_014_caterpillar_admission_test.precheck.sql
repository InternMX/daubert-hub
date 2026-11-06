-- READ ONLY. Next local number after 013; confirm allocation before any future application.
BEGIN READ ONLY;
DO $precheck$
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
    RAISE EXCEPTION '014 column already exists; use postcheck, do not overwrite';
  END IF;
END $precheck$;
SELECT 'PRECHECK_014_PASS' AS result;
-- Record this before and after DDL; the added NULL column is deliberately excluded.
SELECT count(*) AS documents,
  md5(COALESCE(string_agg((to_jsonb(d)-'caterpillar_admission')::text,'|' ORDER BY documento_id),'')) AS existing_document_data_fingerprint
FROM core.documentos d;
COMMIT;
