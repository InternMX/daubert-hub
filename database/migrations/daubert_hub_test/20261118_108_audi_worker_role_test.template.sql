-- TEMPLATE, NOT APPLIED. Use after 108 as postgres in daubert_hub_test.
-- Supply the existing, approved Audi TEST credential role with -v worker_role=<role>.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Audi worker role template requires postgres in daubert_hub_test';
  END IF;
END;
$guard$;

GRANT USAGE ON SCHEMA ops, operacion TO :"worker_role";
GRANT EXECUTE ON FUNCTION
  ops.fn_admitir_reservar_audi_test(bigint,text,integer,jsonb,bigint,bigint,uuid),
  ops.fn_reclamar_accion_audi_test(bigint,text),
  ops.fn_latido_accion_audi_test(bigint,text,uuid),
  operacion.fn_registrar_artefacto_audi_test(bigint,text,bigint,uuid,text,bigint,text,bigint,text,text),
  ops.fn_finalizar_audi_test(bigint,text,bigint,uuid),
  ops.fn_cerrar_accion_audi_test(bigint,text,uuid,text,text),
  ops.fn_completar_cancelacion_audi_test(bigint,text,uuid,boolean,jsonb)
TO :"worker_role";

SELECT p.oid::regprocedure AS audi_function,
  has_function_privilege(:'worker_role',p.oid,'EXECUTE') AS can_execute,
  has_schema_privilege(:'worker_role',n.oid,'USAGE') AS has_schema_usage
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('ops','operacion') AND p.proname LIKE '%audi_test'
ORDER BY n.nspname,p.proname;

SELECT c.oid::regclass AS relation
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('core','ops','operacion') AND c.relkind IN ('r','p','v','m','f')
  AND has_table_privilege(:'worker_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
ORDER BY n.nspname,c.relname;
COMMIT;
