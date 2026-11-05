-- GENERADO desde TEST 103 (20261105_103_manufactura_inventario_firmas_admin_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 022. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- UP · manufactura · INVENTARIO ADMINISTRATIVO DE FIRMAS (SOLO PRODUCCIÓN: daubert_global)   [migración 103, adicional a la 101 y la 102]
--
-- PROBLEMA: con las políticas RLS de la 102 un ADMIN solo ve las firmas que él mismo registró o cuyo uso tiene autorizado, así que no puede inventariar las que registraron otros usuarios.
-- SOLUCIÓN MÍNIMA: UNA función de solo lectura, restringida a cuentas ADMIN, que devuelve METADATOS (nunca la imagen). No cambia ninguna política RLS, privilegio de tabla, trigger ni tabla.
--
-- ALCANCE (UNA transacción):
--   · CREA manufactura.fn_firmas_inventario(bigint, boolean): SECURITY DEFINER, STABLE, search_path fijo, valida la identidad de la sesión (app.user_id / app.user_email → ADMIN ACTIVO) y devuelve
--     descripción y estados. NO devuelve `contenido`, ni miniaturas, ni nombres de personas autorizadas (solo cuántas autorizaciones vigentes hay).
--   · Concede EXECUTE únicamente a daubert_hub_app (se revoca a PUBLIC).
--   · NO modifica tablas, políticas, triggers ni privilegios existentes; NO concede a nadie permiso de USO de ninguna firma (la autorización sigue siendo de la propietaria); NO toca daubert_global.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_022_manufactura_inventario_firmas_admin_prod.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.firmas') IS NULL OR to_regclass('manufactura.firma_autorizaciones') IS NULL OR to_regproc('manufactura.fn_actor_es_admin') IS NULL THEN
    RAISE EXCEPTION 'ABORTO: falta la migración 102 (o la 101).';
  END IF;
  IF to_regprocedure('manufactura.fn_firmas_inventario(bigint, boolean)') IS NOT NULL THEN RAISE EXCEPTION 'ABORTO: la migración 103 ya está aplicada (no se reaplica).'; END IF;
END $$;

CREATE FUNCTION manufactura.fn_firmas_inventario(p_propietario_usuario_id bigint DEFAULT NULL, p_sin_cuenta boolean DEFAULT false)
RETURNS TABLE (
  public_id uuid, propietario_usuario_id bigint, propietario_nombre text, cuenta_estado text, estado text, created_at timestamptz, retirada_en timestamptz,
  subida_por_nombre text, incorporada_por_nombre text, incorporada_por_usuario_id bigint, autorizaciones_vigentes integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, manufactura, security
AS $fn$
#variable_conflict use_column
BEGIN
  -- Identidad de la sesión (la fija la API desde la sesión autenticada): sin identidad o sin ser ADMIN ACTIVO no se devuelve nada.
  PERFORM manufactura.fn_actor();
  IF NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo un ADMIN activo puede consultar el inventario de firmas.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_propietario_usuario_id IS NOT NULL AND p_sin_cuenta THEN
    RAISE EXCEPTION 'Indica un propietario o «sin cuenta», no ambos.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT f.public_id, f.propietario_usuario_id, f.propietario_nombre, u.status::text, f.estado, f.created_at, f.retirada_en, s.display_name, i.display_name, f.incorporada_por_usuario_id,
           (SELECT count(*)::integer FROM manufactura.firma_autorizaciones a WHERE a.firma_id = f.firma_id AND a.revocada_en IS NULL)
      FROM manufactura.firmas f
      LEFT JOIN security.users u ON u.user_id = f.propietario_usuario_id
      LEFT JOIN security.users s ON s.user_id = f.subida_por_usuario_id
      LEFT JOIN security.users i ON i.user_id = f.incorporada_por_usuario_id
     WHERE (p_propietario_usuario_id IS NULL OR f.propietario_usuario_id = p_propietario_usuario_id)
       AND (NOT p_sin_cuenta OR f.propietario_usuario_id IS NULL)
     ORDER BY f.created_at DESC, f.firma_id DESC
     LIMIT 500;
END
$fn$;
COMMENT ON FUNCTION manufactura.fn_firmas_inventario(bigint, boolean) IS 'Inventario administrativo de firmas (solo ADMIN activo): metadatos y estados; nunca la imagen ni quiénes están autorizados.';

REVOKE ALL ON FUNCTION manufactura.fn_firmas_inventario(bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION manufactura.fn_firmas_inventario(bigint, boolean) TO daubert_hub_app;

DO $$
DECLARE v_f record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS resultado, pg_get_userbyid(p.proowner) AS dueno INTO v_f FROM pg_proc p WHERE p.oid = 'manufactura.fn_firmas_inventario(bigint, boolean)'::regprocedure;
  IF NOT v_f.prosecdef OR v_f.provolatile <> 's' THEN RAISE EXCEPTION 'La función debe ser SECURITY DEFINER y STABLE.'; END IF;
  IF v_f.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_f.proconfig) c WHERE c LIKE 'search_path=%') THEN RAISE EXCEPTION 'La función debe fijar search_path.'; END IF;
  IF v_f.resultado ~* 'bytea|contenido|miniatura' THEN RAISE EXCEPTION 'La función no puede devolver la imagen.'; END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = v_f.dueno) THEN RAISE EXCEPTION 'El dueño debe ser administrativo.'; END IF;
  IF has_function_privilege('public', 'manufactura.fn_firmas_inventario(bigint, boolean)', 'EXECUTE') THEN RAISE EXCEPTION 'PUBLIC no debe poder ejecutarla.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') <> 8 THEN RAISE EXCEPTION 'No debe haber tablas nuevas.'; END IF;
END $$;

SELECT 'UP_OK manufactura 103 (fn_firmas_inventario: solo metadatos, solo ADMIN, sin cambios en tablas ni RLS)' AS resultado;
COMMIT;
