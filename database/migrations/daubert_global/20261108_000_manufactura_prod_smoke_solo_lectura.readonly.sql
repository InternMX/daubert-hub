-- =====================================================================================================================
-- SMOKE DE SOLO LECTURA · Manufactura en PRODUCCIÓN (tras 012–016). Una transacción READ ONLY que termina en ROLLBACK. Solo daubert_global.
-- NO inserta, actualiza ni borra NADA (ni siquiera dentro de una transacción revertida): comprueba con los roles reales (SET LOCAL ROLE) que
--   · daubert_hub_app puede LEER todas las tablas (vacías, sin identidad de sesión la RLS no entrega filas) y usar las funciones previstas;
--   · n8n_app, n8n_cat_prod, daubert_docs_ro y daubert_hub_test_user reciben «permission denied» en cada tabla, y también en las funciones;
--   · daubert_hub_app NO tiene privilegios de escritura indebidos (matriz exacta en la verificación transversal).
-- Las pruebas de comportamiento con escrituras (RLS, triggers, flujos GENERAL/ADMIN) están en replica_only/ y se ejecutan solo en la réplica desechable.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -W -X -v ON_ERROR_STOP=1 -f 20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regnamespace('manufactura') IS NULL THEN RAISE EXCEPTION 'ABORTO: el esquema manufactura no existe.'; END IF;
END $$;

DO $$
DECLARE t text; v bigint; rol text; r_ok boolean; r_ok2 boolean; v_actor boolean; v_nombre boolean; filas jsonb := '[]'::jsonb;
BEGIN
  -- 1. daubert_hub_app lee todas las tablas (existentes) sin error; sin identidad no ve filas. (Los resultados se guardan en una variable porque la tabla temporal no es accesible a otros roles.)
  SET LOCAL ROLE daubert_hub_app;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'manufactura' AND c.relkind = 'r' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM manufactura.%I', t) INTO v;
    filas := filas || jsonb_build_array(jsonb_build_array('daubert_hub_app lee manufactura.' || t || ' (' || v || ' filas visibles)', v = 0));
  END LOOP;
  v_actor := manufactura.fn_actor_id() IS NULL;
  v_nombre := manufactura.fn_nombre_pdf('ABC', NULL, 1) = 'ABC_REV01.pdf';
  RESET ROLE;
  filas := filas || jsonb_build_array(jsonb_build_array('daubert_hub_app: fn_actor_id() sin identidad = NULL', v_actor), jsonb_build_array('daubert_hub_app: fn_nombre_pdf(''ABC'', NULL, 1) = ABC_REV01.pdf', v_nombre));

  -- 2. Los demás roles no pueden ni leer ni ejecutar nada de manufactura.
  FOREACH rol IN ARRAY ARRAY['n8n_app', 'n8n_cat_prod', 'daubert_docs_ro', 'daubert_hub_test_user'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol);
    r_ok := false; r_ok2 := false;
    EXECUTE format('SET LOCAL ROLE %I', rol);
    BEGIN PERFORM 1 FROM manufactura.documentos LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN r_ok := true; END;
    BEGIN PERFORM manufactura.fn_actor_id(); EXCEPTION WHEN insufficient_privilege THEN r_ok2 := true; END;
    RESET ROLE;
    filas := filas || jsonb_build_array(jsonb_build_array(rol || ': SELECT en manufactura.documentos DENEGADO', r_ok), jsonb_build_array(rol || ': EXECUTE de funciones de manufactura DENEGADO', r_ok2));
  END LOOP;
  -- 3. PUBLIC no tiene nada (se comprueba con un rol sin privilegios propios: pg_read_all_data no existe en este clúster de prueba, así que se usa el catálogo).
  filas := filas || jsonb_build_array(jsonb_build_array('PUBLIC sin USAGE en el esquema manufactura', NOT has_schema_privilege('public', 'manufactura', 'USAGE')));
  filas := filas || jsonb_build_array(jsonb_build_array('PUBLIC sin privilegios sobre las tablas de manufactura', NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a WHERE s.nspname = 'manufactura' AND a.grantee = 0)));
  filas := filas || jsonb_build_array(jsonb_build_array('PUBLIC sin EXECUTE en las funciones de manufactura', NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace, LATERAL aclexplode(p.proacl) a WHERE s.nspname = 'manufactura' AND a.grantee = 0)));
  -- 4. Escrituras indebidas: daubert_hub_app no puede borrar ni truncar donde no corresponde.
  filas := filas || jsonb_build_array(jsonb_build_array('daubert_hub_app sin DELETE/TRUNCATE en documentos, revisiones, pdfs, pdf_contenidos, confirmaciones, firmas, autorizaciones y abreviaturas',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['documentos', 'revisiones', 'pdfs', 'pdf_contenidos', 'confirmaciones_revision', 'firmas', 'firma_autorizaciones', 'cliente_abreviaturas']) tt
                 WHERE to_regclass('manufactura.' || tt) IS NOT NULL AND (has_table_privilege('daubert_hub_app', 'manufactura.' || tt, 'DELETE') OR has_table_privilege('daubert_hub_app', 'manufactura.' || tt, 'TRUNCATE')))));
  PERFORM set_config('smoke.res', filas::text, true);
END $$;

SELECT row_number() OVER () AS n, x ->> 0 AS prueba, (x ->> 1)::boolean AS ok FROM jsonb_array_elements(current_setting('smoke.res')::jsonb) x;
SELECT bool_and((x ->> 1)::boolean) AS smoke_all_pass, count(*) AS pruebas FROM jsonb_array_elements(current_setting('smoke.res')::jsonb) x;
ROLLBACK;
