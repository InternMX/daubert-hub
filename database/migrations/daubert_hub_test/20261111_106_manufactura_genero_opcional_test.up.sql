-- =====================================================================================================================
-- UP · manufactura · «GENERÓ» OPCIONAL AL FINALIZAR (SOLO TEST: daubert_hub_test)   [migración 106, adicional a la 101–105]
--
-- PROPÓSITO: que una hoja pueda finalizarse sin ningún responsable (ni nombre ni firma en Generó, Revisó o Aprobó). Las imágenes de firma ya eran opcionales; lo único que
-- lo impedía era la restricción de coherencia de la 101, que exigía «elaboro_nombre IS NOT NULL AND elaboro_confirmado» en el estado FINALIZADA.
--
-- ALCANCE (UNA transacción; si algo falla no queda nada). SOLO reemplaza la restricción manufactura.revisiones · ck_manufactura_revisiones_coherencia:
--   ANTES (101): FINALIZADA exige … AND cliente_nombre IS NOT NULL AND elaboro_nombre IS NOT NULL AND elaboro_confirmado
--   AHORA      : FINALIZADA exige … AND cliente_nombre IS NOT NULL AND (elaboro_nombre IS NULL OR elaboro_confirmado)
--   · Si hay nombre de «Generó», sigue teniendo que estar confirmado (la API lo confirma al finalizar). El cliente sigue siendo obligatorio.
--   · El resto de los estados (BORRADOR, FINALIZANDO, DESCARTADA) queda con la misma redacción.
--   · Es la misma redacción que la 020 de PROD (daubert_global), que se corrigió antes de aplicarse.
--   · NO toca datos, columnas, triggers (inmutabilidad de FINALIZADA incluida), políticas RLS, privilegios, funciones ni auditoría. Las filas existentes cumplen la regla nueva (es más permisiva).
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_test_user):
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261111_106_manufactura_genero_opcional_test.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.revisiones') IS NULL THEN RAISE EXCEPTION 'ABORTO: falta la migración 101.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia' AND conrelid = 'manufactura.revisiones'::regclass) THEN RAISE EXCEPTION 'ABORTO: no existe ck_manufactura_revisiones_coherencia.'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia' AND obj_description(oid, 'pg_constraint') LIKE '106:%') THEN RAISE EXCEPTION 'ABORTO: la migración 106 ya está aplicada (no se reaplica).'; END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'ck_manufactura_revisiones_coherencia' AND conrelid = 'manufactura.revisiones'::regclass)) NOT LIKE '%elaboro_nombre IS NOT NULL) AND elaboro_confirmado%' THEN
    RAISE EXCEPTION 'ABORTO: la restricción de coherencia no tiene la forma de la 101.';
  END IF;
END $$;

ALTER TABLE manufactura.revisiones DROP CONSTRAINT ck_manufactura_revisiones_coherencia;
ALTER TABLE manufactura.revisiones ADD CONSTRAINT ck_manufactura_revisiones_coherencia CHECK (
  CASE estado
    WHEN 'BORRADOR'    THEN revision IS NULL AND revision_prevista IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL AND finalizado_por_usuario_id IS NULL
    WHEN 'FINALIZANDO' THEN revision IS NULL AND revision_prevista IS NOT NULL AND finalizando_token IS NOT NULL AND finalizando_desde IS NOT NULL AND finalizando_por_usuario_id IS NOT NULL AND finalizado_en IS NULL
    WHEN 'FINALIZADA'  THEN revision IS NOT NULL AND revision = revision_prevista AND finalizando_token IS NULL AND finalizado_en IS NOT NULL AND finalizado_por_usuario_id IS NOT NULL AND finalizado_por_email IS NOT NULL
                            AND cliente_nombre IS NOT NULL AND (elaboro_nombre IS NULL OR elaboro_confirmado)
    WHEN 'DESCARTADA'  THEN revision IS NULL AND revision_prevista IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL
    ELSE false
  END
);
COMMENT ON CONSTRAINT ck_manufactura_revisiones_coherencia ON manufactura.revisiones IS '106: «Generó» opcional al finalizar; si hay nombre, confirmado. Cliente obligatorio.';

SELECT 'UP_OK manufactura 106 (restricción de coherencia: «Generó» opcional; sin cambios en datos, triggers, políticas ni privilegios)' AS resultado;
COMMIT;
