-- MANUAL ONLY. Conservative refusal after any snapshot-backed Caterpillar execution.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF current_database()<>'daubert_hub_test' OR current_user<>'postgres' THEN RAISE EXCEPTION '015 TEST rollback only'; END IF;
END $guard$;
SELECT pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
LOCK TABLE ops.ejecuciones_automatizacion IN SHARE ROW EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE a.codigo='REMISIONES_CATERPILLAR' AND d.caterpillar_admission IS NOT NULL) THEN
    RAISE EXCEPTION '015 claimed execution evidence exists; rollback refused'; END IF;
END $empty$;
DO $known$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('ops.fn_cat_key_text_015(text)','23968d76b373557d6dcf211fc69d92a0'),
    ('ops.fn_cat_snapshot_015(bigint,text,jsonb)','3a0d74e788c628bf6d8dd909abdcb172'),
    ('ops.fn_cat_worker_015(bigint,text)','e7ddda86d018f3e9dbef74c97745897f'),
    ('ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer)','a3e178b623dd1a931dc3ce05785967b3'),
    ('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)','da2088a4bb82bffb90ccd632d6108dde'),
    ('ops.fn_guardar_snapshot_caterpillar_test(bigint,text)','e8a39d9e2d9b64e40cc42f9fd9e979d0'),
    ('operacion.fn_registrar_remision_caterpillar_test(bigint,text,text,bigint,date,text,jsonb)','10f24f8a090a4b3246e708018ec9a432'),
    ('ops.fn_finalizar_caterpillar_test(bigint,text,text,text,text)','997d8d733d6849636cab0f282c1ef944'),
    ('ops.fn_fallo_caterpillar_test(bigint,text,text,text)','ea0fc6d1dee94b2eb8631c9453c514ef')
  ) expected(signature,body_hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND pg_get_userbyid(proowner)='postgres'
      AND md5(replace(prosrc,chr(13),''))=f.body_hash) THEN RAISE EXCEPTION '015 rollback refuses definition drift'; END IF;
  END LOOP;
END $known$;
DROP FUNCTION ops.fn_fallo_caterpillar_test(bigint,text,text,text);
DROP FUNCTION ops.fn_finalizar_caterpillar_test(bigint,text,text,text,text);
DROP FUNCTION operacion.fn_registrar_remision_caterpillar_test(bigint,text,text,bigint,date,text,jsonb);
DROP FUNCTION ops.fn_guardar_snapshot_caterpillar_test(bigint,text);
DROP FUNCTION ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer);
DROP FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer);
DROP FUNCTION ops.fn_cat_worker_015(bigint,text);
DROP FUNCTION ops.fn_cat_snapshot_015(bigint,text,jsonb);
DROP FUNCTION ops.fn_cat_key_text_015(text);
GRANT EXECUTE ON FUNCTION ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint),
  operacion.reservar_folios_para_ejecucion(bigint,text,integer),operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb),
  ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text),ops.fn_registrar_fallo_ejecucion(bigint,text,text,text) TO n8n_cat_test;
COMMIT;
