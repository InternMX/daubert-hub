-- PRODUCTION-READY TEMPLATE - DO NOT APPLY TO daubert_global YET.
-- Rollback for 20260923_009_caterpillar_manual_reprocess_prod.up.sql (Phase 12C.2a, PROD).
--
-- Reverses, in reverse creation order:
--   3. restores ops.fn_crear_ejecucion_automatizacion to EXACTLY the production body that existed
--      before the up migration (functionally 20260918_007; md5 9b5ede68b149f2c43eca6ea2a25d1b2d, CR ignored) - the
--      ALREADY_REPROCESSED branch is removed. CREATE OR REPLACE preserves the existing ACL.
--   2. drops uq_ejecuciones_automatizacion_reproceso_unico.
--   1. revokes n8n_app EXECUTE and drops ops.fn_resolver_ejecucion_para_reproceso(bigint).
--
-- SAFETY: this rollback ABORTS (changes nothing) when any production reprocess execution exists
-- (reproceso_de_id IS NOT NULL). Without the one-direct-child unique index and the idempotent
-- ALREADY_REPROCESSED resolution, retries/double-clicks could create duplicate reprocess children
-- for existing reprocess history, so removing this infrastructure then is unsafe and must be a
-- deliberate manual decision. It NEVER deletes executions or any reprocess data.
-- It also aborts if the objects are not in the exact state the up migration leaves them in
-- (so a later manual edit of fn_crear is never silently overwritten).
BEGIN;

SET LOCAL lock_timeout = '10s';

DO $migration_guard$
DECLARE
    v_reprocess_rows bigint;
    v_current_body text;
BEGIN
    IF current_database() <> 'daubert_global' THEN
        RAISE EXCEPTION
            'Rollback 20260923_009 is restricted to daubert_global; current database is %',
            current_database();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'n8n_app'
    ) THEN
        RAISE EXCEPTION 'Required production role n8n_app does not exist';
    END IF;

    IF to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)') IS NULL THEN
        RAISE EXCEPTION
            'ops.fn_resolver_ejecucion_para_reproceso(bigint) does not exist; the up migration does not appear to be applied';
    END IF;

    IF to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico') IS NULL THEN
        RAISE EXCEPTION
            'ops.uq_ejecuciones_automatizacion_reproceso_unico does not exist; the up migration does not appear to be applied';
    END IF;

    SELECT count(*)
    INTO v_reprocess_rows
    FROM ops.ejecuciones_automatizacion
    WHERE reproceso_de_id IS NOT NULL;

    IF v_reprocess_rows > 0 THEN
        RAISE EXCEPTION
            'Refusing rollback: % production reprocess execution(s) (reproceso_de_id IS NOT NULL) exist. Removing the one-direct-child unique index and the ALREADY_REPROCESSED resolution while reprocess history exists is unsafe. Review manually; this rollback never deletes executions or reprocess data.',
            v_reprocess_rows;
    END IF;

    SELECT proc.prosrc
    INTO v_current_body
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)');

    IF v_current_body IS NULL THEN
        RAISE EXCEPTION 'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint) does not exist';
    END IF;

    IF md5(replace(v_current_body, chr(13), '')) <> '929939dcc7cd3ef0e09b7b2a868b9616' THEN
        RAISE EXCEPTION
            'ops.fn_crear_ejecucion_automatizacion does not match the 009 body this rollback expects: found md5 %, expected 929939dcc7cd3ef0e09b7b2a868b9616; refusing to overwrite an unknown version',
            md5(replace(v_current_body, chr(13), ''));
    END IF;
END;
$migration_guard$;

-- ---------------------------------------------------------
-- 3. Restore ops.fn_crear_ejecucion_automatizacion (pre-009 production body, 20260918_007)
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

        IF v_ejecucion_id IS NULL THEN
            RAISE;
        END IF;

        RETURN QUERY
        SELECT
            v_ejecucion_id,
            TRUE,
            'ALREADY_PROCESSING'::text;

        RETURN;
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

-- ---------------------------------------------------------
-- 2. Drop the one-direct-child invariant
-- ---------------------------------------------------------

DROP INDEX ops.uq_ejecuciones_automatizacion_reproceso_unico;

-- ---------------------------------------------------------
-- 1. Remove the resolver function and its n8n_app grant
-- ---------------------------------------------------------

REVOKE EXECUTE ON FUNCTION ops.fn_resolver_ejecucion_para_reproceso(bigint) FROM n8n_app;

DROP FUNCTION ops.fn_resolver_ejecucion_para_reproceso(bigint);

COMMIT;

-- Post-rollback validation: every value should be true.
SELECT
    current_database() = 'daubert_global' AS database_is_daubert_global,
    to_regprocedure('ops.fn_resolver_ejecucion_para_reproceso(bigint)') IS NULL AS resolver_removed,
    to_regclass('ops.uq_ejecuciones_automatizacion_reproceso_unico') IS NULL AS reproceso_unique_index_removed,
    position('ALREADY_REPROCESSED' IN (
        SELECT proc.prosrc
        FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)')
    )) = 0 AS fn_crear_no_longer_returns_already_reprocessed,
    md5(replace((
        SELECT proc.prosrc
        FROM pg_catalog.pg_proc AS proc
        WHERE proc.oid = to_regprocedure('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)')
    ), chr(13), '')) = '9b5ede68b149f2c43eca6ea2a25d1b2d' AS fn_crear_body_restored_to_pre_009,
    has_function_privilege('n8n_app', 'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)', 'EXECUTE') AS fn_crear_n8n_app_execute_preserved;
