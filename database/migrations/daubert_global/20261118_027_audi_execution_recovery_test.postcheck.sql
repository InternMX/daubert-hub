BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '027 requires postgres exclusively in daubert_hub_test';
  END IF;
END;
$guard$;
DO $checks$
DECLARE v_series text; v_cat text; v_function regprocedure;
BEGIN
  IF to_regclass('ops.uq_audi_recuperacion_en_curso') IS NULL
    OR to_regclass('operacion.uq_audi_artefacto_version') IS NULL
    OR to_regclass('operacion.reservas_admitidas_audi_test') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ops.acciones_recuperacion_ejecucion'::regclass
      AND tgname = 'trg_audi_accion_terminal' AND tgenabled = 'O' AND tgtype = 27)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'operacion.artefactos_ejecucion'::regclass
      AND tgname = 'trg_audi_evidencia_inmutable' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'BLOCKER: missing 027 objects';
  END IF;
  IF to_regprocedure('ops.fn_admitir_reservar_audi_test(bigint,text,integer,jsonb,bigint,bigint,uuid)') IS NULL
    OR pg_get_function_result(to_regprocedure('ops.fn_autorizar_accion_audi_test(bigint,text,text,text,bigint,text)'))
      IS DISTINCT FROM 'TABLE(outcome text, accion_id bigint, revision text, attempt_estado text, claimed boolean)' THEN
    RAISE EXCEPTION 'BLOCKER: unexpected 027 admission or authorization signature';
  END IF;
  FOREACH v_function IN ARRAY ARRAY['ops.fn_detalle_recuperacion_audi_test(bigint)',
    'ops.fn_autorizar_accion_audi_test(bigint,text,text,text,bigint,text)',
    'ops.fn_expirar_acciones_audi_test(integer)','ops.fn_fallar_despacho_accion_audi_test(bigint,text)']::regprocedure[]
  LOOP
    IF NOT has_function_privilege('daubert_hub_test_user',v_function,'EXECUTE') THEN
      RAISE EXCEPTION 'BLOCKER: missing Hub grant on %',v_function;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('ops','operacion') AND p.proname LIKE '%audi_test'
        AND p.prosecdef AND p.proowner = 'postgres'::regrole
        AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) <> 16 THEN
    RAISE EXCEPTION 'BLOCKER: incomplete or unsafe 027 function set';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE n.nspname IN ('ops','operacion') AND p.proname LIKE '%audi_test' AND x.grantee = 0)
    OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
      WHERE c.oid IN ('ops.acciones_recuperacion_ejecucion'::regclass,'operacion.artefactos_ejecucion'::regclass,
        'operacion.reservas_admitidas_audi_test'::regclass) AND x.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'BLOCKER: unexpected public function or direct table grants';
  END IF;

  SELECT md5(coalesce(string_agg(serie_id || ':' || siguiente_folio,',' ORDER BY serie_id),'')) INTO v_series
    FROM operacion.series_documentales;
  SELECT md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || pg_get_functiondef(p.oid),
    chr(10) ORDER BY p.oid::regprocedure::text),'')) INTO v_cat
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('ops','operacion') AND p.proname ~ '(caterpillar|_cat_)';
  IF v_series IS DISTINCT FROM current_setting('audi_recovery.series_md5',true)
    OR v_cat IS DISTINCT FROM current_setting('audi_recovery.cat_functions_md5',true) THEN
    RAISE EXCEPTION 'BLOCKER: precheck baselines missing or changed';
  END IF;
END;
$checks$;
SELECT 'ALL_CHECKS_PASS' AS result;
COMMIT;
