-- GENERADO desde TEST 101 (20261030_101_manufactura_gestor_documental_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 012. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- DOWN · manufactura · gestor documental (SOLO PRODUCCIÓN: daubert_global)   [revisión 2: idempotente y con doble confirmación]
--
-- ALCANCE: elimina EXCLUSIVAMENTE el esquema `manufactura` (sus 5 tablas, 15 funciones, políticas, triggers e índices) y los privilegios
-- concedidos sobre él. No toca ningún otro objeto. NO borra filas de audit.cambios (el historial de auditoría se conserva).
--
-- SEGURIDAD (aborta si hay datos que perder):
--   · Con documentos/revisiones en BORRADOR/DESCARTADA o confirmaciones: exige  -v confirmar_borrado=SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO
--   · Con revisiones FINALIZADAS o PDF almacenados: exige ADEMÁS  -v confirmar_finalizadas=SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION
--   · RESPALDE ANTES:  pg_dump -h localhost -p 5432 -U postgres -d daubert_global -n manufactura -F c -f manufactura_antes_del_down.dump
--     (el DOWN imprime cuántas filas y bytes de PDF va a perder antes de borrar).
-- IDEMPOTENTE: si el esquema ya no existe, termina sin error y sin cambios (se puede reintentar tras una recuperación a medias).
-- Si ya hay revisiones FINALIZADAS con uso real, trátelo como corrección hacia adelante, no como rollback.
--
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 \
--        [-v confirmar_borrado=SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO] [-v confirmar_finalizadas=SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION] \
--        -f 20261108_012_manufactura_gestor_documental_prod.down.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\if :{?confirmar_borrado}
\else
  \set confirmar_borrado NO
\endif
\if :{?confirmar_finalizadas}
\else
  \set confirmar_finalizadas NO
\endif
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT set_config('manufactura.confirmar_borrado', :'confirmar_borrado', true),
       set_config('manufactura.confirmar_finalizadas', :'confirmar_finalizadas', true);

DO $$
DECLARE v_docs bigint; v_abiertas bigint; v_final bigint; v_pdfs bigint; v_bytes bigint; v_conf bigint;
BEGIN
  IF current_database() <> 'daubert_global' THEN
    RAISE EXCEPTION 'ABORTO: este DOWN es solo para daubert_global (base actual: %).', current_database();
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') THEN
    RAISE NOTICE 'El esquema manufactura no existe: nada que revertir (DOWN idempotente).';
    RETURN;
  END IF;
  -- Los conteos usan SQL dinámico: las tablas pueden faltar si una recuperación anterior quedó a medias.
  IF to_regclass('manufactura.documentos') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM manufactura.documentos' INTO v_docs; ELSE v_docs := 0; END IF;
  IF to_regclass('manufactura.revisiones') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FILTER (WHERE estado <> ''FINALIZADA''), count(*) FILTER (WHERE estado = ''FINALIZADA'') FROM manufactura.revisiones' INTO v_abiertas, v_final;
  ELSE v_abiertas := 0; v_final := 0; END IF;
  IF to_regclass('manufactura.pdfs') IS NOT NULL THEN EXECUTE 'SELECT count(*), COALESCE(sum(bytes), 0) FROM manufactura.pdfs' INTO v_pdfs, v_bytes; ELSE v_pdfs := 0; v_bytes := 0; END IF;
  IF to_regclass('manufactura.confirmaciones_revision') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM manufactura.confirmaciones_revision' INTO v_conf; ELSE v_conf := 0; END IF;
  RAISE NOTICE 'Se perderían: % documentos, % revisiones no finalizadas, % FINALIZADAS, % PDF (% bytes), % confirmaciones de revisión.', v_docs, v_abiertas, v_final, v_pdfs, v_bytes, v_conf;

  IF (v_docs + v_abiertas + v_final + v_pdfs + v_conf) > 0 AND current_setting('manufactura.confirmar_borrado', true) IS DISTINCT FROM 'SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO' THEN
    RAISE EXCEPTION 'ABORTO: hay datos en manufactura. Respalde con pg_dump -n manufactura y repita con -v confirmar_borrado=SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO.';
  END IF;
  IF (v_final + v_pdfs) > 0 AND current_setting('manufactura.confirmar_finalizadas', true) IS DISTINCT FROM 'SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION' THEN
    RAISE EXCEPTION 'ABORTO: hay % revisiones FINALIZADAS y % PDF. Además de confirmar_borrado, exige -v confirmar_finalizadas=SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION (y un respaldo verificado).', v_final, v_pdfs;
  END IF;
END $$;

-- La política de visibilidad de documentos consulta revisiones: se retira primero para poder eliminar revisiones sin CASCADE.
DO $$
BEGIN
  IF to_regclass('manufactura.documentos') IS NOT NULL THEN EXECUTE 'DROP POLICY IF EXISTS pol_documentos_sel ON manufactura.documentos'; END IF;
END $$;

-- Orden inverso a las dependencias; sin CASCADE (cualquier dependencia inesperada hace fallar la transacción en vez de borrarse en silencio).
DROP TABLE IF EXISTS manufactura.pdf_contenidos;
DROP TABLE IF EXISTS manufactura.pdfs;
DROP TABLE IF EXISTS manufactura.confirmaciones_revision;
DROP TABLE IF EXISTS manufactura.revisiones;
DROP TABLE IF EXISTS manufactura.documentos;
DROP FUNCTION IF EXISTS manufactura.fn_confirmaciones_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_pdf_contenidos_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_pdfs_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_revisiones_before_update();
DROP FUNCTION IF EXISTS manufactura.fn_revisiones_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_documentos_before_insert();
DROP FUNCTION IF EXISTS manufactura.fn_inmutable();
DROP FUNCTION IF EXISTS manufactura.fn_auditar_manufactura();
DROP FUNCTION IF EXISTS manufactura.fn_especificacion_valida(jsonb);
DROP FUNCTION IF EXISTS manufactura.fn_claves_validas(jsonb);
DROP FUNCTION IF EXISTS manufactura.fn_nombre_pdf(text, text, integer);
DROP FUNCTION IF EXISTS manufactura.fn_hash_revision(text, jsonb);
DROP FUNCTION IF EXISTS manufactura.fn_actor_es_admin();
DROP FUNCTION IF EXISTS manufactura.fn_actor_id();
DROP FUNCTION IF EXISTS manufactura.fn_actor();
DROP SCHEMA IF EXISTS manufactura;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') THEN RAISE EXCEPTION 'El esquema manufactura sigue existiendo (¿objetos ajenos dentro?). Revise antes de continuar.'; END IF;
END $$;

SELECT 'DOWN_OK manufactura eliminado (o ya no existía)' AS resultado;
COMMIT;
