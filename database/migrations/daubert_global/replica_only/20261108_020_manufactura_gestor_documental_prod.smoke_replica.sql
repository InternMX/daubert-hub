-- GENERADO desde TEST 101 (20261030_101_manufactura_gestor_documental_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 020. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- SMOKE · manufactura (SOLO RÉPLICA DESECHABLE; NO ejecutar en producción) — comportamiento de integridad y permisos con el ROL DE LA APLICACIÓN
-- [revisión 3: validación estructural de la copia (palabras legítimas aceptadas), auditoría redactora y comprobación de que NO quedan residuos]
--
-- Se ejecuta con el rol de la app (NO administrador) y TODO queda dentro de una transacción que termina en ROLLBACK: no deja filas, ni de negocio ni de auditoría
-- (lo único permanente son los números que consumen las secuencias de identidad: huecos en los ids). Al terminar, el propio script lo comprueba. Requiere ≥ 1 usuario ADMIN activo y ≥ 2 usuarios GENERAL activos.
--
--   psql -h localhost -p 5432 -d daubert_global -U daubert_hub_app -X -w -v ON_ERROR_STOP=1 \
--        -f 20261108_020_manufactura_gestor_documental_prod.smoke.sql
-- Esperado: todas las filas con ok = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
DO $$ BEGIN IF to_regnamespace('replica_desechable') IS NULL THEN RAISE EXCEPTION 'ABORTO: este script SOLO corre en la réplica desechable (no existe el esquema replica_desechable); NO se ejecuta en producción.'; END IF; END $$;
DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
END $$;

-- Línea base de residuos (antes de escribir nada): filas de auditoría de manufactura y filas visibles sin identidad (solo finalizadas).
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') AS audit_antes,
       (SELECT count(*) FROM manufactura.documentos) AS docs_antes, (SELECT count(*) FROM manufactura.revisiones) AS revs_antes,
       (SELECT count(*) FROM manufactura.pdfs) AS pdfs_antes \gset
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: ejecútelo con el rol de la aplicación, no con un administrador.'; END IF;
END $$;

CREATE TEMP TABLE _res (n serial, prueba text, ok boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.yo(p_id bigint, p_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.request_id', 'smoke-' || p_id, true), set_config('app.user_id', p_id::text, true), set_config('app.user_email', p_email, true) $$;
CREATE FUNCTION pg_temp.sin_identidad() RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.user_id', '', true), set_config('app.user_email', '', true) $$;

DO $$
DECLARE
  v_adm bigint; v_adm_e text; v_g1 bigint; v_g1_e text; v_g2 bigint; v_g2_e text;
  v_doc bigint; v_doc2 bigint; v_rev bigint; v_rev2 bigint; v_rev3 bigint; v_n int; v_h1 text; v_h2 text;
  v_spec jsonb := '{"datos":{"codigo":"SMOKE001","ancho":"13"},"bind":{"Code":"SMOKE001"}}'::jsonb;
  v_pdf bytea := convert_to('%PDF-1.4 smoke', 'UTF8'); v_filas int; v_nombre text;
BEGIN
  SELECT user_id, email INTO v_adm, v_adm_e FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g1, v_g1_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g2, v_g2_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' AND user_id <> v_g1 ORDER BY user_id LIMIT 1;
  IF v_adm IS NULL OR v_g1 IS NULL OR v_g2 IS NULL THEN RAISE EXCEPTION 'Se requieren 1 ADMIN y 2 GENERAL activos.'; END IF;

  -- T0. sin identidad de sesión no se escribe
  PERFORM pg_temp.sin_identidad();
  BEGIN INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('SMOKE001'); INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión: se rechaza', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión: se rechaza', true); END;

  -- T1. G1 crea documento y borrador; el actor sale de la sesión aunque se intente enviar otro
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.documentos (codigo_dcmx, creado_por_usuario_id, creado_por_email) VALUES ('SMOKE001', v_adm, 'suplantado@example.invalid') RETURNING documento_id INTO v_doc;
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256, entorno_emision)
    VALUES (v_doc, 'BOLSA_PLANA_1', v_spec, 'Nombre Impreso', v_adm, 'otro@example.invalid', v_adm, 'otro@example.invalid', repeat('0', 64), 'PRODUCCION') RETURNING revision_id INTO v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'actor de documento y borrador = sesión (no el enviado); versión 1; huella calculada por la base',
    (d.creado_por_usuario_id = v_g1 AND r.creado_por_usuario_id = v_g1 AND r.actualizado_por_usuario_id = v_g1 AND r.version = 1 AND r.estado = 'BORRADOR'
     AND r.especificacion_sha256 = manufactura.fn_hash_revision(r.familia, r.especificacion) AND r.especificacion_sha256 <> repeat('0', 64))
    FROM manufactura.documentos d JOIN manufactura.revisiones r USING (documento_id) WHERE r.revision_id = v_rev;
  BEGIN UPDATE manufactura.revisiones SET entorno_emision = 'PRUEBA', version = version + 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('entorno_emision solo admite PRODUCCION', false);
  EXCEPTION WHEN check_violation OR integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('entorno_emision solo admite PRODUCCION', true); END;

  -- T2. visibilidad por filas: el borrador solo lo ve su creador, su revisor asignado y un ADMIN
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: otro usuario GENERAL no ve el borrador ajeno', v_n = 0);
  SELECT count(*) INTO v_n FROM manufactura.documentos WHERE documento_id = v_doc;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: tampoco ve el documento que solo tiene un borrador ajeno', v_n = 0);
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: ADMIN ve el borrador', v_n = 1);

  -- T3. asignar revisor: solo el creador (o ADMIN); el revisor asignado ve el borrador pero NO puede modificarlo
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  UPDATE manufactura.revisiones SET revisor_usuario_id = v_g2, version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('un tercero no puede asignarse como revisor (0 filas)', v_filas = 0);
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  UPDATE manufactura.revisiones SET revisor_usuario_id = v_g2, version = version + 1 WHERE revision_id = v_rev;
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: el revisor asignado ve el borrador', v_n = 1);
  UPDATE manufactura.revisiones SET elaboro_nombre = 'Revisor edita', version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('el revisor NO puede modificar los datos (0 filas)', v_filas = 0);

  -- T4. revisión autenticada, ligada a la huella; autorrevisión con constancia; invalidación por cambio técnico
  INSERT INTO manufactura.confirmaciones_revision (revision_id, usuario_id, usuario_email, usuario_nombre, version, especificacion_sha256, es_autorrevision, como_revisor_asignado)
    VALUES (v_rev, v_adm, 'x', 'x', 99, repeat('0', 64), true, false);
  INSERT INTO _res (prueba, ok) SELECT 'confirmación del revisor: actor/nombre/versión/huella tomados de la base; no es autorrevisión; como revisor asignado',
    (c.usuario_id = v_g2 AND c.usuario_nombre <> 'x' AND c.version = r.version AND c.especificacion_sha256 = r.especificacion_sha256 AND NOT c.es_autorrevision AND c.como_revisor_asignado)
    FROM manufactura.confirmaciones_revision c JOIN manufactura.revisiones r USING (revision_id) WHERE c.revision_id = v_rev AND c.usuario_id = v_g2;
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.confirmaciones_revision (revision_id, usuario_id, usuario_email, usuario_nombre, version, especificacion_sha256, es_autorrevision, como_revisor_asignado) VALUES (v_rev, 1, 'x', 'x', 1, repeat('0', 64), false, true);
  INSERT INTO _res (prueba, ok) SELECT 'autorrevisión permitida con constancia (es_autorrevision = true)', es_autorrevision AND NOT como_revisor_asignado FROM manufactura.confirmaciones_revision WHERE revision_id = v_rev AND usuario_id = v_g1;
  SELECT especificacion_sha256 INTO v_h1 FROM manufactura.revisiones WHERE revision_id = v_rev;
  UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{datos,ancho}', '"14"'), version = version + 1 WHERE revision_id = v_rev;
  SELECT especificacion_sha256 INTO v_h2 FROM manufactura.revisiones WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) VALUES ('un cambio técnico cambia la huella: las confirmaciones previas quedan sin vigencia', v_h1 <> v_h2 AND NOT EXISTS (SELECT 1 FROM manufactura.confirmaciones_revision WHERE revision_id = v_rev AND especificacion_sha256 = v_h2));
  UPDATE manufactura.revisiones SET familia = 'HOJA_PAQ', version = version + 1 WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'cambiar la familia también cambia la huella', especificacion_sha256 <> v_h2 FROM manufactura.revisiones WHERE revision_id = v_rev;
  UPDATE manufactura.revisiones SET familia = 'BOLSA_PLANA_1', version = version + 1 WHERE revision_id = v_rev;

  -- T5. integridad de edición
  BEGIN UPDATE manufactura.revisiones SET elaboro_nombre = 'X', version = version + 5 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('edición con versión incorrecta se rechaza', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('edición con versión incorrecta se rechaza', true); END;
  BEGIN UPDATE manufactura.revisiones SET creado_por_usuario_id = v_g2, version = version + 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('no se reescribe el creador', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se reescribe el creador', true); END;
  -- (revisión 3) las descripciones legítimas con palabras como TOKEN, SECRET o PASSWORD se ACEPTAN: solo se valida la estructura (claves), no el texto de los valores
  UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{datos,descripcion}', '"BOLSA TOKEN SECRET PASSWORD AUTHORIZATION BEARER KEY 20 X 30"'), version = version + 1 WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('una descripción legítima con TOKEN/SECRET/PASSWORD/AUTHORIZATION/BEARER se acepta', v_filas = 1);
  BEGIN UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{bind,Authorization}', '"Bearer abc"'), version = version + 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('la copia rechaza una clave Authorization en bind', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('la copia rechaza una clave Authorization en bind', true); END;
  BEGIN UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{datos,apiToken}', '"x"'), version = version + 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('la copia rechaza una clave con nombre de credencial en cualquier nivel', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('la copia rechaza una clave con nombre de credencial en cualquier nivel', true); END;
  BEGIN UPDATE manufactura.revisiones SET especificacion = jsonb_set(especificacion, '{bind,Cost}', '99'), version = version + 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('bind solo admite los 6 campos permitidos (sin costos ni ID)', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('bind solo admite los 6 campos permitidos (sin costos ni ID)', true); END;
  BEGIN UPDATE manufactura.revisiones SET especificacion = especificacion || '{"extra":1}', version = version + 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('no se admiten claves de primer nivel desconocidas', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se admiten claves de primer nivel desconocidas', true); END;
  BEGIN INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256) VALUES (v_doc, 'COEX', v_spec, 1, 'x', 1, 'x', repeat('0', 64));
    INSERT INTO _res (prueba, ok) VALUES ('un solo borrador abierto por documento', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _res (prueba, ok) VALUES ('un solo borrador abierto por documento', true); END;
  BEGIN INSERT INTO manufactura.revisiones (documento_id, estado, revision, familia, especificacion, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
          VALUES (v_doc, 'FINALIZADA', 1, 'COEX', v_spec, 1, 'x', 1, 'x', repeat('0', 64));
    INSERT INTO _res (prueba, ok) VALUES ('no se inserta una revisión FINALIZADA directamente', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se inserta una revisión FINALIZADA directamente', true); END;

  -- T6. finalización: solo el creador o ADMIN; «Elaboró» confirmado y cliente son obligatorios; revisión prevista; nombre del PDF
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev; GET DIAGNOSTICS v_filas = ROW_COUNT;
  INSERT INTO _res (prueba, ok) VALUES ('el revisor no puede iniciar la finalización (0 filas)', v_filas = 0);
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  UPDATE manufactura.revisiones SET elaboro_nombre = 'Nombre Impreso', elaboro_confirmado = false, cliente_nombre = 'Cliente de prueba (sin verificar)', cliente_verificado = false, version = version + 1 WHERE revision_id = v_rev;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'FINALIZANDO: token generado por la base, revisión prevista = 1 y actor de la sesión', (finalizando_token IS NOT NULL AND revision_prevista = 1 AND finalizando_por_usuario_id = v_g1) FROM manufactura.revisiones WHERE revision_id = v_rev;
  BEGIN UPDATE manufactura.revisiones SET elaboro_nombre = 'Otro', version = version WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('contenido congelado durante la finalización', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('contenido congelado durante la finalización', true); END;
  BEGIN UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('no se reclama una finalización reciente (< 10 min)', false);
  EXCEPTION WHEN lock_not_available THEN INSERT INTO _res (prueba, ok) VALUES ('no se reclama una finalización reciente (< 10 min)', true); END;
  BEGIN UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('no se finaliza sin PDF', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se finaliza sin PDF', true); END;
  v_nombre := 'SMOKE001_REV01.pdf';
  BEGIN INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) SELECT revision_id, encode(sha256(v_pdf), 'hex'), octet_length(v_pdf), especificacion_sha256, 'SMOKE001_REV02.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('el nombre del PDF debe corresponder a la revisión prevista (REV01)', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('el nombre del PDF debe corresponder a la revisión prevista (REV01)', true); END;
  BEGIN INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) VALUES (v_rev, encode(sha256(v_pdf), 'hex'), octet_length(v_pdf), repeat('a', 64), v_nombre, 1, 'x');
    INSERT INTO _res (prueba, ok) VALUES ('PDF de otra especificación se rechaza', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('PDF de otra especificación se rechaza', true); END;
  -- «Elaboró» sin confirmar: la transición final se rechaza aunque el PDF exista (todo el intento se revierte)
  BEGIN
    INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) SELECT revision_id, encode(sha256(v_pdf), 'hex'), octet_length(v_pdf), especificacion_sha256, v_nombre, 1, 'x' FROM manufactura.revisiones WHERE revision_id = v_rev;
    INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev, v_pdf);
    UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev;
    INSERT INTO _res (prueba, ok) VALUES ('no se finaliza con «Elaboró» sin confirmar', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se finaliza con «Elaboró» sin confirmar (el intento completo se revierte)', true); END;
  INSERT INTO _res (prueba, ok) SELECT 'tras el intento fallido no quedó PDF huérfano', NOT EXISTS (SELECT 1 FROM manufactura.pdfs WHERE revision_id = v_rev);
  -- recuperación: volver a borrador, confirmar «Elaboró» y repetir
  UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'recuperación: FINALIZANDO → BORRADOR limpia token y revisión prevista', (finalizando_token IS NULL AND revision_prevista IS NULL AND estado = 'BORRADOR') FROM manufactura.revisiones WHERE revision_id = v_rev;
  UPDATE manufactura.revisiones SET elaboro_confirmado = true, version = version + 1 WHERE revision_id = v_rev;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev;
  INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) SELECT revision_id, encode(sha256(v_pdf), 'hex'), octet_length(v_pdf), especificacion_sha256, v_nombre, 1, 'x' FROM manufactura.revisiones WHERE revision_id = v_rev;
  BEGIN INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev, convert_to('%PDF-1.4 adulterado', 'UTF8')); INSERT INTO _res (prueba, ok) VALUES ('contenido con hash distinto se rechaza (integridad verificada por la base)', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('contenido con hash distinto se rechaza (integridad verificada por la base)', true); END;
  INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev, v_pdf);
  BEGIN UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('con PDF registrado no se puede volver a borrador', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('con PDF registrado no se puede volver a borrador', true); END;
  UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev;
  INSERT INTO _res (prueba, ok) SELECT 'FINALIZADA: revisión 1 = prevista, finalizado_por = sesión, token limpiado, entorno PRODUCCION', (revision = 1 AND revision_prevista = 1 AND finalizado_por_usuario_id = v_g1 AND finalizado_en IS NOT NULL AND finalizando_token IS NULL AND estado = 'FINALIZADA' AND entorno_emision = 'PRODUCCION') FROM manufactura.revisiones WHERE revision_id = v_rev;

  -- T7. inmutabilidad y acceso a finalizadas (todos los autenticados las ven)
  BEGIN UPDATE manufactura.revisiones SET elaboro_nombre = 'Cambio' WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada inmutable (UPDATE)', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada inmutable (UPDATE)', true); END;
  BEGIN DELETE FROM manufactura.revisiones WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada: sin DELETE para la aplicación', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('revisión finalizada: sin DELETE para la aplicación', true); END;
  BEGIN UPDATE manufactura.pdfs SET bytes = 1 WHERE revision_id = v_rev; INSERT INTO _res (prueba, ok) VALUES ('PDF inmutable: sin UPDATE', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('PDF inmutable: sin UPDATE', true); END;
  BEGIN INSERT INTO manufactura.confirmaciones_revision (revision_id, usuario_id, usuario_email, usuario_nombre, version, especificacion_sha256, es_autorrevision, como_revisor_asignado) VALUES (v_rev, 1, 'x', 'x', 1, repeat('0', 64), false, false);
    INSERT INTO _res (prueba, ok) VALUES ('no se registra revisión sobre una versión finalizada', false);
  EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('no se registra revisión sobre una versión finalizada', true); END;
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  SELECT count(*) INTO v_n FROM manufactura.revisiones r JOIN manufactura.pdfs p USING (revision_id) JOIN manufactura.pdf_contenidos c USING (revision_id) WHERE r.revision_id = v_rev AND encode(sha256(c.contenido), 'hex') = p.pdf_sha256;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: cualquier usuario autenticado ve la finalizada y su PDF íntegro (SHA-256 coincide)', v_n = 1);
  BEGIN INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, basada_en_revision_id, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
          VALUES (v_doc, 'COEX', v_spec, 'x', v_rev, 1, 'x', 1, 'x', repeat('0', 64));
    INSERT INTO _res (prueba, ok) VALUES ('una cuenta GENERAL no crea revisiones de documentos ajenos', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('una cuenta GENERAL no crea revisiones de documentos ajenos', true); END;

  -- T8. nueva revisión desde la finalizada (creador) y numeración correlativa
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, elaboro_confirmado, cliente_nombre, basada_en_revision_id, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
    SELECT documento_id, familia, especificacion, elaboro_nombre, true, cliente_nombre, revision_id, 1, 'x', 1, 'x', repeat('0', 64) FROM manufactura.revisiones WHERE revision_id = v_rev RETURNING revision_id INTO v_rev2;
  INSERT INTO _res (prueba, ok) SELECT 'nueva revisión: borrador nuevo basado en la finalizada (la anterior se conserva)', (r2.estado = 'BORRADOR' AND r2.basada_en_revision_id = v_rev AND r1.estado = 'FINALIZADA') FROM manufactura.revisiones r2, manufactura.revisiones r1 WHERE r2.revision_id = v_rev2 AND r1.revision_id = v_rev;
  UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = v_rev2;
  v_pdf := convert_to('%PDF-1.4 smoke rev 2', 'UTF8');
  INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) SELECT revision_id, encode(sha256(v_pdf), 'hex'), octet_length(v_pdf), especificacion_sha256, 'SMOKE001_REV02.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = v_rev2;
  INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES (v_rev2, v_pdf);
  UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = v_rev2;
  INSERT INTO _res (prueba, ok) SELECT 'la segunda finalización recibe la revisión 2', revision = 2 FROM manufactura.revisiones WHERE revision_id = v_rev2;

  -- T9. variantes: un código puede tener varias hojas; (código, variante) único sin distinguir mayúsculas; nombre del PDF con variante
  INSERT INTO manufactura.documentos (codigo_dcmx, variante) VALUES ('SMOKE001', 'Extendida') RETURNING documento_id INTO v_doc2;
  INSERT INTO _res (prueba, ok) SELECT 'mismo código con otra variante: permitido', count(*) = 2 FROM manufactura.documentos WHERE codigo_clave = 'smoke001';
  BEGIN INSERT INTO manufactura.documentos (codigo_dcmx, variante) VALUES ('smoke001', 'EXTENDIDA'); INSERT INTO _res (prueba, ok) VALUES ('(código, variante) duplicado se rechaza', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _res (prueba, ok) VALUES ('(código, variante) duplicado se rechaza', true); END;
  BEGIN INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('../etc/passwd'); INSERT INTO _res (prueba, ok) VALUES ('código inválido se rechaza', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _res (prueba, ok) VALUES ('código inválido se rechaza', true); END;
  INSERT INTO _res (prueba, ok) VALUES ('nombre con variante: SMOKE001-EXTENDIDA_REV01.pdf; sin variante: SMOKE001_REV01.pdf',
    manufactura.fn_nombre_pdf('SMOKE001', 'Extendida', 1) = 'SMOKE001-EXTENDIDA_REV01.pdf' AND manufactura.fn_nombre_pdf('SMOKE001', NULL, 1) = 'SMOKE001_REV01.pdf' AND manufactura.fn_nombre_pdf('A', 'Doble cara.2', 12) = 'A-DOBLE-CARA-2_REV12.pdf');

  -- T10. ADMIN: ve y administra
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, basada_en_revision_id, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
    SELECT documento_id, familia, especificacion, elaboro_nombre, revision_id, 1, 'x', 1, 'x', repeat('0', 64) FROM manufactura.revisiones WHERE revision_id = v_rev2 RETURNING revision_id INTO v_rev3;
  INSERT INTO _res (prueba, ok) SELECT 'ADMIN crea una revisión de un documento ajeno; el creador de la revisión es el ADMIN', creado_por_usuario_id = v_adm FROM manufactura.revisiones WHERE revision_id = v_rev3;
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE revision_id = v_rev3;
  INSERT INTO _res (prueba, ok) VALUES ('RLS: el dueño del documento no ve el borrador que creó un ADMIN', v_n = 0);

  -- T11. auditoría con el usuario real
  SELECT count(*) INTO v_n FROM audit.cambios WHERE esquema = 'manufactura' AND usuario_id = v_g1::text AND request_id = 'smoke-' || v_g1;
  INSERT INTO _res (prueba, ok) VALUES ('auditoría: filas en audit.cambios con el usuario y request reales (' || v_n || ')', v_n >= 10);
  INSERT INTO _res (prueba, ok) SELECT 'auditoría: el contenido binario del PDF NO se copia a audit.cambios', NOT EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'pdf_contenidos');
  INSERT INTO _res (prueba, ok) SELECT 'auditoría redactora: ninguna fila de revisiones copia la especificación, los nombres impresos ni el cliente (borradores privados)', NOT EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'revisiones' AND (COALESCE(datos_nuevos, '{}'::jsonb) ?| ARRAY['especificacion', 'elaboro_nombre', 'autorizo_nombre', 'cliente_nombre'] OR COALESCE(datos_anteriores, '{}'::jsonb) ?| ARRAY['especificacion', 'elaboro_nombre', 'autorizo_nombre', 'cliente_nombre']));
  INSERT INTO _res (prueba, ok) SELECT 'auditoría redactora: no se copian el código ni la variante del documento (se identifica por documento_id)', NOT EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'documentos' AND datos_nuevos ?| ARRAY['codigo_dcmx', 'variante']);
  INSERT INTO _res (prueba, ok) SELECT 'auditoría: la finalización queda registrada con el actor (UPDATE de revisiones)', EXISTS (SELECT 1 FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'revisiones' AND operacion = 'UPDATE' AND usuario_id = v_g1::text AND datos_nuevos ->> 'estado' = 'FINALIZADA');

  -- T12. sin DDL
  BEGIN EXECUTE 'CREATE TABLE manufactura.intruso (id int)'; INSERT INTO _res (prueba, ok) VALUES ('la aplicación no puede crear objetos', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('la aplicación no puede crear objetos', true); END;
END $$;

SELECT n, prueba, ok FROM _res ORDER BY n;
SELECT bool_and(ok) AS smoke_all_pass, count(*) AS pruebas FROM _res;

ROLLBACK;

-- Comprobación de RESIDUOS tras el ROLLBACK: nada de negocio ni de auditoría quedó guardado (solo huecos en los ids de las secuencias).
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') = :audit_antes AS sin_residuos_de_auditoria,
       (SELECT count(*) FROM manufactura.documentos) = :docs_antes AND (SELECT count(*) FROM manufactura.revisiones) = :revs_antes AND (SELECT count(*) FROM manufactura.pdfs) = :pdfs_antes AS sin_residuos_de_negocio;
