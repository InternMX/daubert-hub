-- PRODUCTION-READY TEMPLATE - DO NOT APPLY TO daubert_global YET.
-- Phase 12C.2a (PROD): database delta for the Caterpillar manual reprocess webhook.
-- Ports ONLY the missing delta of daubert_hub_test/20260923_009_caterpillar_manual_reprocess.up.sql.
-- Everything else Phase 12C needs is ALREADY materialized in daubert_global (confirmed by the
-- read-only pre-production audit): reproceso_de_id + FK/CHECK + non-unique index, retry state
-- (20260921_008), finalization, remittance persistence, hash-aware core.documentos,
-- automation_trigger_requests with REPROCESS, and the Hub read permissions. Do NOT re-apply any of
-- those migrations.
--
-- Delta implemented here (and nothing else):
--   1. ops.fn_resolver_ejecucion_para_reproceso(bigint) - NEW. Narrow, least-privilege read
--      primitive for the reprocess webhook. SECURITY DEFINER with a controlled search_path;
--      the only caller-supplied input is the execution id; the Caterpillar ownership check
--      (automatizacion.codigo = 'REMISIONES_CATERPILLAR') is part of the JOIN, so an execution of
--      any other automation is indistinguishable from a nonexistent one. EXECUTE is revoked from
--      PUBLIC and granted ONLY to the existing shared n8n_app role.
--   2. uq_ejecuciones_automatizacion_reproceso_unico - NEW partial UNIQUE index: a parent
--      execution may have at most one direct reprocess child. A precheck aborts (without touching
--      any data) if any parent already has more than one child.
--   3. ops.fn_crear_ejecucion_automatizacion(...) - REPLACED (same signature). The normal path is
--      unchanged; only the unique_violation handler gains one extra resolution step returning
--      ALREADY_REPROCESSED when the conflict is the existing direct child of the parent. CREATED,
--      ALREADY_PROCESSING, ALREADY_COMPLETED/ERROR/CANCELLED and REPROCESS_CREATED are unchanged.
--
-- Differences vs. the TEST 009 file (function bodies are copied verbatim):
--   * Runs ONLY against daubert_global (guard below); the TEST file has no guard.
--   * Grants EXECUTE to n8n_app (the existing production role shared with Remisiones Audi).
--     No new production role is created.
--   * Refuses to run unless ops.fn_crear_ejecucion_automatizacion is byte-equivalent (md5, CR
--     ignored) to the current production body (20260918_007), and unless none of the delta
--     objects exist yet - so it cannot silently overwrite an unknown version or run twice.
--   * Explicit duplicate-children precheck before the unique index.
--   * SET LOCAL lock_timeout so a blocked lock fails fast instead of waiting indefinitely.
--   * Wrapped in one transaction (BEGIN/COMMIT). CREATE UNIQUE INDEX is intentionally NOT
--     CONCURRENTLY (it cannot run inside a transaction); ops.ejecuciones_automatizacion is tiny.
--
-- Suggested order: run 20260923_009_caterpillar_manual_reprocess_prod.precheck.sql (read-only)
-- and record its baseline values, apply this file, then run ..._prod.postcheck.sql (read-only).
-- Rollback: 20260923_009_caterpillar_manual_reprocess_prod.down.sql.
BEGIN;

SET LOCAL lock_timeout = '10s';

DO $migration_guard$
DECLARE
    v_current_body text;
    v_duplicates text;
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION
            'Migration 20260923_009 is restricted to daubert_global; current database is %',
            current_database();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'n8n_app'
    ) THEN
        RAISE EXCEPTION 'Required production role n8n_app does not exist';
    END IF;

    IF to_regclass('ops.ejecuciones_automatizacion') IS NULL
       OR to_regclass('ops.automatizaciones') IS NULL
       OR to_regclass('core.documentos') IS NULL THEN
        RAISE EXCEPTION
            'Required tables ops.ejecuciones_automatizacion, ops.automatizaciones and core.documentos must exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ops'
          AND table_name = 'ejecuciones_automatizacion'
          AND column_name = 'reproceso_de_id'
    ) THEN
        RAISE EXCEPTION
            'Column ops.ejecuciones_automatizacion.reproceso_de_id does not exist (materialized by earlier phases)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ops.automatizaciones
        WHERE codigo = 'REMISIONES_CATERPILLAR'
    ) THEN
        RAISE EXCEPTION 'Automation REMISIONES_CATERPILLAR does not exist';
    END IF;

    IF to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)') IS NOT NULL THEN
        RAISE EXCEPTION
            'ops.fn_resolver_ejecucion_para_reproceso(bigint) already exists; this migration appears to be already applied';
    END IF;

    IF to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico') IS NOT NULL THEN
        RAISE EXCEPTION
            'ops.uq_ejecuciones_automatizacion_reproceso_unico already exists; this migration appears to be already applied';
    END IF;

    SELECT proc.prosrc
    INTO v_current_body
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)');

    IF v_current_body IS NULL THEN
        RAISE EXCEPTION 'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint) does not exist';
    END IF;

    IF md5(replace(v_current_body, chr(13), '')) <> '9b5ede68b149f2c43eca6ea2a25d1b2d' THEN
        RAISE EXCEPTION
            'ops.fn_crear_ejecucion_automatizacion does not match the expected pre-009 body (20260918_007): found md5 %, expected 9b5ede68b149f2c43eca6ea2a25d1b2d; refusing to overwrite an unknown version',
            md5(replace(v_current_body, chr(13), ''));
    END IF;

    -- Duplicate-children precheck. NEVER cleans data: it only aborts with the offending parents.
    SELECT string_agg(
               duplicate.reproceso_de_id::text || ' (' || duplicate.hijos || ' hijos)',
               ', ' ORDER BY duplicate.reproceso_de_id
           )
    INTO v_duplicates
    FROM (
        SELECT ejecucion.reproceso_de_id, count(*) AS hijos
        FROM ops.ejecuciones_automatizacion AS ejecucion
        WHERE ejecucion.reproceso_de_id IS NOT NULL
        GROUP BY ejecucion.reproceso_de_id
        HAVING count(*) > 1
    ) AS duplicate;

    IF v_duplicates IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot create uq_ejecuciones_automatizacion_reproceso_unico: parent executions with more than one direct child: %. Resolve manually; this migration never cleans data.',
            v_duplicates;
    END IF;
END;
$migration_guard$;

-- ---------------------------------------------------------
-- 1. Resolver function (copied verbatim from TEST 009)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.fn_resolver_ejecucion_para_reproceso(p_ejecucion_id bigint)
RETURNS TABLE(
    encontrada boolean,
    estado text,
    documento_origen_id bigint,
    ruta_archivo text,
    nombre_archivo text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'ops'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        TRUE,
        ejecucion.estado,
        ejecucion.documento_origen_id,
        documento.ruta_archivo,
        documento.nombre_archivo
    FROM ops.ejecuciones_automatizacion AS ejecucion
    JOIN ops.automatizaciones AS automatizacion
        ON automatizacion.automatizacion_id = ejecucion.automatizacion_id
       AND automatizacion.codigo = 'REMISIONES_CATERPILLAR'
    JOIN core.documentos AS documento
        ON documento.documento_id = ejecucion.documento_origen_id
    WHERE ejecucion.ejecucion_id = p_ejecucion_id;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT FALSE, NULL::text, NULL::bigint, NULL::text, NULL::text;
    END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION ops.fn_resolver_ejecucion_para_reproceso(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.fn_resolver_ejecucion_para_reproceso(bigint) TO n8n_app;

-- ---------------------------------------------------------
-- 2. One direct reprocess child per parent execution
-- ---------------------------------------------------------

CREATE UNIQUE INDEX uq_ejecuciones_automatizacion_reproceso_unico
    ON ops.ejecuciones_automatizacion (reproceso_de_id)
    WHERE reproceso_de_id IS NOT NULL;

-- ---------------------------------------------------------
-- 3. ops.fn_crear_ejecucion_automatizacion: idempotent reprocess retry
--    (copied verbatim from TEST 009; CREATE OR REPLACE preserves the existing ACL)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.fn_crear_ejecucion_automatizacion(p_automatizacion_codigo text, p_documento_origen_id bigint, p_n8n_execution_id text DEFAULT NULL::text, p_run_name text DEFAULT NULL::text, p_reproceso_de_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ejecucion_id bigint, ya_existia boolean, motivo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'ops'
AS $function$
DECLARE
    v_automatizacion_id bigint;
    v_automatizacion_estatus text;
    v_ejecucion_id bigint;

    v_existente_id bigint;
    v_existente_estado text;
BEGIN
    IF p_documento_origen_id IS NULL THEN
        RAISE EXCEPTION 'documento_origen_id is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT
        automatizacion.automatizacion_id,
        automatizacion.estatus
    INTO
        v_automatizacion_id,
        v_automatizacion_estatus
    FROM ops.automatizaciones AS automatizacion
    WHERE automatizacion.codigo =
        upper(btrim(p_automatizacion_codigo));

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Automation with code % does not exist',
            upper(btrim(p_automatizacion_codigo))
            USING ERRCODE = 'P0002';
    END IF;

    IF v_automatizacion_estatus <> 'ACTIVA' THEN
        RAISE EXCEPTION
            'Automation with code % is inactive',
            upper(btrim(p_automatizacion_codigo))
            USING ERRCODE = '55000';
    END IF;

    -- Ejecucion automatica normal.
    IF p_reproceso_de_id IS NULL THEN

        -- Si existe una ejecucion en curso, reutilizarla.
        SELECT
            ejecucion.ejecucion_id,
            ejecucion.estado
        INTO
            v_existente_id,
            v_existente_estado
        FROM ops.ejecuciones_automatizacion AS ejecucion
        WHERE ejecucion.automatizacion_id = v_automatizacion_id
          AND ejecucion.documento_origen_id = p_documento_origen_id
          AND ejecucion.estado = 'PROCESANDO'
        ORDER BY ejecucion.created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY
            SELECT
                v_existente_id,
                TRUE,
                'ALREADY_PROCESSING'::text;

            RETURN;
        END IF;

        -- Si no esta procesando, usar el estado terminal mas reciente,
        -- incluyendo reprocesos.
        SELECT
            ejecucion.ejecucion_id,
            ejecucion.estado
        INTO
            v_existente_id,
            v_existente_estado
        FROM ops.ejecuciones_automatizacion AS ejecucion
        WHERE ejecucion.automatizacion_id = v_automatizacion_id
          AND ejecucion.documento_origen_id = p_documento_origen_id
          AND ejecucion.estado IN (
              'COMPLETADA',
              'ERROR',
              'CANCELADA'
          )
        ORDER BY ejecucion.created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY
            SELECT
                v_existente_id,
                TRUE,
                CASE v_existente_estado
                    WHEN 'COMPLETADA' THEN 'ALREADY_COMPLETED'
                    WHEN 'ERROR' THEN 'ALREADY_ERROR'
                    WHEN 'CANCELADA' THEN 'ALREADY_CANCELLED'
                END::text;

            RETURN;
        END IF;
    END IF;

    BEGIN
        INSERT INTO ops.ejecuciones_automatizacion (
            automatizacion_id,
            documento_origen_id,
            n8n_execution_id,
            run_name,
            estado,
            reproceso_de_id
        )
        VALUES (
            v_automatizacion_id,
            p_documento_origen_id,
            p_n8n_execution_id,
            p_run_name,
            'PROCESANDO',
            p_reproceso_de_id
        )
        RETURNING ejecuciones_automatizacion.ejecucion_id
        INTO v_ejecucion_id;

    EXCEPTION WHEN unique_violation THEN

        SELECT
            ejecucion.ejecucion_id
        INTO
            v_ejecucion_id
        FROM ops.ejecuciones_automatizacion AS ejecucion
        WHERE ejecucion.automatizacion_id = v_automatizacion_id
          AND ejecucion.documento_origen_id = p_documento_origen_id
          AND ejecucion.estado = 'PROCESANDO'
        ORDER BY ejecucion.created_at DESC
        LIMIT 1;

        IF v_ejecucion_id IS NOT NULL THEN
            RETURN QUERY
            SELECT
                v_ejecucion_id,
                TRUE,
                'ALREADY_PROCESSING'::text;

            RETURN;
        END IF;

        -- No fue un conflicto de PROCESANDO concurrente. Si esta es una
        -- solicitud de reproceso, el unico otro conflicto posible es
        -- uq_ejecuciones_automatizacion_reproceso_unico: el padre ya
        -- tiene un hijo directo. Resolver de forma idempotente al hijo
        -- existente -- nunca se propaga un 23505 crudo al llamador
        -- (n8n/Hub). El invariante de un solo hijo directo NO se
        -- debilita: sigue enforced por la constraint; esto solo mejora
        -- el comportamiento ante una solicitud repetida.
        IF p_reproceso_de_id IS NOT NULL THEN
            SELECT
                ejecucion.ejecucion_id
            INTO
                v_ejecucion_id
            FROM ops.ejecuciones_automatizacion AS ejecucion
            WHERE ejecucion.reproceso_de_id = p_reproceso_de_id
            LIMIT 1;

            IF v_ejecucion_id IS NOT NULL THEN
                RETURN QUERY
                SELECT
                    v_ejecucion_id,
                    TRUE,
                    'ALREADY_REPROCESSED'::text;

                RETURN;
            END IF;
        END IF;

        RAISE;
    END;

    RETURN QUERY
    SELECT
        v_ejecucion_id,
        FALSE,
        CASE
            WHEN p_reproceso_de_id IS NULL
                THEN 'CREATED'
            ELSE 'REPROCESS_CREATED'
        END::text;
END;
$function$;

COMMIT;

-- Post-migration validation: every value should be true.
SELECT
    current_database() = 'daubert_global' AS database_is_daubert_global,
    to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)') IS NOT NULL AS resolver_exists,
    has_function_privilege('n8n_app', 'ops.fn_resolver_ejecucion_para_reproceso(bigint)', 'EXECUTE') AS resolver_n8n_app_execute,
    NOT has_function_privilege('public', 'ops.fn_resolver_ejecucion_para_reproceso(bigint)', 'EXECUTE') AS resolver_public_has_no_execute,
    to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico') IS NOT NULL AS reproceso_unique_index_exists,
    position('ALREADY_REPROCESSED' IN (
        SELECT proc.prosrc
        FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)')
    )) > 0 AS fn_crear_returns_already_reprocessed,
    has_function_privilege('n8n_app', 'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)', 'EXECUTE') AS fn_crear_n8n_app_execute;
