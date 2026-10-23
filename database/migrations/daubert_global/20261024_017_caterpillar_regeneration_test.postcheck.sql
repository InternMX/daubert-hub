-- READ ONLY. 017 (TEST) postcheck: objects, fingerprints, constraints and effective privileges. Does not invoke business functions.
BEGIN READ ONLY;
DO $postcheck$
DECLARE f record; r record; p record;
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '017 TEST postcheck only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('operacion.autorizaciones_regeneracion_caterpillar') AND relkind='r' AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION '017 table missing'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='operacion.autorizaciones_regeneracion_caterpillar'::regclass AND contype='u')<>2
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='operacion.autorizaciones_regeneracion_caterpillar'::regclass AND contype='f')<>3 THEN RAISE EXCEPTION '017 uniqueness/reference drift'; END IF;
  FOR f IN SELECT * FROM (VALUES
    ('operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)','884ffa20d8f4b9d4561d807c9e2a4851'),
    ('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)','7bbb0715fc8db4ff0a7252c7db13f81c')
  ) expected(signature,body_hash) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(f.signature);
    IF NOT FOUND OR NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR md5(replace(p.prosrc,chr(13),''))<>f.body_hash THEN RAISE EXCEPTION '017 function definition drift'; END IF;
    IF has_function_privilege('public',p.oid,'EXECUTE') THEN RAISE EXCEPTION '017 PUBLIC execute drift'; END IF;
  END LOOP;
  FOR r IN SELECT oid,rolname FROM pg_roles WHERE NOT rolsuper AND rolname<>'postgres' LOOP
    IF has_function_privilege(r.oid,'operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)'::regprocedure,'EXECUTE') IS DISTINCT FROM (r.rolname='daubert_hub_test_user') THEN RAISE EXCEPTION '017 authorize privilege drift'; END IF;
    IF has_function_privilege(r.oid,'ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)'::regprocedure,'EXECUTE') IS DISTINCT FROM (r.rolname='n8n_cat_test') THEN RAISE EXCEPTION '017 reprocess privilege drift'; END IF;
  END LOOP;
  -- Explicit table ACL: owner plus read-only for the Hub role. Predefined/backup roles keep their implicit rights and are not part of this contract.
  IF EXISTS(SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid='operacion.autorizaciones_regeneracion_caterpillar'::regclass)) a
    WHERE a.grantee<>(SELECT relowner FROM pg_class WHERE oid='operacion.autorizaciones_regeneracion_caterpillar'::regclass)
      AND NOT (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='daubert_hub_test_user') AND a.privilege_type='SELECT' AND NOT a.is_grantable)) THEN RAISE EXCEPTION '017 table ACL drift'; END IF;
  IF EXISTS(SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid='operacion.autorizaciones_regeneracion_caterpillar_autorizacion_id_seq'::regclass)) a
    WHERE a.grantee<>(SELECT relowner FROM pg_class WHERE oid='operacion.autorizaciones_regeneracion_caterpillar_autorizacion_id_seq'::regclass)) THEN RAISE EXCEPTION '017 sequence ACL drift'; END IF;
END $postcheck$;
SELECT 'POSTCHECK_017_PASS' AS result;
COMMIT;
