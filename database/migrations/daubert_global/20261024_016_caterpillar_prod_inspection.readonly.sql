-- READ ONLY inspection queries for the PRODUCTION cutover of Caterpillar 016. SELECT / catalog metadata only: no DDL, no DML, no GRANT, no locks beyond
-- the implicit ACCESS SHARE of a SELECT. Executed by apps/api/scripts/caterpillar-016-prod-inspect.cjs (one named block per query, "-- @name"), or by hand
-- with psql inside BEGIN READ ONLY. Each block is independent: one failing block (e.g. a table that does not exist yet in PROD) does not hide the others.
-- The same file is re-run AFTER the cutover to compare series, reservations and remissions (section "post-cutover" in the runbook).

-- @identity
SELECT current_database() AS database, current_user AS db_user, current_setting('transaction_read_only') AS read_only, version() AS version,
  current_setting('server_encoding') AS encoding,
  EXISTS(SELECT 1 FROM pg_collation WHERE collname='pg_unicode_fast' AND collnamespace='pg_catalog'::regnamespace) AS has_unicode_fast_collation;

-- @prerequisite_objects
SELECT x.object, to_regclass(x.object) IS NOT NULL AS exists FROM (VALUES ('core.documentos'),('ops.ejecuciones_automatizacion'),('ops.automatizaciones'),
  ('ops.automatizacion_series_proceso'),('operacion.remisiones'),('operacion.remision_detalle'),('operacion.reservas_folios'),('operacion.series_documentales')) x(object);

-- @snapshot_column
SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull FROM pg_attribute a
WHERE a.attrelid=to_regclass('core.documentos') AND a.attname='caterpillar_admission' AND NOT a.attisdropped;

-- @required_columns
SELECT c.table_schema||'.'||c.table_name AS relation, string_agg(c.column_name, ',' ORDER BY c.ordinal_position) AS columns
FROM information_schema.columns c WHERE (c.table_schema,c.table_name) IN (('core','documentos'),('ops','ejecuciones_automatizacion'),('operacion','remisiones'),
  ('operacion','reservas_folios'),('operacion','series_documentales'),('ops','automatizacion_series_proceso'))
GROUP BY 1 ORDER BY 1;

-- @legacy_function_pins
SELECT pinned.signature, to_regprocedure(pinned.signature) IS NOT NULL AS exists,
  md5(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure(pinned.signature)),chr(13),'')) AS raw_body_md5,
  md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure(pinned.signature)),chr(13),''),'--[^\n]*','','g'),'\s+',' ','g'))) AS normalized_md5,
  pinned.test_validated_md5,
  md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure(pinned.signature)),chr(13),''),'--[^\n]*','','g'),'\s+',' ','g')))=pinned.test_validated_md5 AS matches_test_validated,
  (SELECT pg_get_userbyid(proowner)||' secdef='||prosecdef FROM pg_proc WHERE oid=to_regprocedure(pinned.signature)) AS owner
FROM (VALUES
  ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)','39a8f01535b92d492c85cac7fb3c168e'),
  ('operacion.reservar_folios_para_ejecucion(bigint,text,integer)','1ec951338fcb7218c59bc0cc03b97336'),
  ('operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)','87cde2a1e34239b2c07fa4662f012726'),
  ('ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)','594b198708d4d1e53cf4ad812de81164'),
  ('ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)','fbcb268f79ad4e8580dae1d8c58380a0')) pinned(signature,test_validated_md5);

-- @caterpillar_related_functions
SELECT p.oid::regprocedure::text AS function, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
  md5(replace(p.prosrc,chr(13),'')) AS body_md5, p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('core','ops','operacion') AND (p.proname ~ 'caterpillar|remision|folio|ejecucion|reserva|documento|_015$') ORDER BY 1;

-- @new_object_name_collisions
SELECT n.nspname||'.'||p.proname AS existing_function FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('ops','operacion') AND p.proname IN ('fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar',
  'fn_reprocesar_reservar_caterpillar','fn_guardar_snapshot_caterpillar','fn_registrar_remision_caterpillar','fn_finalizar_caterpillar','fn_fallo_caterpillar');

-- @roles
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolconnlimit,
  (SELECT string_agg(g.rolname, ',') FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid) AS member_of
FROM pg_roles r WHERE r.rolname IN ('n8n_app','n8n_cat_prod','daubert_hub_app','postgres') ORDER BY 1;

-- @worker_effective_privileges
SELECT r.rolname, s.signature, to_regprocedure(s.signature) IS NOT NULL AND has_function_privilege(r.oid, to_regprocedure(s.signature), 'EXECUTE') AS can_execute
FROM pg_roles r CROSS JOIN (VALUES ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)'),('operacion.reservar_folios_para_ejecucion(bigint,text,integer)'),
  ('operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)'),('ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)'),
  ('ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'),('ops.fn_resolver_ejecucion_para_reproceso(bigint)'),
  ('core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)')) s(signature)
WHERE r.rolname IN ('n8n_app','n8n_cat_prod','daubert_hub_app') ORDER BY 1,2;

-- @live_connections
SELECT datname, usename, state, count(*) AS connections, min(backend_start) AS oldest_backend, max(state_change) AS last_state_change
FROM pg_stat_activity WHERE datname='daubert_global' AND usename IN ('n8n_app','n8n_cat_prod','daubert_hub_app') GROUP BY 1,2,3 ORDER BY 1,2,3;

-- @automations_and_routes
SELECT a.codigo AS automation, a.estatus AS automation_status, r.llave_proceso, r.estatus AS route_status, s.codigo AS series, s.estatus AS series_status
FROM ops.automatizaciones a LEFT JOIN ops.automatizacion_series_proceso r USING(automatizacion_id) LEFT JOIN operacion.series_documentales s USING(serie_id)
WHERE a.codigo ILIKE '%CATERPILLAR%' OR s.codigo LIKE 'REMISION_CAT%' ORDER BY r.ruta_id;

-- @series_state_and_discrepancies
SELECT s.codigo, s.estatus, s.siguiente_folio,
  (SELECT max(folio) FROM operacion.remisiones m WHERE m.serie_id=s.serie_id) AS max_emitted_folio,
  (SELECT max(f.folio_final) FROM operacion.reservas_folios f WHERE f.serie_id=s.serie_id) AS max_reserved_folio,
  s.siguiente_folio - 1 - GREATEST(COALESCE((SELECT max(folio) FROM operacion.remisiones m WHERE m.serie_id=s.serie_id),0),
    COALESCE((SELECT max(f.folio_final) FROM operacion.reservas_folios f WHERE f.serie_id=s.serie_id),0)) AS counter_minus_highest_used,
  (SELECT count(*) FROM operacion.remisiones m WHERE m.serie_id=s.serie_id) AS remissions,
  (SELECT count(*) FROM operacion.reservas_folios f WHERE f.serie_id=s.serie_id) AS reservations
FROM operacion.series_documentales s WHERE s.codigo IN ('REMISION_CAT_P2','REMISION_CAT_P5','REMISION_CAT_P6') ORDER BY 1;

-- @series_gaps_and_overlaps
-- Folios may legitimately be re-issued after a cancellation (cancel + folio adjustment + regenerate), so a CANCELADA remission and a live one can share a
-- (series, folio) and a fully cancelled reservation can overlap its successor: only LIVE duplicates/overlaps are violations (see @folio_reuse_after_cancellation).
WITH live_reservations AS (
  SELECT f.* FROM operacion.reservas_folios f JOIN operacion.series_documentales s USING(serie_id)
  WHERE s.codigo LIKE 'REMISION_CAT%' AND f.estatus<>'ABANDONADA' AND (f.estatus<>'APLICADA' OR EXISTS (SELECT 1 FROM operacion.remisiones m
    WHERE m.ejecucion_id=f.ejecucion_id AND m.serie_id=f.serie_id AND m.folio BETWEEN f.folio_inicial AND f.folio_final AND m.estatus<>'CANCELADA'))
)
SELECT 'DUPLICATE_LIVE_FOLIO' AS rule, serie_id::text||':'||folio::text AS detail FROM operacion.remisiones WHERE estatus<>'CANCELADA' GROUP BY serie_id, folio HAVING count(*)>1
UNION ALL SELECT 'OVERLAPPING_LIVE_RESERVATIONS', a.reserva_id||'/'||b.reserva_id FROM live_reservations a JOIN live_reservations b
  ON a.serie_id=b.serie_id AND a.reserva_id<b.reserva_id AND a.folio_inicial<=b.folio_final AND b.folio_inicial<=a.folio_final
UNION ALL SELECT 'CATERPILLAR_REMISSION_OUTSIDE_RESERVATION', m.remision_id::text FROM operacion.remisiones m JOIN operacion.series_documentales s USING(serie_id)
  WHERE s.codigo LIKE 'REMISION_CAT%' AND NOT EXISTS (SELECT 1 FROM operacion.reservas_folios f WHERE f.ejecucion_id=m.ejecucion_id AND f.serie_id=m.serie_id AND m.folio BETWEEN f.folio_inicial AND f.folio_final);

-- @folio_reuse_after_cancellation
SELECT s.codigo, m.folio, string_agg(m.remision_id::text||':'||m.estatus||':ej'||m.ejecucion_id::text, ' | ' ORDER BY m.remision_id) AS remissions
FROM operacion.remisiones m JOIN operacion.series_documentales s USING(serie_id) WHERE s.codigo LIKE 'REMISION_CAT%'
GROUP BY s.codigo, m.folio HAVING count(*)>1 ORDER BY 1,2;

-- @cancel_and_reissue_history
SELECT e2.ejecucion_id AS later_execution, d2.nombre_archivo AS later_file, e1.ejecucion_id AS earlier_execution, d1.nombre_archivo AS earlier_file,
  (lower(btrim(d1.hash_archivo))=lower(btrim(d2.hash_archivo))) AS same_file_bytes,
  (upper(btrim(regexp_replace(d1.nombre_archivo,'\.(xlsx|xlsm|xls)$','','i')))=upper(btrim(regexp_replace(d2.nombre_archivo,'\.(xlsx|xlsm|xls)$','','i')))) AS same_name
FROM ops.ejecuciones_automatizacion e2 JOIN ops.automatizaciones a2 ON a2.automatizacion_id=e2.automatizacion_id AND a2.codigo='REMISIONES_CATERPILLAR'
JOIN core.documentos d2 ON d2.documento_id=e2.documento_origen_id
JOIN ops.ejecuciones_automatizacion e1 ON e1.ejecucion_id<e2.ejecucion_id AND e1.automatizacion_id=e2.automatizacion_id
JOIN core.documentos d1 ON d1.documento_id=e1.documento_origen_id AND d1.empresa_id=d2.empresa_id AND d1.documento_id<>d2.documento_id
WHERE EXISTS (SELECT 1 FROM operacion.remisiones r WHERE r.ejecucion_id=e1.ejecucion_id)
  AND NOT EXISTS (SELECT 1 FROM operacion.remisiones r WHERE r.ejecucion_id=e1.ejecucion_id AND r.estatus<>'CANCELADA')
  AND (lower(btrim(d1.hash_archivo))=lower(btrim(d2.hash_archivo)) OR upper(btrim(regexp_replace(d1.nombre_archivo,'\.(xlsx|xlsm|xls)$','','i')))=upper(btrim(regexp_replace(d2.nombre_archivo,'\.(xlsx|xlsm|xls)$','','i'))))
ORDER BY 1;

-- @executions_by_state
SELECT e.estado, count(*) AS executions, min(e.ejecucion_id) AS first_id, max(e.ejecucion_id) AS last_id
FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' GROUP BY 1 ORDER BY 1;

-- @executions_processing
SELECT e.ejecucion_id, e.documento_origen_id, e.n8n_execution_id, e.iniciada_en, e.intentos_fallidos, now()-e.iniciada_en AS running_for
FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO' ORDER BY 1;

-- @executions_recent
SELECT e.ejecucion_id, e.estado, e.documento_origen_id, e.reproceso_de_id, e.iniciada_en, e.finalizada_en, e.error_nodo
FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' ORDER BY e.ejecucion_id DESC LIMIT 15;

-- @reservations_by_state
SELECT f.estatus, count(*) AS reservations, sum(f.cantidad) AS folios, count(*) FILTER (WHERE f.estatus='RESERVADA' AND f.created_at < now()-interval '1 hour') AS reserved_older_than_1h
FROM operacion.reservas_folios f GROUP BY 1 ORDER BY 1;

-- @completed_reservation_mismatch
SELECT e.ejecucion_id FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones au USING(automatizacion_id)
WHERE au.codigo='REMISIONES_CATERPILLAR' AND e.estado='COMPLETADA' AND EXISTS (SELECT 1 FROM operacion.reservas_folios f WHERE f.ejecucion_id=e.ejecucion_id
  AND f.cantidad<>(SELECT count(*) FROM operacion.remisiones r WHERE r.ejecucion_id=e.ejecucion_id AND r.serie_id=f.serie_id AND r.folio BETWEEN f.folio_inicial AND f.folio_final));

-- @remissions_by_series_and_state
SELECT s.codigo, m.estatus, count(*) AS remissions, min(m.folio) AS first_folio, max(m.folio) AS last_folio
FROM operacion.remisiones m JOIN operacion.series_documentales s USING(serie_id) WHERE s.codigo LIKE 'REMISION_CAT%' GROUP BY 1,2 ORDER BY 1,2;

-- @legacy_documents
SELECT d.empresa_id, count(DISTINCT d.documento_id) AS caterpillar_documents,
  count(DISTINCT d.documento_id) FILTER (WHERE NULLIF(btrim(d.hash_archivo),'') IS NULL) AS without_file_hash,
  count(DISTINCT d.documento_id) FILTER (WHERE d.nombre_archivo !~* '\.(xlsx|xlsm|xls)$' OR d.nombre_archivo ~ '[\\/:*?"<>|]') AS names_the_gate_cannot_verify
FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
WHERE a.codigo='REMISIONES_CATERPILLAR' GROUP BY 1;

-- @legacy_identity_collisions
SELECT d.empresa_id, upper(btrim(regexp_replace(d.nombre_archivo,'\.(xlsx|xlsm|xls)$','','i'))) AS normalized_name, count(DISTINCT d.documento_id) AS documents,
  array_agg(DISTINCT d.documento_id ORDER BY d.documento_id) AS document_ids
FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
WHERE a.codigo='REMISIONES_CATERPILLAR' GROUP BY 1,2 HAVING count(DISTINCT d.documento_id)>1 ORDER BY 3 DESC, 2;

-- @documents_with_multiple_live_executions
SELECT e.documento_origen_id, count(*) AS executions, array_agg(e.ejecucion_id ORDER BY e.ejecucion_id) AS execution_ids, array_agg(e.estado ORDER BY e.ejecucion_id) AS states
FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR'
GROUP BY 1 HAVING count(*)>1 ORDER BY 1;

-- @document_fingerprint
SELECT count(*) AS documents, md5(COALESCE(string_agg((to_jsonb(d)-'caterpillar_admission')::text,'|' ORDER BY documento_id),'')) AS existing_document_data_fingerprint FROM core.documentos d;

-- @cancellation_and_regeneration_objects
SELECT to_regclass('operacion.cancelaciones_remisiones') IS NOT NULL AS cancellation_ledger,
  to_regprocedure('operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)') IS NOT NULL AS cancellation_function,
  to_regclass('operacion.autorizaciones_regeneracion_caterpillar') IS NOT NULL AS regeneration_table,
  to_regprocedure('operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)') IS NOT NULL AS regeneration_function;
