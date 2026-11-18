-- GENERADO desde TEST 102 (20261103_102_manufactura_responsables_firmas_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 021. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- SMOKE · manufactura 102 · responsables y firmas (SOLO RÉPLICA DESECHABLE; NO ejecutar en producción) — con el ROL DE LA APLICACIÓN
-- Todo queda dentro de una transacción que termina en ROLLBACK: no deja filas de negocio ni de auditoría (solo huecos en las secuencias). Requiere 1 ADMIN y 2 GENERAL activos.
--   psql -h localhost -p 5432 -d daubert_global -U daubert_hub_app -X -w -v ON_ERROR_STOP=1 -f 20261108_021_manufactura_responsables_firmas_prod.smoke.sql
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
  SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.request_id', 'smoke102-' || p_id, true), set_config('app.user_id', p_id::text, true), set_config('app.user_email', p_email, true) $$;

DO $$
DECLARE
  v_adm bigint; v_adm_e text; v_g1 bigint; v_g1_e text; v_g2 bigint; v_g2_e text; v_doc bigint; v_rev bigint; v_f1 bigint; v_f2 bigint; v_n int;
  v_png bytea := '\x89504e470d0a1a0a0102030405'::bytea; v_sha text;
BEGIN
  SELECT user_id, email INTO v_adm, v_adm_e FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g1, v_g1_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g2, v_g2_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' AND user_id <> v_g1 ORDER BY user_id LIMIT 1;
  IF v_adm IS NULL OR v_g1 IS NULL OR v_g2 IS NULL THEN RAISE EXCEPTION 'Se requieren 1 ADMIN y 2 GENERAL activos.'; END IF;
  v_sha := encode(sha256(v_png), 'hex');

  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
    VALUES (v_g1, 'Nombre declarado', v_adm, 'otro', v_adm, 'otro', 'image/png', 300, 100, octet_length(v_png), v_sha, v_png) RETURNING firma_id INTO v_f1;
  INSERT INTO _res (prueba, ok) SELECT 'firma propia: el nombre sale de la cuenta y el actor de la sesión (no lo declarado)', (propietario_nombre = u.display_name AND subida_por_usuario_id = v_g1 AND incorporada_por_usuario_id = v_g1)
    FROM manufactura.firmas f JOIN security.users u ON u.user_id = v_g1 WHERE f.firma_id = v_f1;
  BEGIN INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
          VALUES (v_g2, 'x', 1, 'x', 1, 'x', 'image/png', 10, 10, octet_length(v_png), v_sha, v_png);
        INSERT INTO _res (prueba, ok) VALUES ('un GENERAL no incorpora la firma de otra persona', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('un GENERAL no incorpora la firma de otra persona', true); END;
  BEGIN INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
          VALUES (v_g1, 'x', 1, 'x', 1, 'x', 'image/svg+xml', 10, 10, octet_length(v_png), v_sha, v_png);
        INSERT INTO _res (prueba, ok) VALUES ('solo JPG/PNG (SVG rechazado por la base)', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('solo JPG/PNG (SVG rechazado por la base)', true); END;

  PERFORM pg_temp.yo(v_g2, v_g2_e);
  SELECT count(*) INTO v_n FROM manufactura.firmas WHERE firma_id = v_f1;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: otro usuario no ve la firma ajena sin autorización', v_n = 0);

  PERFORM pg_temp.yo(v_adm, v_adm_e);
  INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
    VALUES (NULL, 'Persona sin cuenta', 1, 'x', 1, 'x', 'image/png', 300, 100, octet_length(v_png), v_sha, v_png) RETURNING firma_id INTO v_f2;
  INSERT INTO _res (prueba, ok) SELECT 'ADMIN incorpora la firma de una persona sin cuenta: queda constancia y custodia', (incorporada_por_usuario_id = v_adm AND EXISTS (SELECT 1 FROM manufactura.firma_autorizaciones a WHERE a.firma_id = f.firma_id AND a.usuario_id = v_adm))
    FROM manufactura.firmas f WHERE f.firma_id = v_f2;

  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('SMOKE102') RETURNING documento_id INTO v_doc;
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256, entorno_emision)
    VALUES (v_doc, 'BOLSA_PLANA_1', '{"datos":{"codigo":"SMOKE102"}}', 'Nombre', v_g1, 'x', v_g1, 'x', repeat('0', 64), 'PRODUCCION') RETURNING revision_id INTO v_rev;
  INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre, firma_id) VALUES (v_rev, 1, 'GENERO', 'Nombre cambiado a mano', v_f1);
  INSERT INTO _res (prueba, ok) SELECT 'con imagen el nombre impreso es el de su propietaria y se guarda la huella de la imagen', (nombre = u.display_name AND firma_sha256 = v_sha)
    FROM manufactura.revision_responsables r JOIN security.users u ON u.user_id = v_g1 WHERE r.revision_id = v_rev AND r.posicion = 1;
  INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre) VALUES (v_rev, 2, 'GENERO', 'Otro'), (v_rev, 3, 'GENERO', 'Otro más');
  INSERT INTO _res (prueba, ok) VALUES ('hasta 3 responsables y funciones repetidas', (SELECT count(*) FROM manufactura.revision_responsables WHERE revision_id = v_rev) = 3);
  BEGIN INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre, firma_id) VALUES (v_rev, 2, 'REVISO', 'x', NULL); INSERT INTO _res (prueba, ok) VALUES ('posición duplicada rechazada', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _res (prueba, ok) VALUES ('posición duplicada rechazada', true); END;
  BEGIN UPDATE manufactura.revision_responsables SET firma_id = v_f2 WHERE revision_id = v_rev AND posicion = 2; INSERT INTO _res (prueba, ok) VALUES ('no se puede usar una firma sin autorización de uso', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('no se puede usar una firma sin autorización de uso', true); END;
  BEGIN DELETE FROM manufactura.firmas WHERE firma_id = v_f1; INSERT INTO _res (prueba, ok) VALUES ('la aplicación no borra firmas', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('la aplicación no borra firmas', true); END;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev;
  BEGIN UPDATE manufactura.revision_responsables SET nombre = 'Cambio tardío' WHERE revision_id = v_rev AND posicion = 2; INSERT INTO _res (prueba, ok) VALUES ('en finalización los responsables están congelados', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('en finalización los responsables están congelados', true); END;
  INSERT INTO _res (prueba, ok) VALUES ('auditoría escrita sin copiar el contenido de la imagen',
    EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'firmas') AND NOT EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'firmas' AND datos_nuevos ? 'contenido'));
END $$;

SELECT n, prueba, ok FROM _res ORDER BY n;
SELECT bool_and(ok) AS todas_ok, count(*) AS pruebas FROM _res;
ROLLBACK;
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') = :audit_antes AS sin_residuos_de_auditoria,
       NOT EXISTS (SELECT 1 FROM manufactura.firmas) AS sin_firmas_visibles;
