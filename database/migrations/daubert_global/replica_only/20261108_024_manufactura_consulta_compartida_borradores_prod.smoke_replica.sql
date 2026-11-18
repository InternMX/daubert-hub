-- GENERADO desde TEST 105 (20261107_105_manufactura_consulta_compartida_borradores_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 024. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- SMOKE · manufactura 105 · consulta compartida de borradores (SOLO RÉPLICA DESECHABLE; NO ejecutar en producción) — con el ROL DE LA APLICACIÓN
-- Todo queda dentro de una transacción que termina en ROLLBACK (no deja documentos, revisiones ni auditoría). Requiere 1 ADMIN y 2 GENERAL activos.
--   psql -h localhost -p 5432 -d daubert_global -U daubert_hub_app -X -w -v ON_ERROR_STOP=1 -f 20261108_024_manufactura_consulta_compartida_borradores_prod.smoke.sql
-- Esperado: todas las filas con ok = true y smoke_all_pass = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
DO $$ BEGIN IF to_regnamespace('replica_desechable') IS NULL THEN RAISE EXCEPTION 'ABORTO: este script SOLO corre en la réplica desechable (no existe el esquema replica_desechable); NO se ejecuta en producción.'; END IF; END $$;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global.'; END IF; END $$;
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') AS audit_antes, (SELECT count(*) FROM manufactura.documentos) AS docs_antes, (SELECT count(*) FROM manufactura.revisiones) AS revs_antes \gset
BEGIN;
DO $$ BEGIN IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: ejecútelo con el rol de la aplicación.'; END IF; END $$;
CREATE TEMP TABLE _res (n serial, prueba text, ok boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.yo(p_id bigint, p_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.request_id', 'smoke105-' || p_id, true), set_config('app.user_id', p_id::text, true), set_config('app.user_email', p_email, true) $$;
CREATE FUNCTION pg_temp.sin_identidad() RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.user_id', '', true), set_config('app.user_email', '', true) $$;

DO $$
DECLARE
  v_adm bigint; v_adm_e text; v_g1 bigint; v_g1_e text; v_g2 bigint; v_g2_e text;
  v_doc bigint; v_rev bigint; v_doc2 bigint; v_rev2 bigint; v_doc3 bigint; v_rev3 bigint; v_n int; v_filas int;
  v_spec jsonb := '{"datos":{"codigo":"SMOKE105","ancho":"13"},"bind":{"Code":"SMOKE105"}}'::jsonb;
BEGIN
  SELECT user_id, email INTO v_adm, v_adm_e FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g1, v_g1_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g2, v_g2_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' AND user_id <> v_g1 ORDER BY user_id LIMIT 1;
  IF v_adm IS NULL OR v_g1 IS NULL OR v_g2 IS NULL THEN RAISE EXCEPTION 'Se requieren 1 ADMIN y 2 GENERAL activos.'; END IF;

  -- G1 crea tres documentos: un borrador (A), otro que pasará a FINALIZANDO (B) y otro que se descartará (C).
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('SMOKE105A') RETURNING documento_id INTO v_doc;
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256, entorno_emision)
    VALUES (v_doc, 'BOLSA_PLANA_1', v_spec, 'Nombre', v_g1, v_g1_e, v_g1, v_g1_e, repeat('0', 64), 'PRODUCCION') RETURNING revision_id INTO v_rev;
  INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('SMOKE105B') RETURNING documento_id INTO v_doc2;
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256, entorno_emision)
    VALUES (v_doc2, 'BOLSA_PLANA_1', v_spec, 'Nombre', v_g1, v_g1_e, v_g1, v_g1_e, repeat('0', 64), 'PRODUCCION') RETURNING revision_id INTO v_rev2;
  INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('SMOKE105C') RETURNING documento_id INTO v_doc3;
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256, entorno_emision)
    VALUES (v_doc3, 'BOLSA_PLANA_1', v_spec, 'Nombre', v_g1, v_g1_e, v_g1, v_g1_e, repeat('0', 64), 'PRODUCCION') RETURNING revision_id INTO v_rev3;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev2;
  UPDATE manufactura.revisiones SET estado = 'DESCARTADA' WHERE revision_id = v_rev3;
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id IN (v_rev, v_rev2, v_rev3);
  INSERT INTO _res (prueba, ok) VALUES ('el creador ve sus tres revisiones (borrador, finalizando, descartada)', v_n = 3);

  -- G2 (otra cuenta GENERAL): consulta borrador y finalización en curso; la descartada no.
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno ve el BORRADOR', EXISTS (SELECT 1 FROM manufactura.revisiones WHERE revision_id = v_rev AND estado = 'BORRADOR'));
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno ve la FINALIZACIÓN EN CURSO', EXISTS (SELECT 1 FROM manufactura.revisiones WHERE revision_id = v_rev2 AND estado = 'FINALIZANDO'));
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO ve la DESCARTADA', NOT EXISTS (SELECT 1 FROM manufactura.revisiones WHERE revision_id = v_rev3));
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno ve el documento del borrador (código)', EXISTS (SELECT 1 FROM manufactura.documentos WHERE documento_id = v_doc));

  -- ...pero NO modifica, descarta, finaliza ni borra (SQL directo con el rol de la aplicación).
  UPDATE manufactura.revisiones SET elaboro_nombre = 'Intruso', version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO modifica el borrador (0 filas)', v_filas = 0);
  UPDATE manufactura.revisiones SET estado = 'DESCARTADA', version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO descarta el borrador (0 filas)', v_filas = 0);
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO inicia la finalización del borrador (0 filas)', v_filas = 0);
  UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE revision_id = v_rev2; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO cancela la finalización en curso (0 filas)', v_filas = 0);
  BEGIN DELETE FROM manufactura.revisiones WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO borra el borrador', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO borra el borrador', true); END;
  BEGIN INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre) VALUES (v_rev, 2, 'REVISO', 'Intruso'); INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO agrega responsables al borrador', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('GENERAL ajeno NO agrega responsables al borrador', true); END;

  -- Sin identidad de sesión no se ve ningún borrador.
  PERFORM pg_temp.sin_identidad();
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id IN (v_rev, v_rev2, v_rev3);
  INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión no se ve ningún borrador', v_n = 0);

  -- ADMIN: consulta todo (incluida la descartada) y conserva su permiso de modificar.
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id IN (v_rev, v_rev2, v_rev3);
  INSERT INTO _res (prueba, ok) VALUES ('ADMIN ve las tres revisiones', v_n = 3);
  UPDATE manufactura.revisiones SET elaboro_nombre = 'Admin edita', version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('ADMIN conserva su permiso de modificar un borrador ajeno', v_filas = 1);

  -- El creador sigue editando normalmente.
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  UPDATE manufactura.revisiones SET elaboro_nombre = 'Creador edita', version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('el creador sigue modificando su borrador', v_filas = 1);
END $$;

SELECT n, prueba, ok FROM _res ORDER BY n;
SELECT bool_and(ok) AS smoke_all_pass, count(*) AS pruebas FROM _res;
ROLLBACK;

SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') = :audit_antes AS sin_residuos_de_auditoria,
       (SELECT count(*) FROM manufactura.documentos) = :docs_antes AND (SELECT count(*) FROM manufactura.revisiones) = :revs_antes AS sin_residuos_de_negocio;
