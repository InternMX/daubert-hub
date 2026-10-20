-- 013 (TEST ONLY): reversa. Solo elimina la funcion (no hay datos asociados).
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'solo daubert_hub_test'; END IF;
END $guard$;
DROP FUNCTION IF EXISTS core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer);
COMMIT;
