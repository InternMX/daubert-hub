-- READ ONLY. Raises on missing/modified objects or excessive effective permissions.
BEGIN READ ONLY;
DO $postcheck$
DECLARE v_role text; v_func oid; v_ledger oid; v_seq oid; v_missing text; r record;
  v_backup_reader boolean;
BEGIN
  IF current_database() NOT IN ('daubert_hub_test','daubert_global') OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '013 postcheck requires postgres in an allowed database';
  END IF;
  v_role := CASE current_database() WHEN 'daubert_global' THEN 'daubert_hub_app' ELSE 'daubert_hub_test_user' END;
  v_func := to_regprocedure('operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)');
  v_ledger := to_regclass('operacion.cancelaciones_remisiones');
  IF v_func IS NULL OR v_ledger IS NULL OR to_regclass('operacion.cancelaciones_remisiones_cancelacion_id_seq') IS NULL THEN
    RAISE EXCEPTION '013 incomplete installation';
  END IF;
  v_seq := pg_get_serial_sequence('operacion.cancelaciones_remisiones','cancelacion_id')::regclass;
  IF v_seq IS DISTINCT FROM to_regclass('operacion.cancelaciones_remisiones_cancelacion_id_seq') THEN
    RAISE EXCEPTION '013 ledger sequence association drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_func AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND md5(replace(p.prosrc,chr(13),''))='f99511429b1ba54c89750259b2c6aaed') THEN
    RAISE EXCEPTION '013 function definition/owner/search_path drift';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='operacion' AND p.proname='fn_cancelar_remision_caterpillar' AND p.oid<>v_func) THEN
    RAISE EXCEPTION '013 unexpected function overload';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=v_ledger AND c.relkind='r'
    AND pg_get_userbyid(c.relowner)='postgres' AND NOT c.relrowsecurity)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=v_ledger AND NOT tgisinternal) THEN
    RAISE EXCEPTION '013 ledger ownership/RLS/trigger drift';
  END IF;
  SELECT string_agg(x.col,', ') INTO v_missing FROM (VALUES
    ('cancelacion_id','bigint',true),('remision_id','bigint',true),('motivo','text',true),
    ('usuario_id','bigint',false),('usuario_email','text',true),('usuario_nombre','text',true),
    ('cancelada_en','timestamp with time zone',true),('request_id','text',false)
  ) x(col,typ,nn) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=v_ledger AND a.attname=x.col AND NOT a.attisdropped
    WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>x.typ OR a.attnotnull<>x.nn;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION '013 ledger column drift: %',v_missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=v_ledger AND attname='cancelacion_id' AND attidentity='a')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE a.attrelid=v_ledger AND a.attname='cancelada_en' AND pg_get_expr(d.adbin,d.adrelid)='clock_timestamp()')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='p' AND conkey=ARRAY[1]::smallint[])
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='u' AND conkey=ARRAY[2]::smallint[])
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='f' AND conkey=ARRAY[2]::smallint[]
      AND confrelid='operacion.remisiones'::regclass AND confdeltype='r' AND convalidated)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='f' AND conkey=ARRAY[4]::smallint[]
      AND confrelid='security.users'::regclass AND confdeltype='n' AND convalidated)
    OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='c' AND convalidated)<>4
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='c' AND conkey=ARRAY[3]::smallint[] AND pg_get_constraintdef(oid) LIKE '%500%' AND pg_get_constraintdef(oid) LIKE '%btrim%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='c' AND conkey=ARRAY[5]::smallint[] AND pg_get_constraintdef(oid) LIKE '%btrim%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='c' AND conkey=ARRAY[6]::smallint[] AND pg_get_constraintdef(oid) LIKE '%btrim%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=v_ledger AND contype='c' AND conkey=ARRAY[8]::smallint[] AND pg_get_constraintdef(oid) LIKE '%200%') THEN
    RAISE EXCEPTION '013 ledger constraint/default drift';
  END IF;
  IF NOT has_function_privilege(v_role,v_func,'EXECUTE') OR NOT has_table_privilege(v_role,v_ledger,'SELECT')
    OR has_table_privilege(v_role,'operacion.remisiones','UPDATE,DELETE,TRUNCATE')
    OR has_any_column_privilege(v_role,'operacion.remisiones','UPDATE') THEN
    RAISE EXCEPTION '013 Hub privilege drift';
  END IF;
  -- Effective privileges catch membership/default-grant leakage, not only direct ACL entries.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='daubert_backup' AND rolsuper) THEN
    RAISE EXCEPTION '013 backup role policy drift';
  END IF;
  FOR r IN SELECT * FROM pg_catalog.pg_roles WHERE NOT rolsuper AND rolname<>'postgres' LOOP
    -- Only this verified backup principal may inherit ledger/sequence SELECT. SELECT on a
    -- sequence reads its state; USAGE or UPDATE permits nextval/setval and is never exempted.
    -- Do not trust the name alone: require the read-all membership, a non-administrative
    -- login and no other inherited/member/SET-role path. No grants or role changes here.
    v_backup_reader := r.rolname='daubert_backup' AND r.rolcanlogin AND r.rolinherit
      AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND pg_has_role(r.oid,'pg_read_all_data','USAGE')
      AND NOT has_schema_privilege(r.oid,'operacion','CREATE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles other_role
        WHERE other_role.oid<>r.oid AND other_role.rolname<>'pg_read_all_data'
          AND (pg_has_role(r.oid,other_role.oid,'MEMBER') OR pg_has_role(r.oid,other_role.oid,'USAGE')
            OR pg_has_role(r.oid,other_role.oid,'SET')));
    IF r.rolname='daubert_backup' AND NOT v_backup_reader THEN
      RAISE EXCEPTION '013 backup role policy drift';
    END IF;
    IF (r.rolname<>v_role AND has_function_privilege(r.oid,v_func,'EXECUTE'))
      OR (r.rolname<>v_role AND NOT v_backup_reader AND r.rolname !~ '^pg_'
        AND (has_any_column_privilege(r.oid,v_ledger,'SELECT') OR has_sequence_privilege(r.oid,v_seq,'SELECT')))
      OR (r.rolname !~ '^pg_' AND (has_table_privilege(r.oid,v_ledger,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        OR has_any_column_privilege(r.oid,v_ledger,'INSERT,UPDATE,REFERENCES')
        OR has_sequence_privilege(r.oid,v_seq,'USAGE,UPDATE')
        OR (r.rolname=v_role AND has_sequence_privilege(r.oid,v_seq,'SELECT')))) THEN
      RAISE EXCEPTION '013 excessive effective privileges for %',r.rolname;
    END IF;
  END LOOP;
  IF has_function_privilege('public',v_func,'EXECUTE')
    OR has_table_privilege('public',v_ledger,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
    OR has_any_column_privilege('public',v_ledger,'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_sequence_privilege('public',v_seq,'SELECT,USAGE,UPDATE') THEN
    RAISE EXCEPTION '013 PUBLIC privilege drift';
  END IF;
END $postcheck$;
SELECT 'POSTCHECK_013_PASS' AS result;
SELECT md5(COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY s.serie_id),'')) AS series_fingerprint
  FROM operacion.series_documentales s;
SELECT estatus,count(*) FROM operacion.reservas_folios GROUP BY estatus;
COMMIT;
