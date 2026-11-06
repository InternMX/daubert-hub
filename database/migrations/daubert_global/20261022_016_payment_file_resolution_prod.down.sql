-- 016 PRODUCCION: reversa. Solo elimina la funcion de consulta (sin datos propios). Revertir ANTES el workflow de Pagos: si sigue llamandola, fallara.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'solo daubert_global'; END IF;
END $guard$;
DROP FUNCTION IF EXISTS core.fn_consultar_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean,boolean,integer);
COMMIT;
