-- GENERADO desde TEST 103 (20261105_103_manufactura_inventario_firmas_admin_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 022. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- DOWN · manufactura 103 · inventario administrativo de firmas (SOLO PRODUCCIÓN: daubert_global). IDEMPOTENTE; no hay datos que perder.
-- Elimina únicamente la función manufactura.fn_firmas_inventario. No toca tablas, firmas, autorizaciones, responsables ni auditoría. La API vuelve sola a la consulta limitada por RLS.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_022_manufactura_inventario_firmas_admin_prod.down.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regprocedure('manufactura.fn_firmas_inventario(bigint, boolean)') IS NULL THEN RAISE NOTICE 'La migración 103 no está aplicada: nada que hacer.'; END IF;
END $$;
DROP FUNCTION IF EXISTS manufactura.fn_firmas_inventario(bigint, boolean);
SELECT 'DOWN_OK 103 (función eliminada; tablas y datos intactos)' AS resultado;
COMMIT;
