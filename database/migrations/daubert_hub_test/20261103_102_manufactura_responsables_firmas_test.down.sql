-- =====================================================================================================================
-- DOWN · manufactura 102 · responsables y firmas (SOLO TEST: daubert_hub_test). IDEMPOTENTE y con confirmación si hay datos.
-- Elimina SOLO las 3 tablas nuevas, sus funciones y triggers. No toca las 5 tablas de la 101 ni la auditoría ya escrita.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 [-v confirmar_borrado=SI_BORRAR_FIRMAS_Y_RESPONSABLES] -f 20261103_102_manufactura_responsables_firmas_test.down.sql
-- RESPALDE ANTES si hay datos:  pg_dump -h localhost -p 5432 -U postgres -d daubert_hub_test -n manufactura -F c -f manufactura_antes_del_down102.dump
-- Con revisiones FINALIZADAS que usaron responsables/firmas el DOWN pierde esa constancia: trátelo como corrección hacia adelante, no como rollback.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\if :{?confirmar_borrado}
\else
  \set confirmar_borrado NO
\endif
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT set_config('manufactura.confirmar_borrado', :'confirmar_borrado', true);
DO $$
DECLARE v_f bigint := 0; v_a bigint := 0; v_r bigint := 0;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.firmas') IS NULL AND to_regclass('manufactura.revision_responsables') IS NULL AND to_regclass('manufactura.firma_autorizaciones') IS NULL THEN
    RAISE NOTICE 'La migración 102 no está aplicada: nada que hacer.'; RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM manufactura.firmas' INTO v_f;
  EXECUTE 'SELECT count(*) FROM manufactura.firma_autorizaciones' INTO v_a;
  EXECUTE 'SELECT count(*) FROM manufactura.revision_responsables' INTO v_r;
  RAISE NOTICE 'Se eliminarán: % firmas, % autorizaciones, % responsables.', v_f, v_a, v_r;
  IF v_f + v_a + v_r > 0 AND current_setting('manufactura.confirmar_borrado') <> 'SI_BORRAR_FIRMAS_Y_RESPONSABLES' THEN
    RAISE EXCEPTION 'ABORTO: hay datos. Respalde y repita con -v confirmar_borrado=SI_BORRAR_FIRMAS_Y_RESPONSABLES.';
  END IF;
END $$;
DROP TABLE IF EXISTS manufactura.revision_responsables;
DROP TABLE IF EXISTS manufactura.firma_autorizaciones;
DROP TABLE IF EXISTS manufactura.firmas;
DROP FUNCTION IF EXISTS manufactura.fn_responsables_guardia();
DROP FUNCTION IF EXISTS manufactura.fn_firma_aut_before_update();
DROP FUNCTION IF EXISTS manufactura.fn_firma_aut_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_firmas_before_update();
DROP FUNCTION IF EXISTS manufactura.fn_firmas_after_insert();
DROP FUNCTION IF EXISTS manufactura.fn_firmas_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_firma_utilizable(bigint, bigint);
DROP FUNCTION IF EXISTS manufactura.fn_firma_autorizada_a(bigint, bigint);
DROP FUNCTION IF EXISTS manufactura.fn_firma_propietario(bigint);
SELECT 'DOWN_OK 102 (firmas, autorizaciones y responsables eliminados; las 5 tablas de la 101 intactas)' AS resultado;
COMMIT;
