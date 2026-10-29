-- =====================================================================================================================
-- DOWN · manufactura · gestor documental (SOLO TEST: daubert_hub_test)
--
-- ALCANCE: elimina EXCLUSIVAMENTE el esquema `manufactura` (sus 5 tablas, 9 funciones, triggers e índices) y los privilegios
-- concedidos sobre él. No toca ningún otro objeto. NO borra filas de audit.cambios (el historial de auditoría se conserva).
--
-- SEGURIDAD: aborta si hay datos que perder:
--   · documentos/revisiones/PDF/confirmaciones existentes → exige confirmación explícita
--       -v confirmar_borrado=SI_BORRAR_DATOS_DE_PRUEBA
--     y RECOMIENDA (ver el procedimiento) un respaldo previo:  pg_dump -n manufactura ... -F c -f manufactura_antes_del_down.dump
--   · sin datos, el DOWN procede sin confirmación.
-- Si ya hay revisiones FINALIZADAS con uso real, trátelo como corrección hacia adelante, no como rollback.
--
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
--        [-v confirmar_borrado=SI_BORRAR_DATOS_DE_PRUEBA] -f 20261030_101_manufactura_gestor_documental_test.down.sql
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
DECLARE v_datos bigint;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION 'ABORTO: este DOWN es solo para daubert_hub_test (base actual: %).', current_database();
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') THEN
    RAISE EXCEPTION 'ABORTO: el esquema manufactura no existe (nada que revertir).';
  END IF;
  SELECT (SELECT count(*) FROM manufactura.documentos) + (SELECT count(*) FROM manufactura.revisiones) + (SELECT count(*) FROM manufactura.pdfs)
       + (SELECT count(*) FROM manufactura.pdf_contenidos) + (SELECT count(*) FROM manufactura.confirmaciones_revision) INTO v_datos;
  IF v_datos > 0 AND current_setting('manufactura.confirmar_borrado', true) IS DISTINCT FROM 'SI_BORRAR_DATOS_DE_PRUEBA' THEN
    RAISE EXCEPTION 'ABORTO: hay % filas en manufactura. Respalde con pg_dump -n manufactura y repita con -v confirmar_borrado=SI_BORRAR_DATOS_DE_PRUEBA.', v_datos;
  END IF;
END $$;

-- Orden inverso a las dependencias; sin CASCADE (cualquier dependencia inesperada hace fallar la transacción en vez de borrarse en silencio).
DROP TABLE manufactura.pdf_contenidos;
DROP TABLE manufactura.pdfs;
DROP TABLE manufactura.confirmaciones_revision;
DROP TABLE manufactura.revisiones;
DROP TABLE manufactura.documentos;
DROP FUNCTION manufactura.fn_confirmaciones_before_insert();
DROP FUNCTION manufactura.fn_pdf_contenidos_before_insert();
DROP FUNCTION manufactura.fn_pdfs_before_insert();
DROP FUNCTION manufactura.fn_revisiones_before_update();
DROP FUNCTION manufactura.fn_revisiones_before_insert();
DROP FUNCTION manufactura.fn_documentos_before_insert();
DROP FUNCTION manufactura.fn_inmutable();
DROP FUNCTION manufactura.fn_hash_json(jsonb);
DROP FUNCTION manufactura.fn_actor();
DROP SCHEMA manufactura;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') THEN RAISE EXCEPTION 'El esquema manufactura sigue existiendo.'; END IF;
END $$;

SELECT 'DOWN_OK manufactura eliminado' AS resultado;
COMMIT;
