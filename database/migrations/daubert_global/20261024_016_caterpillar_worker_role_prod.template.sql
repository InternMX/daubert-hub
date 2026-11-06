-- TEMPLATE, NOT APPLIED. Run ONCE as postgres connected to daubert_global, BEFORE the 016 precheck, with psql:
--   psql -h <host> -U postgres -d daubert_global -v ON_ERROR_STOP=1 -v worker_password="$CAT_WORKER_PASSWORD" -f <this file>
-- The password is supplied by the operator through a psql variable; it is never stored in the repository, a workflow, or a log.
--
-- WHY A NEW ROLE: the Caterpillar workflow currently shares n8n_app with Audi. Migration 016 closes the legacy bypass for the Caterpillar worker by
-- guaranteeing that its role holds NO EXECUTE on the five legacy functions. That cannot be done on n8n_app without breaking Audi, so Caterpillar gets
-- its own login (and its own n8n credential). n8n_app is not modified in any way.
-- The role has: no table privileges, no schema CREATE, schema USAGE only, EXECUTE on the two read-only resolvers the workflow still calls, and later
-- (by migration 016) EXECUTE on the six protected entries. Connection limit 5, as in the validated TEST role.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'worker role template requires postgres in daubert_global'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_cat_prod') THEN RAISE EXCEPTION 'n8n_cat_prod already exists; review instead of recreating'; END IF;
  IF to_regprocedure('core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)') IS NULL
     OR to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)') IS NULL THEN RAISE EXCEPTION 'resolver functions missing; apply earlier migrations first'; END IF;
END $guard$;
CREATE ROLE n8n_cat_prod LOGIN PASSWORD :'worker_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 5;
GRANT USAGE ON SCHEMA core, ops, operacion TO n8n_cat_prod;
GRANT EXECUTE ON FUNCTION core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text),
  ops.fn_resolver_ejecucion_para_reproceso(bigint) TO n8n_cat_prod;
-- Effective-privilege proof: no legacy EXECUTE (direct, PUBLIC or membership), no DML on the protected tables.
DO $proof$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
    'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'] LOOP
    IF to_regprocedure(s) IS NOT NULL AND has_function_privilege('n8n_cat_prod', to_regprocedure(s), 'EXECUTE') THEN
      RAISE EXCEPTION 'n8n_cat_prod can execute legacy % (PUBLIC or default privilege); revoke it from the source before continuing', s; END IF;
  END LOOP;
  FOREACH s IN ARRAY ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones','operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales'] LOOP
    IF has_table_privilege('n8n_cat_prod', s, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') THEN RAISE EXCEPTION 'n8n_cat_prod holds table privileges on % (default privileges?)', s; END IF;
  END LOOP;
END $proof$;
COMMIT;
