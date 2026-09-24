-- READ-ONLY pre-migration checks for 20260923_009_caterpillar_manual_reprocess_prod.up.sql.
-- Run with psql against daubert_global BEFORE applying the up migration. Changes nothing:
-- it runs inside BEGIN TRANSACTION READ ONLY and always ends with ROLLBACK.
-- Expected: every boolean below as annotated, section 5 returns 0 rows, and you RECORD the section 8
-- baseline values - they are passed to the postcheck script with psql -v.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Target database (ok_database must be true) =='
SELECT current_database() AS db,
       current_database() = 'daubert_global' AS ok_database,
       current_setting('transaction_read_only') AS transaction_read_only;

\echo '== 2. Required role/objects (all must be true) =='
SELECT
    EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'n8n_app') AS n8n_app_exists,
    to_regclass('ops.ejecuciones_automatizacion') IS NOT NULL AS ejecuciones_table_exists,
    to_regclass('ops.automatizaciones') IS NOT NULL AS automatizaciones_table_exists,
    to_regclass('core.documentos') IS NOT NULL AS documentos_table_exists,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ops' AND table_name = 'ejecuciones_automatizacion' AND column_name = 'reproceso_de_id'
    ) AS reproceso_de_id_column_exists,
    EXISTS (SELECT 1 FROM ops.automatizaciones WHERE codigo = 'REMISIONES_CATERPILLAR') AS cat_automation_exists,
    to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)') IS NOT NULL AS fn_crear_exists;

\echo '== 3. Delta objects must NOT exist yet (all must be false) =='
SELECT
    to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)') IS NOT NULL AS resolver_already_exists,
    to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico') IS NOT NULL AS unique_index_already_exists,
    COALESCE(position('ALREADY_REPROCESSED' IN (
        SELECT proc.prosrc FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)')
    )) > 0, false) AS fn_crear_already_returns_already_reprocessed;

\echo '== 4. fn_crear is the expected current PROD body, 20260918_007 (matches must be true) =='
SELECT md5(replace(proc.prosrc, chr(13), '')) AS current_md5,
       '9b5ede68b149f2c43eca6ea2a25d1b2d' AS expected_md5,
       md5(replace(proc.prosrc, chr(13), '')) = '9b5ede68b149f2c43eca6ea2a25d1b2d' AS matches_expected,
       proc.prosecdef AS security_definer,
       array_to_string(proc.proconfig, ',') AS config,
       COALESCE(proc.proacl::text, '(default)') AS acl
FROM pg_catalog.pg_proc AS proc
WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)');

\echo '== 5. Parents with more than one direct child (must return 0 rows) =='
SELECT reproceso_de_id, count(*) AS cantidad_hijos
FROM ops.ejecuciones_automatizacion
WHERE reproceso_de_id IS NOT NULL
GROUP BY reproceso_de_id
HAVING count(*) > 1
ORDER BY reproceso_de_id;

\echo '== 6. Reprocess and in-flight executions (expected 0 and 0) =='
SELECT count(*) FILTER (WHERE reproceso_de_id IS NOT NULL) AS reprocess_rows,
       count(*) FILTER (WHERE estado = 'PROCESANDO') AS in_flight_rows
FROM ops.ejecuciones_automatizacion;

\echo '== 7. Current CAT series (informational - the migration must not change these) =='
SELECT serie_id, codigo, siguiente_folio, folio_minimo_ajustable, estatus
FROM operacion.series_documentales
WHERE codigo ILIKE '%CAT%'
ORDER BY codigo;

\echo '== 8. BASELINE values - RECORD THESE and pass them to the postcheck with psql -v =='
SELECT
    (SELECT md5(string_agg(
                serie.serie_id || ':' || serie.codigo || ':' || serie.siguiente_folio || ':' || serie.estatus || ':' ||
                COALESCE(serie.folio_minimo_ajustable::text, 'null'),
                ',' ORDER BY serie.serie_id))
     FROM operacion.series_documentales AS serie) AS baseline_series_fp,
    (SELECT md5(string_agg(
                namespace.nspname || '.' || proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')|' ||
                md5(proc.prosrc) || '|' || COALESCE(proc.proacl::text, ''),
                E'\n' ORDER BY namespace.nspname, proc.proname, pg_get_function_identity_arguments(proc.oid)))
     FROM pg_catalog.pg_proc AS proc
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
     WHERE namespace.nspname IN ('ops', 'operacion', 'core')
       AND proc.proname NOT IN ('fn_crear_ejecucion_automatizacion', 'fn_resolver_ejecucion_para_reproceso')) AS baseline_functions_fp,
    (SELECT count(*) FROM ops.ejecuciones_automatizacion) AS baseline_ejecuciones,
    (SELECT count(*) FROM operacion.remisiones) AS baseline_remisiones,
    (SELECT count(*) FROM operacion.remision_detalle) AS baseline_remision_detalle,
    (SELECT count(*) FROM operacion.reservas_folios) AS baseline_reservas;

ROLLBACK;
