BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '108 requires postgres exclusively in daubert_hub_test';
  END IF;
END;
$guard$;
DO $objects$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['ops.ejecuciones_automatizacion','ops.automatizaciones',
    'core.documentos','security.users','operacion.remisiones','operacion.remision_detalle',
    'operacion.reservas_folios','operacion.series_documentales','ops.automatizacion_series_proceso',
    'ops.uq_ejecuciones_automatizacion_reproceso_unico']
  LOOP
    IF to_regclass(v_name) IS NULL THEN RAISE EXCEPTION 'BLOCKER: missing %',v_name; END IF;
  END LOOP;
  IF to_regprocedure('operacion.reservar_folios_para_ejecucion(bigint,text,integer)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_test_user') THEN
    RAISE EXCEPTION 'BLOCKER: missing shared allocator or Hub TEST role';
  END IF;
  IF to_regclass('ops.acciones_recuperacion_ejecucion') IS NOT NULL
    OR to_regclass('operacion.artefactos_ejecucion') IS NOT NULL
    OR to_regclass('operacion.reservas_admitidas_audi_test') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('ops','operacion') AND p.proname LIKE '%audi_test') THEN
    RAISE EXCEPTION 'BLOCKER: existing 108 objects or Audi TEST functions require review';
  END IF;
END;
$objects$;

SELECT coalesce(pg_get_functiondef(to_regprocedure('operacion.reservar_folios(text,integer)'))
  ~* 'FOR[[:space:]]+UPDATE',false) AS legacy_has_for_update;
SELECT 'BLOCKER: R2 confirm the series row lock and approve a single workflow version at cutover' AS result;

SELECT rolname AS candidate_worker_role FROM pg_roles
  WHERE rolcanlogin AND rolname ~* '(n8n|audi)'
  ORDER BY rolname;
SELECT 'BLOCKER: R3 confirm the Audi TEST credential role in n8n and approve its grants' AS result;

SELECT CASE WHEN count(*) = 1 THEN 'BLOCKER: R4 one active Audi route found; confirm and approve it'
  ELSE 'BLOCKER: R4 expected exactly one active REMISION_AUDI route for REMISIONES_AUDI' END AS result
FROM ops.automatizacion_series_proceso rt JOIN ops.automatizaciones a USING (automatizacion_id)
  JOIN operacion.series_documentales s USING (serie_id)
WHERE a.codigo = 'REMISIONES_AUDI' AND s.codigo = 'REMISION_AUDI'
  AND rt.estatus = 'ACTIVA' AND s.estatus = 'ACTIVA';

-- Show effective trigger definitions and flag functions with reservation-abandonment logic for review.
SELECT t.tgrelid::regclass AS relation, pg_get_triggerdef(t.oid) AS trigger_definition,
  t.tgfoid::regprocedure AS trigger_function
FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
  ('ops.ejecuciones_automatizacion'::regclass,'operacion.reservas_folios'::regclass);
SELECT p.oid::regprocedure AS candidate_abandonment_function,
  'BLOCKER: review whether the function can abandon Audi reservations on ERROR' AS result
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('ops','operacion') AND p.prosrc ~* 'reservas_folios'
  AND p.prosrc ~* 'ABANDONADA' AND p.prosrc ~* 'ERROR';

SELECT md5(coalesce(string_agg(serie_id || ':' || siguiente_folio,',' ORDER BY serie_id),'')) AS series_md5
  FROM operacion.series_documentales;
SELECT md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || pg_get_functiondef(p.oid),
  chr(10) ORDER BY p.oid::regprocedure::text),'')) AS cat_functions_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('ops','operacion') AND p.proname ~ '(caterpillar|_cat_)';
COMMIT;
