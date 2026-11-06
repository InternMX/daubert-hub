-- READ ONLY, strict preflight. Refuses both partial installation and a second installation.
BEGIN READ ONLY;
DO $precheck$
DECLARE v_role text; v_missing text;
BEGIN
  IF current_database() NOT IN ('daubert_hub_test','daubert_global') OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '013 precheck requires postgres in an allowed database';
  END IF;
  v_role := CASE current_database() WHEN 'daubert_global' THEN 'daubert_hub_app' ELSE 'daubert_hub_test_user' END;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role) THEN
    RAISE EXCEPTION '013 runtime role missing';
  END IF;
  IF to_regclass('operacion.cancelaciones_remisiones') IS NOT NULL
    OR to_regclass('operacion.cancelaciones_remisiones_cancelacion_id_seq') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='operacion' AND p.proname='fn_cancelar_remision_caterpillar') THEN
    RAISE EXCEPTION '013 objects present: use postcheck for complete installations; review partial installations manually';
  END IF;
  SELECT string_agg(x.rel || '.' || x.col, ', ') INTO v_missing
  FROM (VALUES
    ('operacion.remisiones','remision_id','bigint',true),
    ('operacion.remisiones','ejecucion_id','bigint',true),
    ('operacion.remisiones','estatus','text',true),
    ('operacion.remisiones','motivo_cancelacion','text',false),
    ('operacion.remisiones','updated_at','timestamp with time zone',true),
    ('ops.ejecuciones_automatizacion','ejecucion_id','bigint',true),
    ('ops.ejecuciones_automatizacion','automatizacion_id','bigint',true),
    ('ops.ejecuciones_automatizacion','estado','text',true),
    ('ops.automatizaciones','automatizacion_id','bigint',true),
    ('ops.automatizaciones','codigo','text',true),
    ('security.users','user_id','bigint',true),
    ('security.users','email','text',true),
    ('security.users','display_name','text',true),
    ('security.users','role','text',true),
    ('security.users','status','text',true),
    ('security.users','must_change_password','boolean',true)
  ) x(rel,col,typ,nn)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=to_regclass(x.rel) AND a.attname=x.col AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>x.typ OR a.attnotnull<>x.nn;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION '013 incompatible columns: %',v_missing; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('operacion.remisiones','remision_id'),('security.users','user_id')) x(rel,col)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a
      ON a.attrelid=c.conrelid AND a.attname=x.col
      WHERE c.conrelid=to_regclass(x.rel) AND c.contype='p' AND c.conkey=ARRAY[a.attnum])) THEN
    RAISE EXCEPTION '013 prerequisite primary key incompatible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='operacion.remisiones'::regclass
    AND t.tgenabled='O' AND t.tgfoid=to_regprocedure('core.fn_actualizar_updated_at()') AND (t.tgtype::int & 19)=19) THEN
    RAISE EXCEPTION '013 enabled timestamp trigger missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=v_role AND (rolsuper OR rolcreaterole OR rolbypassrls))
    OR has_schema_privilege(v_role,'operacion','CREATE') OR NOT has_schema_privilege(v_role,'operacion','USAGE')
    OR has_table_privilege(v_role,'operacion.remisiones','UPDATE,DELETE,TRUNCATE')
    OR has_any_column_privilege(v_role,'operacion.remisiones','UPDATE') THEN
    RAISE EXCEPTION '013 runtime privilege drift';
  END IF;
END $precheck$;
SELECT 'PRECHECK_013_PASS' AS result;
SELECT t.tgname, pg_get_triggerdef(t.oid) FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='operacion.remisiones'::regclass AND NOT t.tgisinternal;
-- Operator records these baselines before/after DDL. Any unexpected activity requires investigation.
SELECT md5(COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY s.serie_id),'')) AS series_fingerprint
  FROM operacion.series_documentales s;
SELECT estatus,count(*) FROM operacion.reservas_folios GROUP BY estatus;
COMMIT;
