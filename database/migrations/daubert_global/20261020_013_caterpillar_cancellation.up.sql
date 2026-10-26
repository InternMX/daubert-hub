-- REVIEW ONLY. Not applied. Next local number after 012; confirm allocation before promotion.
-- Applies separately to TEST/PROD, under the existing postgres owner. No backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE v_role text; v_missing text;
BEGIN
  IF current_database() NOT IN ('daubert_hub_test', 'daubert_global') OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '013 requires the postgres owner in an explicitly allowed Daubert database';
  END IF;
  v_role := CASE current_database() WHEN 'daubert_global' THEN 'daubert_hub_app' ELSE 'daubert_hub_test_user' END;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
     OR to_regclass('operacion.remisiones') IS NULL OR to_regclass('security.users') IS NULL
     OR to_regclass('ops.ejecuciones_automatizacion') IS NULL THEN
    RAISE EXCEPTION '013 prerequisites missing';
  END IF;
  SELECT string_agg(x.rel || '.' || x.col, ', ') INTO v_missing
  FROM (VALUES
    ('operacion.remisiones','remision_id','bigint',true),
    ('operacion.remisiones','ejecucion_id','bigint',true),
    ('operacion.remisiones','estatus','text',true),
    ('operacion.remisiones','motivo_cancelacion','text',false),
    ('operacion.remisiones','updated_at','timestamp with time zone',true),
    ('ops.ejecuciones_automatizacion','ejecucion_id','bigint',true),
    ('ops.ejecuciones_automatizacion','automatizacion_id','bigint',true),
    ('ops.ejecuciones_automatizacion','estado','text',true),
    ('ops.automatizaciones','automatizacion_id','bigint',true),
    ('ops.automatizaciones','codigo','text',true),
    ('security.users','user_id','bigint',true),
    ('security.users','email','text',true),
    ('security.users','display_name','text',true),
    ('security.users','role','text',true),
    ('security.users','status','text',true),
    ('security.users','must_change_password','boolean',true)
  ) x(rel,col,typ,nn)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = to_regclass(x.rel)
    AND a.attname = x.col AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod) <> x.typ OR a.attnotnull <> x.nn;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION '013 incompatible columns: %', v_missing; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('operacion.remisiones','remision_id'),('security.users','user_id')) x(rel,col)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a
      ON a.attrelid=c.conrelid AND a.attname=x.col
      WHERE c.conrelid=to_regclass(x.rel) AND c.contype='p' AND c.conkey=ARRAY[a.attnum])) THEN
    RAISE EXCEPTION '013 prerequisite primary key incompatible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'operacion.remisiones'::regclass AND t.tgenabled = 'O'
        AND t.tgfoid = to_regprocedure('core.fn_actualizar_updated_at()')
        AND (t.tgtype::int & 19) = 19) THEN
    RAISE EXCEPTION '013 requires the enabled BEFORE ROW UPDATE timestamp trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role
      AND (rolsuper OR rolcreaterole OR rolbypassrls))
     OR has_schema_privilege(v_role,'operacion','CREATE')
     OR NOT has_schema_privilege(v_role,'operacion','USAGE')
     OR has_table_privilege(v_role,'operacion.remisiones','UPDATE,DELETE,TRUNCATE')
     OR has_any_column_privilege(v_role,'operacion.remisiones','UPDATE') THEN
    RAISE EXCEPTION '013 unsafe runtime role privileges; review drift before installing';
  END IF;
  IF to_regclass('operacion.cancelaciones_remisiones') IS NOT NULL
     OR to_regclass('operacion.cancelaciones_remisiones_cancelacion_id_seq') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='operacion' AND p.proname='fn_cancelar_remision_caterpillar') THEN
    RAISE EXCEPTION '013 objects already exist; refusing to overwrite';
  END IF;
END $guard$;

CREATE TABLE operacion.cancelaciones_remisiones (
  cancelacion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  remision_id bigint NOT NULL UNIQUE REFERENCES operacion.remisiones(remision_id) ON DELETE RESTRICT,
  motivo text NOT NULL CHECK (motivo = btrim(motivo) AND length(motivo) BETWEEN 1 AND 500),
  usuario_id bigint REFERENCES security.users(user_id) ON DELETE SET NULL,
  usuario_email text NOT NULL CHECK (btrim(usuario_email) <> ''),
  usuario_nombre text NOT NULL CHECK (btrim(usuario_nombre) <> ''),
  cancelada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id text CHECK (request_id IS NULL OR length(btrim(request_id)) BETWEEN 1 AND 200)
);

CREATE FUNCTION operacion.fn_cancelar_remision_caterpillar(
  p_ejecucion_id bigint, p_remision_id bigint, p_revision text, p_motivo text,
  p_usuario_id bigint, p_request_id text
) RETURNS TABLE (
  resultado text, remision_id bigint, motivo text, cancelacion_id bigint,
  usuario_id bigint, usuario_email text, usuario_nombre text, cancelada_en text, request_id text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_estado text;
  v_remision operacion.remisiones%ROWTYPE;
  v_email text;
  v_nombre text;
  v_resultado text;
BEGIN
  -- Coordinates removal with in-flight calls. Does not serialize independent cancellations.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('CAT_CANCEL_SCHEMA_013',0));
  IF p_ejecucion_id IS NULL OR p_ejecucion_id <= 0 OR p_remision_id IS NULL OR p_remision_id <= 0
     OR p_revision IS NULL OR p_revision !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
     OR p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 1 AND 500
     OR (p_request_id IS NOT NULL AND length(btrim(p_request_id)) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'CAT_CANCEL_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Actor comes from the authenticated Hub identity; snapshot authoritative name/email.
  -- This does NOT authenticate a human at the SQL boundary: the shared Hub login is trusted.
  -- Passing another ADMIN id with compromised runtime credentials remains possible; a GUC is
  -- equally forgeable. Keep credentials server-only and authenticate/authorize in the Hub.
  -- No credential columns are read. Authorization is enforced in the Hub AND here.
  SELECT u.email, u.display_name INTO v_email, v_nombre FROM security.users u
    WHERE u.user_id = p_usuario_id AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
      AND NOT u.must_change_password FOR SHARE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_CANCEL_FORBIDDEN' USING ERRCODE = 'PCA05'; END IF;

  -- Same lock order as finalization: execution first, then the exact remission.
  SELECT e.estado INTO v_estado FROM ops.ejecuciones_automatizacion e
    JOIN ops.automatizaciones a ON a.automatizacion_id = e.automatizacion_id
    WHERE e.ejecucion_id = p_ejecucion_id AND a.codigo = 'REMISIONES_CATERPILLAR'
    FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_CANCEL_NOT_FOUND' USING ERRCODE = 'PCA01'; END IF;
  SELECT r.* INTO v_remision FROM operacion.remisiones r
    WHERE r.remision_id = p_remision_id AND r.ejecucion_id = p_ejecucion_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAT_CANCEL_NOT_FOUND' USING ERRCODE = 'PCA01'; END IF;
  IF v_estado NOT IN ('COMPLETADA', 'ERROR', 'CANCELADA') THEN
    RAISE EXCEPTION 'CAT_CANCEL_EXECUTION_PROCESSING' USING ERRCODE = 'PCA02';
  END IF;

  IF v_remision.estatus = 'CANCELADA' THEN
    -- Retry wins over stale revision. Historical cancellations without a ledger stay historical:
    -- never manufacture an actor/date, replace their reason, or insert a second cancellation.
    v_resultado := 'ALREADY_CANCELLED';
  ELSE
    IF v_remision.estatus <> 'GENERADA' THEN
      RAISE EXCEPTION 'CAT_CANCEL_STATE' USING ERRCODE = 'PCA03';
    END IF;
    -- Exact six-microsecond-digit UTC representation; never parsed through a JS Date.
    IF to_char(v_remision.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') <> p_revision THEN
      RAISE EXCEPTION 'CAT_CANCEL_STALE' USING ERRCODE = 'PCA04';
    END IF;
    PERFORM set_config('app.origin', 'DAUBERT_HUB', true);
    PERFORM set_config('app.user_id', p_usuario_id::text, true);
    PERFORM set_config('app.user_email', v_email, true);
    PERFORM set_config('app.request_id', COALESCE(p_request_id, ''), true);
    UPDATE operacion.remisiones r SET estatus = 'CANCELADA', motivo_cancelacion = btrim(p_motivo)
      WHERE r.remision_id = p_remision_id;
    INSERT INTO operacion.cancelaciones_remisiones
      (remision_id, motivo, usuario_id, usuario_email, usuario_nombre, request_id)
      VALUES (p_remision_id, btrim(p_motivo), p_usuario_id, v_email, v_nombre, p_request_id);
    -- No EXCEPTION handler: a failed audit INSERT rolls back the remission UPDATE too.
    v_resultado := 'CANCELLED';
    v_remision.motivo_cancelacion := btrim(p_motivo);
  END IF;
  RETURN QUERY SELECT v_resultado, p_remision_id, v_remision.motivo_cancelacion,
    c.cancelacion_id, c.usuario_id, c.usuario_email, c.usuario_nombre,
    to_char(c.cancelada_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), c.request_id
    FROM (SELECT 1) one_row LEFT JOIN operacion.cancelaciones_remisiones c ON c.remision_id = p_remision_id;
END $fn$;

-- Strip any default ACLs on NEW objects only, then grant the environment's existing Hub role.
-- No UPDATE on remisiones, no direct ledger writes, no sequence privileges for the Hub or n8n.
DO $acl$
DECLARE r record; v_role text;
BEGIN
  FOR r IN SELECT DISTINCT acl.grantee FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(
      (CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) acl
    WHERE c.oid IN ('operacion.cancelaciones_remisiones'::regclass,
      'operacion.cancelaciones_remisiones_cancelacion_id_seq'::regclass) AND acl.grantee <> c.relowner
  LOOP
    v_role := CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END;
    EXECUTE 'REVOKE ALL ON operacion.cancelaciones_remisiones FROM ' || v_role;
    EXECUTE 'REVOKE ALL ON SEQUENCE operacion.cancelaciones_remisiones_cancelacion_id_seq FROM ' || v_role;
  END LOOP;
  FOR r IN SELECT DISTINCT acl.grantee FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)'::regprocedure
      AND acl.grantee <> p.proowner
  LOOP
    v_role := CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END;
    EXECUTE 'REVOKE ALL ON FUNCTION operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text) FROM ' || v_role;
  END LOOP;
  v_role := CASE current_database() WHEN 'daubert_global' THEN 'daubert_hub_app' ELSE 'daubert_hub_test_user' END;
  EXECUTE format('GRANT SELECT ON operacion.cancelaciones_remisiones TO %I', v_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text) TO %I', v_role);
END $acl$;
COMMIT;
