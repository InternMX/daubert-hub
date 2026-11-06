-- READ ONLY. Validates installation without requiring snapshots or fabricating historical data.
BEGIN READ ONLY;
DO $postcheck$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '014 postcheck requires postgres exclusively in daubert_hub_test';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE c.oid=to_regclass('core.documentos') AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres'
      AND a.attname='caterpillar_admission' AND NOT a.attisdropped AND a.atttypid='jsonb'::regtype
      AND NOT a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='') THEN
    RAISE EXCEPTION '014 missing or incompatible snapshot column';
  END IF;
END $postcheck$;
SELECT 'POSTCHECK_014_PASS' AS result;
SELECT count(*) AS documents,count(caterpillar_admission) AS documents_with_snapshot,
  md5(COALESCE(string_agg((to_jsonb(d)-'caterpillar_admission')::text,'|' ORDER BY documento_id),'')) AS existing_document_data_fingerprint
FROM core.documentos d;
COMMIT;
