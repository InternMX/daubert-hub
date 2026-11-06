-- REVIEW ONLY. Never remove a cancellation ledger containing historical evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() NOT IN ('daubert_hub_test', 'daubert_global') OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '013 rollback requires postgres in an allowed database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('operacion.cancelaciones_remisiones')
    AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres') THEN
    RAISE EXCEPTION '013 rollback refuses unknown ledger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=
    to_regprocedure('operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)')
    AND md5(replace(p.prosrc,chr(13),''))='f99511429b1ba54c89750259b2c6aaed' AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres') THEN
    RAISE EXCEPTION '013 rollback refuses unknown function definition';
  END IF;
END $guard$;
SELECT pg_advisory_xact_lock(hashtextextended('CAT_CANCEL_SCHEMA_013',0));
-- Block concurrent calls before checking that rollback is safe.
LOCK TABLE operacion.cancelaciones_remisiones IN ACCESS EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM operacion.cancelaciones_remisiones) THEN
    RAISE EXCEPTION 'Cancellation history exists; rollback refused';
  END IF;
END $empty$;
DROP FUNCTION operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text);
DROP TABLE operacion.cancelaciones_remisiones;
COMMIT;
