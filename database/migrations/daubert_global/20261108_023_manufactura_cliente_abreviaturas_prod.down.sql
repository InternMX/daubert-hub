-- GENERADO desde TEST 104 (20261106_104_manufactura_cliente_abreviaturas_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 023. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- DOWN · manufactura 104 · abreviaturas de cliente (SOLO PRODUCCIÓN: daubert_global). IDEMPOTENTE.
-- Elimina manufactura.cliente_abreviaturas (con sus triggers, índices y políticas) y sus funciones. No toca ninguna otra tabla, core.empresas ni core.alias_empresa; el historial de audit.cambios se conserva.
--   Sin datos:  psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_023_manufactura_cliente_abreviaturas_prod.down.sql
--   Con datos:  añadir  -v confirmar_borrado=SI_BORRAR_ABREVIATURAS_DE_PRODUCCION   (haga antes: pg_dump -t manufactura.cliente_abreviaturas -F c -f abreviaturas_antes_del_down.dump)
-- =====================================================================================================================
\set ON_ERROR_STOP on
\if :{?confirmar_borrado}
\else
  \set confirmar_borrado NO
\endif
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT set_config('manufactura104.confirmar', :'confirmar_borrado', true);
DO $$
DECLARE v_n bigint := 0;
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.cliente_abreviaturas') IS NULL THEN RAISE NOTICE 'La migración 104 no está aplicada: nada que hacer.';
  ELSE
    EXECUTE 'SELECT count(*) FROM manufactura.cliente_abreviaturas' INTO v_n;
    IF v_n > 0 AND current_setting('manufactura104.confirmar') <> 'SI_BORRAR_ABREVIATURAS_DE_PRODUCCION' THEN
      RAISE EXCEPTION 'ABORTO: hay % abreviaturas registradas. Respalde y repita con -v confirmar_borrado=SI_BORRAR_ABREVIATURAS_DE_PRODUCCION.', v_n;
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS manufactura.fn_sugerir_cliente(text, boolean);
DROP TABLE IF EXISTS manufactura.cliente_abreviaturas;
DROP FUNCTION IF EXISTS manufactura.fn_cliente_vigente(bigint);
DROP FUNCTION IF EXISTS manufactura.fn_cliente_abrev_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_cliente_abrev_before_update();
SELECT 'DOWN_OK 104 (tabla y funciones eliminadas; el resto de manufactura y el historial de auditoría intactos)' AS resultado;
COMMIT;
