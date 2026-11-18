-- GENERADO desde TEST 105 (20261107_105_manufactura_consulta_compartida_borradores_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 024. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- UP · manufactura · CONSULTA COMPARTIDA DE BORRADORES (SOLO PRODUCCIÓN: daubert_global)   [migración 105, adicional a la 101–104]
--
-- PROPÓSITO: que cualquier cuenta con identidad de sesión pueda CONSULTAR (solo lectura) los borradores y las finalizaciones en curso de otras cuentas.
--
-- ALCANCE (UNA transacción; si algo falla no queda nada). SOLO redefine 3 políticas de LECTURA (ALTER POLICY, sin recrear tablas):
--   1. manufactura.revisiones · pol_revisiones_sel
--        ANTES : FINALIZADA, o creador, o revisor asignado, o ADMIN.
--        AHORA : FINALIZADA (igual que antes) · BORRADOR y FINALIZANDO con identidad de sesión válida (nuevo) · cualquier estado para creador, revisor asignado y ADMIN (igual que antes).
--                DESCARTADA sigue visible solo para creador, revisor asignado y ADMIN. Sin identidad de sesión no se ve ningún borrador.
--   2. manufactura.pdfs · pol_pdfs_sel   y   3. manufactura.pdf_contenidos · pol_pdf_contenidos_sel
--        Antes dependían de «la revisión es visible». Como ahora lo son más revisiones, se añade la condición que CONSERVA su exposición exacta: el PDF (y sus bytes) de una revisión NO finalizada
--        (p. ej. una finalización en curso) sigue visible solo para creador, revisor asignado y ADMIN; el de una FINALIZADA, para quien ya lo veía.
--   · Efectos indirectos (sin cambiar sus políticas): documentos, confirmaciones_revision y revision_responsables derivan de «la revisión es visible», así que un borrador ajeno muestra sus
--     responsables (nombres) y confirmaciones; las IMÁGENES de firma siguen protegidas por la RLS de manufactura.firmas / firma_autorizaciones (propietaria, quien la subió o autorización vigente).
--   · NO amplía INSERT/UPDATE/DELETE: pol_*_ins/upd/del, triggers (solo creador/ADMIN modifican, congelación en FINALIZANDO, inmutabilidad de FINALIZADA/DESCARTADA) y privilegios quedan intactos.
--   · NO deshabilita RLS, no crea tablas/funciones/triggers, no toca datos, PDF ni revisiones históricas, core, daubert_global ni n8n.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_024_manufactura_consulta_compartida_borradores_prod.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.revisiones') IS NULL OR to_regclass('manufactura.revision_responsables') IS NULL OR to_regproc('manufactura.fn_actor_id') IS NULL OR to_regproc('manufactura.fn_actor_es_admin') IS NULL THEN
    RAISE EXCEPTION 'ABORTO: faltan las migraciones 101/102.';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname IN ('pol_revisiones_sel', 'pol_pdfs_sel', 'pol_pdf_contenidos_sel')) <> 3 THEN RAISE EXCEPTION 'ABORTO: no están las 3 políticas de lectura esperadas.'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polname = 'pol_revisiones_sel' AND obj_description(p.oid, 'pg_policy') LIKE '105:%') THEN RAISE EXCEPTION 'ABORTO: la migración 105 ya está aplicada (no se reaplica).'; END IF;
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_revisiones_sel') LIKE '%BORRADOR%' THEN RAISE EXCEPTION 'ABORTO: la política de lectura de revisiones no tiene la forma de la 101.'; END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Revisiones: lectura de borradores / finalizaciones en curso para cualquier cuenta con identidad de sesión
-- ---------------------------------------------------------------------------------------------------------------------
ALTER POLICY pol_revisiones_sel ON manufactura.revisiones
  USING (estado = 'FINALIZADA'
         OR (estado IN ('BORRADOR', 'FINALIZANDO') AND manufactura.fn_actor_id() IS NOT NULL)
         OR creado_por_usuario_id = manufactura.fn_actor_id() OR revisor_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin());
COMMENT ON POLICY pol_revisiones_sel ON manufactura.revisiones IS '105: FINALIZADA para todos; BORRADOR y FINALIZANDO para cualquier cuenta con identidad (solo lectura); DESCARTADA solo creador, revisor asignado y ADMIN.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. PDF y bytes: misma exposición que antes (la de una revisión NO finalizada sigue limitada a creador, revisor asignado y ADMIN)
-- ---------------------------------------------------------------------------------------------------------------------
ALTER POLICY pol_pdfs_sel ON manufactura.pdfs
  USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = pdfs.revision_id
                  AND (r.estado = 'FINALIZADA' OR r.creado_por_usuario_id = manufactura.fn_actor_id() OR r.revisor_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin())));
ALTER POLICY pol_pdf_contenidos_sel ON manufactura.pdf_contenidos
  USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = pdf_contenidos.revision_id
                  AND (r.estado = 'FINALIZADA' OR r.creado_por_usuario_id = manufactura.fn_actor_id() OR r.revisor_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin())));
COMMENT ON POLICY pol_pdfs_sel ON manufactura.pdfs IS '105: el PDF de una revisión no finalizada solo lo ven creador, revisor asignado y ADMIN (igual que antes de la 105).';
COMMENT ON POLICY pol_pdf_contenidos_sel ON manufactura.pdf_contenidos IS '105: los bytes del PDF de una revisión no finalizada solo los ven creador, revisor asignado y ADMIN (igual que antes de la 105).';

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND cmd = 'SELECT') <> (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) THEN RAISE EXCEPTION 'Debe seguir habiendo una política SELECT por tabla con RLS.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) <> 0 THEN RAISE EXCEPTION 'Toda tabla de manufactura debe conservar RLS.'; END IF;
END $$;

SELECT 'UP_OK manufactura 105 (3 políticas de lectura redefinidas; sin cambios en escritura, triggers, privilegios ni datos)' AS resultado;
COMMIT;
