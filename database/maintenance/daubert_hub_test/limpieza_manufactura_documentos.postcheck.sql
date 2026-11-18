-- =====================================================================================================================
-- POSTCHECK · limpieza de documentos de Hojas de Manufactura (SOLO TEST: daubert_hub_test). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -v huella_protegidos=<PREVIEW> -v huella_triggers=<PREVIEW> -v huella_politicas=<PREVIEW> -f limpieza_manufactura_documentos.postcheck.sql
-- Esperado: todas las columnas en true y all_postchecks_pass = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?huella_protegidos}
\else
  \echo 'ABORTO: falta -v huella_protegidos (valor del PREVIEW).'
  \quit
\endif
\if :{?huella_triggers}
\else
  \echo 'ABORTO: falta -v huella_triggers (valor del PREVIEW).'
  \quit
\endif
\if :{?huella_politicas}
\else
  \echo 'ABORTO: falta -v huella_politicas (valor del PREVIEW).'
  \quit
\endif
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test.'; END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
END $$;
WITH r AS (
  SELECT
    (SELECT count(*) FROM manufactura.documentos) = 0                    AS documentos_vacia,
    (SELECT count(*) FROM manufactura.revisiones) = 0                    AS revisiones_vacia,
    (SELECT count(*) FROM manufactura.pdfs) = 0                          AS pdfs_vacia,
    (SELECT count(*) FROM manufactura.pdf_contenidos) = 0                AS pdf_contenidos_vacia,
    (SELECT count(*) FROM manufactura.confirmaciones_revision) = 0       AS confirmaciones_vacia,
    (SELECT count(*) FROM manufactura.revision_responsables) = 0         AS responsables_vacia,
    (SELECT md5(concat_ws('#',
        (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firmas t),
        (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firma_autorizaciones t),
        (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
        (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users),
        (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
        (SELECT count(*)::text FROM core.empresa_roles)))) = :'huella_protegidos' AS firmas_autorizaciones_abreviaturas_usuarios_clientes_intactos,
    (SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal) = :'huella_triggers' AS triggers_como_antes_y_habilitados,
    (SELECT md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'manufactura') = :'huella_politicas' AS politicas_rls_como_antes,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) = 0 AS toda_tabla_con_rls,
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgenabled <> 'O') = 0 AS ningun_trigger_deshabilitado,
    (SELECT count(*) FROM pg_constraint WHERE connamespace = 'manufactura'::regnamespace AND contype = 'f' AND NOT convalidated) = 0 AS claves_foraneas_validadas,
    -- Actividad reciente se calcula en vivo sobre estas tablas: sin documentos no hay eventos ni enlaces que puedan romperse.
    (SELECT count(*) FROM manufactura.revisiones WHERE estado IN ('BORRADOR', 'FINALIZANDO', 'FINALIZADA')) = 0 AS actividad_reciente_sin_eventos
)
SELECT r.*, (documentos_vacia AND revisiones_vacia AND pdfs_vacia AND pdf_contenidos_vacia AND confirmaciones_vacia AND responsables_vacia AND firmas_autorizaciones_abreviaturas_usuarios_clientes_intactos
             AND triggers_como_antes_y_habilitados AND politicas_rls_como_antes AND toda_tabla_con_rls AND ningun_trigger_deshabilitado AND claves_foraneas_validadas AND actividad_reciente_sin_eventos) AS all_postchecks_pass FROM r;
-- Informativo: las bajas quedaron auditadas (el historial anterior se conserva).
SELECT origen, operacion, tabla, count(*) AS filas FROM audit.cambios WHERE esquema = 'manufactura' AND origen = 'LIMPIEZA_TEST' GROUP BY 1, 2, 3 ORDER BY 3;
ROLLBACK;
