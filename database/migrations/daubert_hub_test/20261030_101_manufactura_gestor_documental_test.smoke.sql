-- =====================================================================================================================
-- SMOKE · manufactura (SOLO TEST, OPCIONAL, tras el postcheck) — comportamiento de integridad con el ROL DE LA APLICACIÓN
--
-- Se ejecuta con el rol de la app (NO administrador) y TODO queda dentro de una transacción que termina en ROLLBACK: no deja filas
-- (las identidades/secuencias consumen números; es normal). Verifica: actor desde la sesión, inmutabilidad, transiciones, PDF íntegro,
-- numeración de revisiones, concurrencia de borrador, variantes, confirmaciones, auditoría y ausencia de DDL/DELETE.
--
--   psql -h localhost -p 5432 -d daubert_hub_test -U daubert_hub_test_user -X -w -v ON_ERROR_STOP=1 \
--        -f 20261030_101_manufactura_gestor_documental_test.smoke.sql
-- Esperado: todas las filas con ok = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: ejecútelo con el rol de la aplicación, no con un administrador.'; END IF;
END $$;

CREATE TEMP TABLE _res (n serial, prueba text, ok boolean) ON COMMIT DROP;

DO $$
DECLARE
  v_uid bigint; v_email text; v_doc bigint; v_rev bigint; v_rev2 bigint; v_tok uuid; v_n int; v_h text; v_pdf bytea := convert_to('%PDF-1.4 smoke', 'UTF8');
  v_spec jsonb := '{"datos":{"codigo":"SMOKE001","ancho":"13"},"bind":{"Code":"SMOKE001"}}'::jsonb;
  v_cnt_audit_antes bigint; v_ok boolean; v_msg text;
BEGIN
  SELECT user_id, email INTO v_uid, v_email FROM security.users WHERE status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No hay usuarios activos para la prueba.'; END IF;
  SELECT count(*) INTO v_cnt_audit_antes FROM audit.cambios;

  -- T0. sin identidad de sesión no se escribe
  BEGIN
    INSERT INTO manufactura.documentos (codigo_dcmx, creado_por_usuario_id, creado_por_email) VALUES ('SMOKE001', 1, 'x');
    INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión: se rechaza', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión: se rechaza', true);
  END;

  PERFORM set_config('app.origin', 'DAUBERT_HUB', true); PERFORM set_config('app.request_id', 'smoke-1', true);
  PERFORM set_config('app.user_id', v_uid::text, true);  PERFORM set_config('app.user_email', v_email, true);

  -- T1. el actor sale de la sesión aunque se intente enviar otro
  INSERT INTO manufactura.documentos (codigo_dcmx, creado_por_usuario_id, creado_por_email) VALUES ('SMOKE001', v_uid + 999999, 'suplantado@example.invalid') RETURNING documento_id INTO v_doc;
  INSERT INTO _res (prueba, ok) SELECT 'actor de documento = sesión (no el enviado)', (creado_por_usuario_id = v_uid AND creado_por_email = v_email) FROM manufactura.documentos WHERE documento_id = v_doc;

  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
    VALUES (v_doc, 'BOLSA_PLANA_1', v_spec, 'Nombre Impreso', v_uid + 999999, 'otro@example.invalid', v_uid + 999999, 'otro@example.invalid', repeat('0', 64)) RETURNING revision_id INTO v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'borrador: actor = sesión, versión 1, hash calculado por la base', (creado_por_usuario_id = v_uid AND actualizado_por_usuario_id = v_uid AND version = 1 AND estado = 'BORRADOR'
        AND especificacion_sha256 = manufactura.fn_hash_json(especificacion) AND especificacion_sha256 <> repeat('0', 64) AND revision IS NULL) FROM manufactura.revisiones WHERE revision_id = v_rev;

  -- T2. una sola revisión abierta por documento
  BEGIN
    INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256) VALUES (v_doc, 'COEX', v_spec, 1, 'x', 1, 'x', repeat('0', 64));
    INSERT INTO _res (prueba, ok) VALUES ('un solo borrador abierto por documento', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _res (prueba, ok) VALUES ('un solo borrador abierto por documento', true);
  END;

  -- T3. no se crea directamente una revisión FINALIZADA
  BEGIN
    INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('SMOKE002') RETURNING documento_id INTO v_n;
    INSERT INTO manufactura.revisiones (documento_id, estado, revision, familia, especificacion, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256) VALUES (v_n, 'FINALIZADA', 1, 'COEX', v_spec, 1, 'x', 1, 'x', repeat('0', 64));
    INSERT INTO _res (prueba, ok) VALUES ('no se inserta una revisión FINALIZADA directamente', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se inserta una revisión FINALIZADA directamente', true);
  END;

  -- T4. edición con bloqueo optimista
  UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{datos,ancho}', '"14"'), version = version + 1 WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'edición de borrador: versión 2 y hash nuevo', (version = 2 AND especificacion_sha256 = manufactura.fn_hash_json(especificacion)) FROM manufactura.revisiones WHERE revision_id = v_rev;
  BEGIN
    UPDATE manufactura.revisiones SET elaboro_nombre = 'X', version = version + 5 WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('edición con versión incorrecta se rechaza', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('edición con versión incorrecta se rechaza', true);
  END;

  -- T5. las columnas de identidad no cambian
  BEGIN
    UPDATE manufactura.revisiones SET creado_por_usuario_id = v_uid + 1, version = version + 1 WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('no se reescribe el creador', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se reescribe el creador', true);
  END;

  -- T6. no se guardan credenciales en la copia
  BEGIN
    UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{bind,Authorization}', '"Bearer abc"'), version = version + 1 WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('la copia rechaza credenciales/tokens', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('la copia rechaza credenciales/tokens', true);
  END;

  -- T7. confirmación de revisión: acción autenticada ligada a versión y hash
  INSERT INTO manufactura.confirmaciones_revision (revision_id, usuario_id, usuario_email, usuario_nombre, version, especificacion_sha256) VALUES (v_rev, 1, 'x', 'x', 99, repeat('0', 64));
  INSERT INTO _res (prueba, ok) SELECT 'confirmación: actor, nombre, versión y hash tomados de la base', (c.usuario_id = v_uid AND c.version = r.version AND c.especificacion_sha256 = r.especificacion_sha256 AND c.usuario_nombre <> 'x')
    FROM manufactura.confirmaciones_revision c JOIN manufactura.revisiones r USING (revision_id) WHERE c.revision_id = v_rev;

  -- T8. finalización: cliente, elaboró y PDF
  UPDATE manufactura.revisiones SET elaboro_nombre = 'Nombre Impreso', elaboro_confirmado = true, cliente_nombre = 'Cliente de prueba (sin verificar)', cliente_verificado = false, version = version + 1 WHERE revision_id = v_rev;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev RETURNING finalizando_token INTO v_tok;
  INSERT INTO _res (prueba, ok) SELECT 'FINALIZANDO: token generado por la base y actor de la sesión', (v_tok IS NOT NULL AND finalizando_por_usuario_id = v_uid) FROM manufactura.revisiones WHERE revision_id = v_rev;
  BEGIN
    UPDATE manufactura.revisiones SET elaboro_nombre = 'Otro', version = version WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('contenido congelado durante la finalización', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('contenido congelado durante la finalización', true);
  END;
  BEGIN
    UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('no se finaliza sin PDF', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se finaliza sin PDF', true);
  END;
  v_h := encode(sha256(v_pdf), 'hex');
  BEGIN
    INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) VALUES (v_rev, v_h, octet_length(v_pdf), repeat('a', 64), 'SMOKE001_REV01.pdf', 1, 'x');
    INSERT INTO _res (prueba, ok) VALUES ('PDF de otra especificación se rechaza', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('PDF de otra especificación se rechaza', true);
  END;
  INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email)
    SELECT revision_id, v_h, octet_length(v_pdf), especificacion_sha256, 'SMOKE001_REV01.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = v_rev;
  BEGIN
    INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev, convert_to('%PDF-1.4 adulterado', 'UTF8'));
    INSERT INTO _res (prueba, ok) VALUES ('contenido con hash distinto se rechaza (integridad verificada por la base)', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('contenido con hash distinto se rechaza (integridad verificada por la base)', true);
  END;
  INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev, v_pdf);
  UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'FINALIZADA: revisión 1, finalizado_por = sesión, token limpiado', (revision = 1 AND finalizado_por_usuario_id = v_uid AND finalizado_en IS NOT NULL AND finalizando_token IS NULL AND estado = 'FINALIZADA') FROM manufactura.revisiones WHERE revision_id = v_rev;

  -- T9. inmutabilidad
  BEGIN UPDATE manufactura.revisiones SET elaboro_nombre = 'Cambio' WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada inmutable (UPDATE)', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada inmutable (UPDATE)', true); END;
  BEGIN DELETE FROM manufactura.revisiones WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada: sin DELETE para la aplicación', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada: sin DELETE para la aplicación', true); END;
  BEGIN UPDATE manufactura.pdfs SET bytes = 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('PDF inmutable: sin UPDATE', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('PDF inmutable: sin UPDATE', true); END;
  INSERT INTO _res (prueba, ok) SELECT 'el PDF almacenado coincide con su SHA-256', encode(sha256(c.contenido), 'hex') = p.pdf_sha256 FROM manufactura.pdf_contenidos c JOIN manufactura.pdfs p USING (revision_id) WHERE p.revision_id = v_rev;
  BEGIN INSERT INTO manufactura.confirmaciones_revision (revision_id, usuario_id, usuario_email, usuario_nombre, version, especificacion_sha256) VALUES (v_rev, 1, 'x', 'x', 1, repeat('0', 64));
    INSERT INTO _res (prueba, ok) VALUES ('no se registra revisión sobre una versión finalizada', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se registra revisión sobre una versión finalizada', true); END;

  -- T10. nueva revisión desde la versión finalizada
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, elaboro_confirmado, cliente_nombre, basada_en_revision_id, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
    SELECT documento_id, familia, especificacion, elaboro_nombre, true, cliente_nombre, revision_id, 1, 'x', 1, 'x', repeat('0', 64) FROM manufactura.revisiones WHERE revision_id = v_rev RETURNING revision_id INTO v_rev2;
  INSERT INTO _res (prueba, ok) SELECT 'nueva revisión: borrador nuevo basado en la finalizada (la anterior se conserva)', (r2.estado = 'BORRADOR' AND r2.basada_en_revision_id = v_rev AND r1.estado = 'FINALIZADA') FROM manufactura.revisiones r2, manufactura.revisiones r1 WHERE r2.revision_id = v_rev2 AND r1.revision_id = v_rev;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev2;
  v_pdf := convert_to('%PDF-1.4 smoke rev 2', 'UTF8');
  INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email)
    SELECT revision_id, encode(sha256(v_pdf), 'hex'), octet_length(v_pdf), especificacion_sha256, 'SMOKE001_REV02.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = v_rev2;
  INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev2, v_pdf);
  UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev2;
  INSERT INTO _res (prueba, ok) SELECT 'la segunda finalización recibe la revisión 2', revision = 2 FROM manufactura.revisiones WHERE revision_id = v_rev2;

  -- T11. variantes: un código puede tener varias hojas; (código, variante) es único; sin distinguir mayúsculas
  INSERT INTO manufactura.documentos (codigo_dcmx, variante) VALUES ('SMOKE001', 'Extendida');
  INSERT INTO _res (prueba, ok) SELECT 'mismo código con otra variante: permitido', count(*) = 2 FROM manufactura.documentos WHERE codigo_clave = 'smoke001';
  BEGIN INSERT INTO manufactura.documentos (codigo_dcmx, variante) VALUES ('smoke001', 'EXTENDIDA'); INSERT INTO _res (prueba, ok) VALUES ('(código, variante) duplicado se rechaza', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _res (prueba, ok) VALUES ('(código, variante) duplicado se rechaza', true); END;
  BEGIN INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('../etc/passwd'); INSERT INTO _res (prueba, ok) VALUES ('código inválido se rechaza', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('código inválido se rechaza', true); END;

  -- T12. auditoría con el usuario real
  SELECT count(*) INTO v_n FROM audit.cambios WHERE esquema = 'manufactura' AND usuario_id = v_uid::text AND request_id = 'smoke-1';
  INSERT INTO _res (prueba, ok) VALUES ('auditoría: filas en audit.cambios con el usuario y request reales (' || v_n || ')', v_n >= 10);
  INSERT INTO _res (prueba, ok) SELECT 'auditoría: el contenido binario del PDF NO se copia a audit.cambios', NOT EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'pdf_contenidos');

  -- T13. sin DDL
  BEGIN EXECUTE 'CREATE TABLE manufactura.intruso (id int)'; INSERT INTO _res (prueba, ok) VALUES ('la aplicación no puede crear objetos', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('la aplicación no puede crear objetos', true); END;
END $$;

SELECT n, prueba, ok FROM _res ORDER BY n;
SELECT bool_and(ok) AS smoke_all_pass, count(*) AS pruebas FROM _res;

ROLLBACK;
