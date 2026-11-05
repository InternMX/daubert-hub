-- GENERADO desde TEST 103 (20261105_103_manufactura_inventario_firmas_admin_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 014. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- SMOKE · manufactura 103 · inventario administrativo de firmas (SOLO RÉPLICA DESECHABLE; NO ejecutar en producción) — con el ROL DE LA APLICACIÓN
-- Todo queda dentro de una transacción que termina en ROLLBACK (sin residuos de negocio ni de auditoría). Requiere 1 ADMIN y 2 GENERAL activos.
--   psql -h localhost -p 5432 -d daubert_global -U daubert_hub_app -X -w -v ON_ERROR_STOP=1 -f 20261108_014_manufactura_inventario_firmas_admin_prod.smoke.sql
-- Esperado: todas las filas con ok = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
DO $$ BEGIN IF to_regnamespace('replica_desechable') IS NULL THEN RAISE EXCEPTION 'ABORTO: este script SOLO corre en la réplica desechable (no existe el esquema replica_desechable); NO se ejecuta en producción.'; END IF; END $$;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global.'; END IF; END $$;
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') AS audit_antes \gset
BEGIN;
DO $$ BEGIN IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: ejecútelo con el rol de la aplicación.'; END IF; END $$;
CREATE TEMP TABLE _res (n serial, prueba text, ok boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.yo(p_id bigint, p_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.request_id', 'smoke103-' || p_id, true), set_config('app.user_id', p_id::text, true), set_config('app.user_email', p_email, true) $$;

DO $$
DECLARE
  v_adm bigint; v_adm_e text; v_g1 bigint; v_g1_e text; v_g2 bigint; v_g2_e text; v_f1 bigint; v_pub uuid; v_n int; v_png bytea := '\x89504e470d0a1a0a0102030405'::bytea; v_sha text;
BEGIN
  SELECT user_id, email INTO v_adm, v_adm_e FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g1, v_g1_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g2, v_g2_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' AND user_id <> v_g1 ORDER BY user_id LIMIT 1;
  IF v_adm IS NULL OR v_g1 IS NULL OR v_g2 IS NULL THEN RAISE EXCEPTION 'Se requieren 1 ADMIN y 2 GENERAL activos.'; END IF;
  v_sha := encode(sha256(v_png), 'hex');

  -- T0. sin identidad de sesión no se devuelve nada
  PERFORM set_config('app.user_id', '', true); PERFORM set_config('app.user_email', '', true);
  BEGIN PERFORM * FROM manufactura.fn_firmas_inventario(); INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión: se rechaza', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión: se rechaza', true); END;

  -- T1. G1 registra una firma propia; G2 (GENERAL) no puede consultar el inventario
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
    VALUES (v_g1, 'x', 1, 'x', 1, 'x', 'image/png', 300, 100, octet_length(v_png), v_sha, v_png) RETURNING firma_id, public_id INTO v_f1, v_pub;
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  BEGIN PERFORM * FROM manufactura.fn_firmas_inventario(); INSERT INTO _res (prueba, ok) VALUES ('un usuario GENERAL no consulta el inventario', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('un usuario GENERAL no consulta el inventario', true); END;

  -- T2. el ADMIN inventaría la firma que registró OTRA persona, solo con metadatos
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  SELECT count(*) INTO v_n FROM manufactura.fn_firmas_inventario() i WHERE i.public_id = v_pub AND i.propietario_usuario_id = v_g1 AND i.cuenta_estado = 'ACTIVE' AND i.estado = 'ACTIVA' AND i.autorizaciones_vigentes = 0;
  INSERT INTO _res (prueba, ok) VALUES ('ADMIN ve la firma registrada por otro usuario (metadatos, cuenta, estado, autorizaciones vigentes)', v_n = 1);
  SELECT count(*) INTO v_n FROM manufactura.fn_firmas_inventario(v_g1) i WHERE i.public_id = v_pub;
  INSERT INTO _res (prueba, ok) VALUES ('el filtro por propietario funciona', v_n = 1);
  SELECT count(*) INTO v_n FROM manufactura.fn_firmas_inventario(p_sin_cuenta => true) i WHERE i.public_id = v_pub;
  INSERT INTO _res (prueba, ok) VALUES ('el filtro «sin cuenta» no incluye firmas con propietario', v_n = 0);
  BEGIN PERFORM * FROM manufactura.fn_firmas_inventario(v_g1, true); INSERT INTO _res (prueba, ok) VALUES ('propietario y «sin cuenta» a la vez se rechaza', false);
  EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO _res (prueba, ok) VALUES ('propietario y «sin cuenta» a la vez se rechaza', true); END;
  INSERT INTO _res (prueba, ok) VALUES ('la función no devuelve imagen (sin bytea en su resultado)', pg_get_function_result('manufactura.fn_firmas_inventario(bigint, boolean)'::regprocedure) !~* 'bytea|contenido|miniatura');

  -- T3. ser ADMIN no da la imagen ni el uso: la tabla sigue protegida por RLS y la autorización sigue siendo de la propietaria
  SELECT count(*) INTO v_n FROM manufactura.firmas WHERE firma_id = v_f1;
  INSERT INTO _res (prueba, ok) VALUES ('ADMIN sigue sin poder leer la firma ajena (ni su imagen) desde la tabla', v_n = 0);
  BEGIN INSERT INTO manufactura.firma_autorizaciones (firma_id, usuario_id) VALUES (v_f1, v_adm); INSERT INTO _res (prueba, ok) VALUES ('ADMIN no puede autorizarse el uso de la firma de otra persona', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('ADMIN no puede autorizarse el uso de la firma de otra persona', true); END;
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.firma_autorizaciones (firma_id, usuario_id) VALUES (v_f1, v_g2);
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  SELECT count(*) INTO v_n FROM manufactura.fn_firmas_inventario() i WHERE i.public_id = v_pub AND i.autorizaciones_vigentes = 1;
  INSERT INTO _res (prueba, ok) VALUES ('el inventario cuenta las autorizaciones vigentes sin revelar a quién', v_n = 1);

  -- T4. privilegios: la app no obtuvo nada más
  INSERT INTO _res (prueba, ok) VALUES ('PUBLIC no puede ejecutar la función y la app no ganó privilegios de tabla',
    NOT has_function_privilege('public', 'manufactura.fn_firmas_inventario(bigint, boolean)', 'EXECUTE') AND NOT has_table_privilege(current_user, 'manufactura.firmas', 'DELETE'));
END $$;

SELECT n, prueba, ok FROM _res ORDER BY n;
SELECT bool_and(ok) AS todas_ok, count(*) AS pruebas FROM _res;
ROLLBACK;
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') = :audit_antes AS sin_residuos_de_auditoria, NOT EXISTS (SELECT 1 FROM manufactura.firmas) AS sin_firmas_visibles;
