-- GENERADO por tools/generar-manufactura-026.cjs — migración PRODUCTIVA 026 (DOWN). NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- DOWN · manufactura 026 · respaldo con RLS (SOLO PRODUCCIÓN: daubert_global). IDEMPOTENTE. No toca datos, roles ni otras políticas.
-- Elimina únicamente pol_respaldo_sel. Tras el DOWN, pg_dump como daubert_backup vuelve a fallar con manufactura (ver el UP).
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261109_026_manufactura_respaldo_rls_prod.down.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE t text;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel' LOOP
    EXECUTE format('DROP POLICY pol_respaldo_sel ON manufactura.%I', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pol_respaldo_sel') THEN RAISE EXCEPTION 'No se eliminaron todas las políticas de respaldo.'; END IF;
END $$;
SELECT 'DOWN_OK 026 (políticas de respaldo eliminadas; datos, roles y políticas de la aplicación intactos)' AS resultado;
COMMIT;
