-- =====================================================================================================================
-- DOWN · manufactura 106 · «Generó» opcional (SOLO TEST: daubert_hub_test). IDEMPOTENTE. No toca datos.
-- Restaura la restricción de coherencia con la redacción de la 101. Si ya existen revisiones FINALIZADAS sin nombre de «Generó» (permitidas por la 106), ABORTA:
-- esas revisiones son inmutables y la restricción de la 101 no podría validarse; no se modifica ningún dato.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261111_106_manufactura_genero_opcional_test.down.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE v_n bigint;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE estado = 'FINALIZADA' AND (elaboro_nombre IS NULL OR NOT elaboro_confirmado);
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORTO: hay % revisiones FINALIZADAS sin nombre de «Generó»; la restricción de la 101 no puede restaurarse sin alterar revisiones inmutables.', v_n; END IF;
END $$;
ALTER TABLE manufactura.revisiones DROP CONSTRAINT IF EXISTS ck_manufactura_revisiones_coherencia;
ALTER TABLE manufactura.revisiones ADD CONSTRAINT ck_manufactura_revisiones_coherencia CHECK (
  CASE estado
    WHEN 'BORRADOR'    THEN revision IS NULL AND revision_prevista IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL AND finalizado_por_usuario_id IS NULL
    WHEN 'FINALIZANDO' THEN revision IS NULL AND revision_prevista IS NOT NULL AND finalizando_token IS NOT NULL AND finalizando_desde IS NOT NULL AND finalizando_por_usuario_id IS NOT NULL AND finalizado_en IS NULL
    WHEN 'FINALIZADA'  THEN revision IS NOT NULL AND revision = revision_prevista AND finalizando_token IS NULL AND finalizado_en IS NOT NULL AND finalizado_por_usuario_id IS NOT NULL AND finalizado_por_email IS NOT NULL
                            AND cliente_nombre IS NOT NULL AND elaboro_nombre IS NOT NULL AND elaboro_confirmado
    WHEN 'DESCARTADA'  THEN revision IS NULL AND revision_prevista IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL
    ELSE false
  END
);
SELECT 'DOWN_OK 106 (restricción de coherencia restaurada a la 101; datos intactos)' AS resultado;
COMMIT;
