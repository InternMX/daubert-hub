-- GENERADO por tools/generar-manufactura-026.cjs — migración PRODUCTIVA 026 (UP). NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- UP · manufactura 026 · POLÍTICAS DE LECTURA PARA EL ROL DE RESPALDOS (SOLO PRODUCCIÓN: daubert_global)
--
-- PROBLEMA: daubert_backup lee manufactura por pertenencia a pg_read_all_data, pero esa pertenencia NO salta RLS y daubert_backup no tiene BYPASSRLS (política del proyecto, postcheck 013 de Caterpillar).
--   Las políticas de manufactura son TO daubert_hub_app, así que pg_dump como daubert_backup FALLA («query would be affected by row-level security policy») y, con --enable-row-security y sin política,
--   volcaría las tablas VACÍAS sin error.
-- SOLUCIÓN (UNA transacción): una política PERMISSIVE FOR SELECT TO daubert_backup USING (true) en cada una de las 9 tablas con RLS de manufactura (pol_respaldo_sel). El respaldo debe ejecutarse con
--   pg_dump --enable-row-security (scripts/backup/lib/BackupPgTools.psm1; ver docs/hub/manufactura-ensayo-6b-resultados.md).
-- NO HACE: no concede escritura ni ningún privilegio de tabla (solo cambia qué filas ve el rol que YA podía leer); no cambia roles, membresías ni atributos (sin BYPASSRLS, SUPERUSER, pg_write_all_data);
--   no modifica ni elimina políticas de daubert_hub_app; no deshabilita RLS; no toca datos, funciones, triggers ni objetos fuera de manufactura (Caterpillar, Audi, Pagos intactos).
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261109_026_manufactura_respaldo_rls_prod.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  v_tablas text[] := ARRAY['cliente_abreviaturas', 'confirmaciones_revision', 'documentos', 'firma_autorizaciones', 'firmas', 'pdf_contenidos', 'pdfs', 'revision_responsables', 'revisiones'];
  t text;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_backup') THEN RAISE EXCEPTION 'ABORTO: no existe el rol daubert_backup.'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pol_respaldo_sel') THEN RAISE EXCEPTION 'ABORTO: la 026 ya existe (pol_respaldo_sel); no se reaplica.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) <> 9 OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') <> 24 THEN
    RAISE EXCEPTION 'ABORTO: la 026 exige las migraciones 020-024 aplicadas (9 tablas con RLS y 24 políticas).';
  END IF;
  IF NOT (
COALESCE((SELECT bool_and(
        b.rolcanlogin AND b.rolinherit AND NOT b.rolsuper AND NOT b.rolcreaterole AND NOT b.rolcreatedb AND NOT b.rolreplication AND NOT b.rolbypassrls
        AND pg_has_role(b.oid, 'pg_read_all_data', 'USAGE')
        AND NOT EXISTS (SELECT 1 FROM pg_roles o WHERE o.oid <> b.oid AND o.rolname <> 'pg_read_all_data' AND (pg_has_role(b.oid, o.oid, 'MEMBER') OR pg_has_role(b.oid, o.oid, 'USAGE') OR pg_has_role(b.oid, o.oid, 'SET')))
        AND has_schema_privilege(b.oid, 'manufactura', 'USAGE') AND NOT has_schema_privilege(b.oid, 'manufactura', 'CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'manufactura'::regnamespace AND (
              (c.relkind IN ('r', 'p') AND (NOT has_table_privilege(b.oid, c.oid, 'SELECT') OR has_table_privilege(b.oid, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                                           OR has_any_column_privilege(b.oid, c.oid, 'INSERT,UPDATE,REFERENCES')))
           OR (c.relkind = 'S' AND has_sequence_privilege(b.oid, c.oid, 'USAGE,UPDATE'))))
        AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'manufactura'::regnamespace AND p.prorettype <> 'trigger'::regtype AND has_function_privilege(b.oid, p.oid, 'EXECUTE'))
        AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'manufactura'::regnamespace AND a.grantee = b.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname = 'manufactura' AND a.grantee = b.oid)
      ) FROM pg_roles b WHERE b.rolname = 'daubert_backup'), true)
  ) THEN RAISE EXCEPTION 'ABORTO: daubert_backup no cumple el perfil de lector de solo lectura (sin escritura, administración, BYPASSRLS ni membresías extra).'; END IF;

  FOREACH t IN ARRAY v_tablas LOOP
    EXECUTE format('CREATE POLICY pol_respaldo_sel ON manufactura.%I AS PERMISSIVE FOR SELECT TO daubert_backup USING (true)', t);
    EXECUTE format('COMMENT ON POLICY pol_respaldo_sel ON manufactura.%I IS %L', t, '026: lectura completa para el rol de respaldos daubert_backup (pg_dump --enable-row-security). Solo SELECT; no concede escritura. Las políticas de daubert_hub_app no cambian.');
  END LOOP;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel' AND cmd = 'SELECT' AND roles = ARRAY['daubert_backup']::name[] AND permissive = 'PERMISSIVE' AND qual = 'true' AND with_check IS NULL) <> 9 THEN
    RAISE EXCEPTION 'Las políticas de respaldo no quedaron como se esperaba.';
  END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) <> 0 THEN RAISE EXCEPTION 'Toda tabla de manufactura debe conservar RLS.'; END IF;
END $$;

SELECT 'UP_OK manufactura 026 (9 políticas SELECT para daubert_backup; sin cambios en privilegios, roles, políticas de la aplicación ni datos)' AS resultado;
COMMIT;
