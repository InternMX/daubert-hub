\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE v_function text; v_oid oid;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '019 requires daubert_global'; END IF;
  IF to_regclass('core.recuperaciones_notificacion_pago') IS NULL THEN RAISE EXCEPTION '019 missing'; END IF;
  FOREACH v_function IN ARRAY ARRAY['core.fn_iniciar_recuperacion_pago(bigint,text)',
    'core.fn_observar_archivos_pago_sin_efectos(bigint,text,jsonb)', 'core.fn_finalizar_recuperacion_pago(bigint,text)',
    'core.fn_destino_asignacion_pago_disponible(bigint,bigint)'] LOOP
    v_oid := to_regprocedure(v_function);
    IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND prosecdef
      AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=pg_catalog, core']) THEN
      RAISE EXCEPTION 'Unsafe/missing function %', v_function;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=v_oid AND (a.grantee=0 OR (a.grantee<>p.proowner AND
        (a.is_grantable OR pg_get_userbyid(a.grantee) <> CASE WHEN v_function LIKE '%fn_destino_%' THEN 'daubert_hub_app' ELSE 'n8n_app' END)))) THEN
      RAISE EXCEPTION 'Unexpected function privilege %', v_function;
    END IF;
    IF NOT has_function_privilege(CASE WHEN v_function LIKE '%fn_destino_%' THEN 'daubert_hub_app' ELSE 'n8n_app' END, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Missing intended permission %', v_function;
    END IF;
  END LOOP;
  IF has_table_privilege('n8n_app','core.recuperaciones_notificacion_pago','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('daubert_hub_app','core.recuperaciones_notificacion_pago','INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('daubert_hub_app','core.recuperaciones_notificacion_pago','SELECT') THEN
    RAISE EXCEPTION 'Unsafe run table access';
  END IF;
END $check$;
SELECT current_database(), '019 function boundaries verified' AS result;
-- Compare these with the pre-deploy evidence; installation must not rehabilitate historical rows.
SELECT archivo_id,correo_id,estado_identidad,estado_operativo,sin_efectos_ejecucion
FROM core.archivos_notificacion_pago WHERE archivo_id=3 AND correo_id=44;
SELECT estado,count(*) FROM core.recuperaciones_notificacion_pago GROUP BY estado;
ROLLBACK;
