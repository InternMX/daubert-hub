-- =====================================================================================================================
-- PREVIEW (no persiste nada: vistas temporales + ROLLBACK) · recursos de la DEMOSTRACIÓN de la Fase 6F en daubert_hub_test. No modifica nada.
-- Se ejecuta con el rol administrativo (la RLS oculta filas a la cuenta de la aplicación). Imprime el inventario exacto, lo que se CONSERVA y la línea de parámetros del DELETE.
--   psql -X -v ON_ERROR_STOP=1 -d daubert_hub_test -U postgres -f limpieza_demo_6F.preview.sql
--
-- Criterio de «recurso de demostración» (las DOS condiciones a la vez, nunca solo el código):
--   · Cuentas: exactamente demo.admin.manufactura / demo.general1.manufactura / demo.general2.manufactura @example.invalid, creadas después de la línea base (user_id > 247).
--   · Documentos: código DEMOFPMG101–104 Y creados por una cuenta de demostración. Revisiones, PDF, contenidos, confirmaciones y responsables: los de esos documentos.
--   · Firmas: propiedad Y subida por una cuenta de demostración, sin uso en revisiones que se conservan. Autorizaciones: sobre esas firmas, o otorgadas a/por cuentas de demostración.
-- Línea base anterior a la Fase 6F (respaldo daubert_hub_test_pre_demo_6F_20261111-135627): documentos 33–36, revisiones 64–73, firmas 5,6,7,9, 2 autorizaciones, 5 abreviaturas, usuarios ≤ 247.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;   -- solo crea vistas TEMPORALES de esta sesión y termina con ROLLBACK: no persiste nada
-- Formato de salida fijo: la huella usa fila::text, que depende de la zona horaria y del estilo de fecha de la sesión (el servidor real usa America/Mexico_City).
SET LOCAL TimeZone = 'UTC'; SET LOCAL DateStyle = 'ISO, YMD'; SET LOCAL IntervalStyle = 'postgres'; SET LOCAL bytea_output = 'hex'; SET LOCAL extra_float_digits = 1;
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF; END $$;

CREATE TEMP VIEW _demo_users AS SELECT user_id FROM security.users WHERE user_id > 247 AND email IN ('demo.admin.manufactura@example.invalid', 'demo.general1.manufactura@example.invalid', 'demo.general2.manufactura@example.invalid');
CREATE TEMP VIEW _demo_docs AS SELECT documento_id FROM manufactura.documentos WHERE codigo_dcmx IN ('DEMOFPMG101', 'DEMOFPMG102', 'DEMOFPMG103', 'DEMOFPMG104') AND creado_por_usuario_id IN (SELECT user_id FROM _demo_users);
CREATE TEMP VIEW _demo_revs AS SELECT revision_id FROM manufactura.revisiones WHERE documento_id IN (SELECT documento_id FROM _demo_docs);
CREATE TEMP VIEW _demo_firmas AS SELECT firma_id FROM manufactura.firmas f WHERE propietario_usuario_id IN (SELECT user_id FROM _demo_users) AND subida_por_usuario_id IN (SELECT user_id FROM _demo_users)
  AND NOT EXISTS (SELECT 1 FROM manufactura.revision_responsables r WHERE r.firma_id = f.firma_id AND r.revision_id NOT IN (SELECT revision_id FROM _demo_revs));
CREATE TEMP VIEW _demo_auts AS SELECT autorizacion_id FROM manufactura.firma_autorizaciones a WHERE a.firma_id IN (SELECT firma_id FROM _demo_firmas)
  OR a.usuario_id IN (SELECT user_id FROM _demo_users) OR a.otorgada_por_usuario_id IN (SELECT user_id FROM _demo_users);

\echo '== CUENTAS DE DEMOSTRACIÓN'
SELECT u.user_id, u.email, u.role, u.status, u.created_at::timestamp(0), (SELECT count(*) FROM security.sessions s WHERE s.user_id = u.user_id) AS sesiones FROM security.users u WHERE u.user_id IN (SELECT user_id FROM _demo_users) ORDER BY 1;
\echo '== DOCUMENTOS DE DEMOSTRACIÓN'
SELECT d.documento_id, d.codigo_dcmx, d.creado_por_usuario_id, d.created_at::timestamp(0) FROM manufactura.documentos d WHERE d.documento_id IN (SELECT documento_id FROM _demo_docs) ORDER BY 1;
\echo '== REVISIONES DE ESOS DOCUMENTOS'
SELECT r.revision_id, r.documento_id, r.estado, r.revision, r.basada_en_revision_id, r.creado_por_usuario_id FROM manufactura.revisiones r WHERE r.revision_id IN (SELECT revision_id FROM _demo_revs) ORDER BY 1;
\echo '== DEPENDENCIAS DOCUMENTALES'
SELECT 'pdfs' AS tabla, count(*) FROM manufactura.pdfs WHERE revision_id IN (SELECT revision_id FROM _demo_revs)
UNION ALL SELECT 'pdf_contenidos', count(*) FROM manufactura.pdf_contenidos WHERE revision_id IN (SELECT revision_id FROM _demo_revs)
UNION ALL SELECT 'confirmaciones_revision', count(*) FROM manufactura.confirmaciones_revision WHERE revision_id IN (SELECT revision_id FROM _demo_revs)
UNION ALL SELECT 'revision_responsables', count(*) FROM manufactura.revision_responsables WHERE revision_id IN (SELECT revision_id FROM _demo_revs);
\echo '== FIRMAS DE DEMOSTRACIÓN'
SELECT f.firma_id, f.propietario_usuario_id, f.subida_por_usuario_id, f.estado, f.created_at::timestamp(0) FROM manufactura.firmas f WHERE f.firma_id IN (SELECT firma_id FROM _demo_firmas) ORDER BY 1;
\echo '== AUTORIZACIONES DE DEMOSTRACIÓN'
SELECT a.autorizacion_id, a.firma_id, a.usuario_id, a.otorgada_por_usuario_id, a.revocada_en IS NOT NULL AS revocada FROM manufactura.firma_autorizaciones a WHERE a.autorizacion_id IN (SELECT autorizacion_id FROM _demo_auts) ORDER BY 1;
\echo '== REFERENCIAS DE LAS CUENTAS DE DEMOSTRACIÓN FUERA DE LO QUE SE ELIMINA (deciden si la cuenta puede borrarse)'
SELECT 'manufactura.documentos (otros)' AS donde, count(*) FROM manufactura.documentos WHERE creado_por_usuario_id IN (SELECT user_id FROM _demo_users) AND documento_id NOT IN (SELECT documento_id FROM _demo_docs)
UNION ALL SELECT 'manufactura.revisiones (otras)', count(*) FROM manufactura.revisiones WHERE revision_id NOT IN (SELECT revision_id FROM _demo_revs) AND (creado_por_usuario_id IN (SELECT user_id FROM _demo_users) OR actualizado_por_usuario_id IN (SELECT user_id FROM _demo_users) OR finalizado_por_usuario_id IN (SELECT user_id FROM _demo_users) OR revisor_usuario_id IN (SELECT user_id FROM _demo_users))
UNION ALL SELECT 'manufactura.firmas (otras)', count(*) FROM manufactura.firmas WHERE firma_id NOT IN (SELECT firma_id FROM _demo_firmas) AND (propietario_usuario_id IN (SELECT user_id FROM _demo_users) OR subida_por_usuario_id IN (SELECT user_id FROM _demo_users) OR incorporada_por_usuario_id IN (SELECT user_id FROM _demo_users))
UNION ALL SELECT 'manufactura.cliente_abreviaturas', count(*) FROM manufactura.cliente_abreviaturas WHERE propuesta_por_usuario_id IN (SELECT user_id FROM _demo_users) OR resuelta_por_usuario_id IN (SELECT user_id FROM _demo_users)
UNION ALL SELECT 'operacion/ops/cat_recovery_test', (SELECT count(*) FROM operacion.autorizaciones_regeneracion_caterpillar WHERE usuario_id IN (SELECT user_id FROM _demo_users)) + (SELECT count(*) FROM operacion.cancelaciones_remisiones WHERE usuario_id IN (SELECT user_id FROM _demo_users)) + (SELECT count(*) FROM ops.automation_review_acknowledgements WHERE reviewed_by_user_id IN (SELECT user_id FROM _demo_users)) + (SELECT count(*) FROM ops.automation_trigger_requests WHERE requested_by_user_id IN (SELECT user_id FROM _demo_users)) + (SELECT count(*) FROM cat_recovery_test.requests WHERE admin_id IN (SELECT user_id FROM _demo_users))
UNION ALL SELECT 'audit.cambios (historial; NO se borra)', count(*) FROM audit.cambios WHERE usuario_id IN (SELECT user_id::text FROM _demo_users);
\echo '== EMPRESAS Y ABREVIATURAS CREADAS DESPUÉS DE LA LÍNEA BASE'
SELECT 'empresas con rol CLIENTE' AS que, count(*) FROM core.empresa_roles WHERE rol = 'CLIENTE' UNION ALL SELECT 'abreviaturas', count(*) FROM manufactura.cliente_abreviaturas;

\echo '== PARÁMETROS DEL DELETE (copiar tal cual)'
SELECT format('-v docs=%s -v revs=%s -v firmas=%s -v auts=%s -v usuarios=%s -v n_pdfs=%s -v n_contenidos=%s -v n_confirmaciones=%s -v n_responsables=%s -v huella_conservado=%s -v huella_triggers=%s',
  (SELECT coalesce(string_agg(documento_id::text, ',' ORDER BY documento_id), 'ninguno') FROM _demo_docs),
  (SELECT coalesce(string_agg(revision_id::text, ',' ORDER BY revision_id), 'ninguno') FROM _demo_revs),
  (SELECT coalesce(string_agg(firma_id::text, ',' ORDER BY firma_id), 'ninguno') FROM _demo_firmas),
  (SELECT coalesce(string_agg(autorizacion_id::text, ',' ORDER BY autorizacion_id), 'ninguno') FROM _demo_auts),
  (SELECT coalesce(string_agg(user_id::text, ',' ORDER BY user_id), 'ninguno') FROM _demo_users),
  (SELECT count(*) FROM manufactura.pdfs WHERE revision_id IN (SELECT revision_id FROM _demo_revs)),
  (SELECT count(*) FROM manufactura.pdf_contenidos WHERE revision_id IN (SELECT revision_id FROM _demo_revs)),
  (SELECT count(*) FROM manufactura.confirmaciones_revision WHERE revision_id IN (SELECT revision_id FROM _demo_revs)),
  (SELECT count(*) FROM manufactura.revision_responsables WHERE revision_id IN (SELECT revision_id FROM _demo_revs)),
  -- Huella de TODO lo que se conserva (si cambia entre el PREVIEW y el DELETE, el DELETE aborta).
  md5(concat_ws('#',
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.documento_id), '')) FROM manufactura.documentos t WHERE documento_id NOT IN (SELECT documento_id FROM _demo_docs)),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.revision_id), '')) FROM manufactura.revisiones t WHERE revision_id NOT IN (SELECT revision_id FROM _demo_revs)),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.pdfs t WHERE revision_id NOT IN (SELECT revision_id FROM _demo_revs)),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.revision_responsables t WHERE revision_id NOT IN (SELECT revision_id FROM _demo_revs)),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.firma_id), '')) FROM manufactura.firmas t WHERE firma_id NOT IN (SELECT firma_id FROM _demo_firmas)),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.autorizacion_id), '')) FROM manufactura.firma_autorizaciones t WHERE autorizacion_id NOT IN (SELECT autorizacion_id FROM _demo_auts)),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
    (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users WHERE user_id NOT IN (SELECT user_id FROM _demo_users)),
    (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
    (SELECT count(*)::text FROM core.empresa_roles))),
  (SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal)
) AS parametros_delete;
ROLLBACK;
