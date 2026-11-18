-- GENERADO desde TEST 105 (20261107_105_manufactura_consulta_compartida_borradores_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 024. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- DOWN · manufactura 105 · consulta compartida de borradores (SOLO PRODUCCIÓN: daubert_global). IDEMPOTENTE. No toca datos.
-- Restaura las 3 políticas de lectura con su redacción de la migración 101.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_024_manufactura_consulta_compartida_borradores_prod.down.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
END $$;
ALTER POLICY pol_revisiones_sel ON manufactura.revisiones
  USING (estado = 'FINALIZADA' OR creado_por_usuario_id = manufactura.fn_actor_id() OR revisor_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin());
ALTER POLICY pol_pdfs_sel ON manufactura.pdfs USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = pdfs.revision_id));
ALTER POLICY pol_pdf_contenidos_sel ON manufactura.pdf_contenidos USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = pdf_contenidos.revision_id));
COMMENT ON POLICY pol_revisiones_sel ON manufactura.revisiones IS NULL;
COMMENT ON POLICY pol_pdfs_sel ON manufactura.pdfs IS NULL;
COMMENT ON POLICY pol_pdf_contenidos_sel ON manufactura.pdf_contenidos IS NULL;
SELECT 'DOWN_OK 105 (políticas de lectura restauradas a la 101; datos intactos)' AS resultado;
COMMIT;
