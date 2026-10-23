-- MANUAL ONLY. Conservative refusal after any snapshot-backed Caterpillar execution.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF current_database()<>'daubert_global' OR current_user<>'postgres' THEN RAISE EXCEPTION '016 production rollback only'; END IF;
END $guard$;
SELECT pg_advisory_xact_lock(hashtextextended('CAT_ATOMIC_SCHEMA_015',0));
LOCK TABLE ops.ejecuciones_automatizacion IN SHARE ROW EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE a.codigo='REMISIONES_CATERPILLAR' AND d.caterpillar_admission IS NOT NULL) THEN
    RAISE EXCEPTION '016 claimed execution evidence exists; rollback refused'; END IF;
END $empty$;
DO $known$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('ops.fn_cat_key_text_015(text)','23968d76b373557d6dcf211fc69d92a0'),
    ('ops.fn_cat_snapshot_015(bigint,text,jsonb)','3a0d74e788c628bf6d8dd909abdcb172'),
    ('ops.fn_cat_worker_015(bigint,text)','c31231a468afab425b37d6b9176ea04d'),
    ('ops.fn_admitir_reservar_caterpillar(bigint,text,text,integer)','71db3261c8aafc7b050238c50f76b800'),
    ('ops.fn_reprocesar_reservar_caterpillar(bigint,text,text,integer)','08e824748e8f29446cb3db9a06614359'),
    ('ops.fn_guardar_snapshot_caterpillar(bigint,text)','81f1e930d6c527fa1e95372d79320bc7'),
    ('operacion.fn_registrar_remision_caterpillar(bigint,text,text,bigint,date,text,jsonb)','10f24f8a090a4b3246e708018ec9a432'),
    ('ops.fn_finalizar_caterpillar(bigint,text,text,text,text)','997d8d733d6849636cab0f282c1ef944'),
    ('ops.fn_fallo_caterpillar(bigint,text,text,text)','ea0fc6d1dee94b2eb8631c9453c514ef')
  ) expected(signature,body_hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND pg_get_userbyid(proowner)='postgres'
      AND md5(replace(prosrc,chr(13),''))=f.body_hash) THEN RAISE EXCEPTION '016 rollback refuses definition drift'; END IF;
  END LOOP;
END $known$;
DROP FUNCTION ops.fn_fallo_caterpillar(bigint,text,text,text);
DROP FUNCTION ops.fn_finalizar_caterpillar(bigint,text,text,text,text);
DROP FUNCTION operacion.fn_registrar_remision_caterpillar(bigint,text,text,bigint,date,text,jsonb);
DROP FUNCTION ops.fn_guardar_snapshot_caterpillar(bigint,text);
DROP FUNCTION ops.fn_reprocesar_reservar_caterpillar(bigint,text,text,integer);
DROP FUNCTION ops.fn_admitir_reservar_caterpillar(bigint,text,text,integer);
DROP FUNCTION ops.fn_cat_worker_015(bigint,text);
DROP FUNCTION ops.fn_cat_snapshot_015(bigint,text,jsonb);
DROP FUNCTION ops.fn_cat_key_text_015(text);
-- The dedicated role never held legacy EXECUTE: nothing to restore. The legacy functions are untouched.
LOCK TABLE core.documentos IN ACCESS EXCLUSIVE MODE;
DO $snapshots$
BEGIN
  IF EXISTS(SELECT 1 FROM core.documentos WHERE caterpillar_admission IS NOT NULL) THEN RAISE EXCEPTION '016 snapshots exist; rollback refused'; END IF;
END $snapshots$;
ALTER TABLE core.documentos DROP COLUMN caterpillar_admission;
COMMIT;
