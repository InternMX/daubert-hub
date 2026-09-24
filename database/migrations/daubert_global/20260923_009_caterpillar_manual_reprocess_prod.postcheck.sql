-- READ-ONLY post-migration checks for 20260923_009_caterpillar_manual_reprocess_prod.up.sql.
-- Run with psql against daubert_global AFTER applying the up migration. Changes nothing:
-- it runs inside BEGIN TRANSACTION READ ONLY and always ends with ROLLBACK.
-- Pass the values recorded from the precheck (section 8):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w ^
--     -v baseline_series_fp=<md5> -v baseline_functions_fp=<md5> ^
--     -v baseline_ejecuciones=<n> -v baseline_remisiones=<n> ^
--     -v baseline_remision_detalle=<n> -v baseline_reservas=<n> ^
--     -f 20260923_009_caterpillar_manual_reprocess_prod.postcheck.sql
-- Expected: ALL_CHECKS_PASS = true in section 6 and every boolean true.
\set ON_ERROR_STOP on
\pset pager off

\if :{?baseline_series_fp}
\else
    \echo 'ERROR: missing -v baseline_series_fp=... (record it from the precheck, section 8)'
    \quit
\endif
\if :{?baseline_functions_fp}
\else
    \echo 'ERROR: missing -v baseline_functions_fp=... (record it from the precheck, section 8)'
    \quit
\endif
\if :{?baseline_ejecuciones}
\else
    \echo 'ERROR: missing -v baseline_ejecuciones=... (record it from the precheck, section 8)'
    \quit
\endif
\if :{?baseline_remisiones}
\else
    \echo 'ERROR: missing -v baseline_remisiones=... (record it from the precheck, section 8)'
    \quit
\endif
\if :{?baseline_remision_detalle}
\else
    \echo 'ERROR: missing -v baseline_remision_detalle=... (record it from the precheck, section 8)'
    \quit
\endif
\if :{?baseline_reservas}
\else
    \echo 'ERROR: missing -v baseline_reservas=... (record it from the precheck, section 8)'
    \quit
\endif

BEGIN TRANSACTION READ ONLY;

\echo '== 1. Target database =='
SELECT current_database() AS db,
       current_database() = 'daubert_global' AS ok_database,
       current_setting('transaction_read_only') AS transaction_read_only;

\echo '== 2. Resolver function ops.fn_resolver_ejecucion_para_reproceso(bigint) =='
SELECT
    proc.oid IS NOT NULL AS resolver_exists,
    proc.prosecdef AS is_security_definer,
    array_to_string(proc.proconfig, ',') AS search_path_config,
    array_to_string(proc.proconfig, ',') = 'search_path=pg_catalog, ops' AS search_path_is_controlled,
    pg_get_userbyid(proc.proowner) AS owner,
    COALESCE(proc.proacl::text, '(default)') AS acl,
    NOT has_function_privilege('public', proc.oid, 'EXECUTE') AS public_has_no_execute,
    has_function_privilege('n8n_app', proc.oid, 'EXECUTE') AS n8n_app_has_execute,
    NOT has_function_privilege('daubert_hub_app', proc.oid, 'EXECUTE') AS hub_app_has_no_execute,
    proc.proacl IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM aclexplode(proc.proacl) AS entry WHERE entry.grantee = 0) AS explicit_acl_without_public
FROM pg_catalog.pg_proc AS proc
WHERE proc.oid = to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)');

\echo '== 3. Unique partial index =='
SELECT
    index_class.relname AS index_name,
    idx.indisunique AS is_unique,
    idx.indisvalid AS is_valid,
    pg_get_indexdef(idx.indexrelid) AS definition,
    pg_get_indexdef(idx.indexrelid) =
        'CREATE UNIQUE INDEX uq_ejecuciones_automatizacion_reproceso_unico ON ops.ejecuciones_automatizacion USING btree (reproceso_de_id) WHERE (reproceso_de_id IS NOT NULL)' AS definition_matches_expected
FROM pg_catalog.pg_index AS idx
JOIN pg_catalog.pg_class AS index_class ON index_class.oid = idx.indexrelid
WHERE idx.indexrelid = to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico');

\echo '== 4. ops.fn_crear_ejecucion_automatizacion =='
SELECT
    position('ALREADY_REPROCESSED' IN proc.prosrc) > 0 AS returns_already_reprocessed,
    md5(replace(proc.prosrc, chr(13), '')) = '929939dcc7cd3ef0e09b7b2a868b9616' AS body_matches_009,
    proc.prosecdef AS is_security_definer,
    array_to_string(proc.proconfig, ',') = 'search_path=pg_catalog, ops' AS search_path_unchanged,
    COALESCE(proc.proacl::text, '(default)') AS acl,
    NOT has_function_privilege('public', proc.oid, 'EXECUTE') AS public_has_no_execute,
    has_function_privilege('n8n_app', proc.oid, 'EXECUTE') AS n8n_app_has_execute
FROM pg_catalog.pg_proc AS proc
WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)');

\echo '== 5. Nothing else changed (compare to the precheck baseline) =='
WITH current_values AS (
    SELECT
        (SELECT md5(string_agg(
                    serie.serie_id || ':' || serie.codigo || ':' || serie.siguiente_folio || ':' || serie.estatus || ':' ||
                    COALESCE(serie.folio_minimo_ajustable::text, 'null'),
                    ',' ORDER BY serie.serie_id))
         FROM operacion.series_documentales AS serie) AS series_fp,
        (SELECT md5(string_agg(
                    namespace.nspname || '.' || proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')|' ||
                    md5(proc.prosrc) || '|' || COALESCE(proc.proacl::text, ''),
                    E'\n' ORDER BY namespace.nspname, proc.proname, pg_get_function_identity_arguments(proc.oid)))
         FROM pg_catalog.pg_proc AS proc
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
         WHERE namespace.nspname IN ('ops', 'operacion', 'core')
           AND proc.proname NOT IN ('fn_crear_ejecucion_automatizacion', 'fn_resolver_ejecucion_para_reproceso')) AS functions_fp,
        (SELECT count(*) FROM ops.ejecuciones_automatizacion) AS ejecuciones,
        (SELECT count(*) FROM operacion.remisiones) AS remisiones,
        (SELECT count(*) FROM operacion.remision_detalle) AS remision_detalle,
        (SELECT count(*) FROM operacion.reservas_folios) AS reservas,
        (SELECT count(*) FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id IS NOT NULL) AS reprocess_rows
)
SELECT
    series_fp = :'baseline_series_fp' AS series_and_siguiente_folio_unchanged,
    functions_fp = :'baseline_functions_fp' AS other_functions_and_acls_unchanged,
    ejecuciones = :'baseline_ejecuciones'::bigint AS no_executions_created,
    remisiones = :'baseline_remisiones'::bigint AS no_remisiones_created,
    remision_detalle = :'baseline_remision_detalle'::bigint AS no_remision_detalle_created,
    reservas = :'baseline_reservas'::bigint AS no_reservations_created,
    reprocess_rows = 0 AS no_reprocess_rows_created
FROM current_values;

\echo '== 6. SUMMARY (ALL_CHECKS_PASS must be true) =='
SELECT
    (SELECT proc.prosecdef
            AND array_to_string(proc.proconfig, ',') = 'search_path=pg_catalog, ops'
            AND NOT has_function_privilege('public', proc.oid, 'EXECUTE')
            AND has_function_privilege('n8n_app', proc.oid, 'EXECUTE')
            AND NOT has_function_privilege('daubert_hub_app', proc.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)')) IS TRUE AS resolver_ok,
    (SELECT idx.indisunique AND idx.indisvalid
     FROM pg_catalog.pg_index AS idx
     WHERE idx.indexrelid = to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico')) IS TRUE AS unique_index_ok,
    (SELECT position('ALREADY_REPROCESSED' IN proc.prosrc) > 0
            AND md5(replace(proc.prosrc, chr(13), '')) = '929939dcc7cd3ef0e09b7b2a868b9616'
            AND has_function_privilege('n8n_app', proc.oid, 'EXECUTE')
            AND NOT has_function_privilege('public', proc.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)')) IS TRUE AS fn_crear_ok,
    (current_database() = 'daubert_global') AS database_ok;

ROLLBACK;
