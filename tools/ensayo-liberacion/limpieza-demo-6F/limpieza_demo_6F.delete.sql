-- =====================================================================================================================
-- LIMPIEZA SELECTIVA · elimina SOLO los recursos de la demostración de la Fase 6F en daubert_hub_test. UNA transacción: o se aplica todo o nada.
--
-- ELIMINA: los documentos DEMOFPMG101–104 creados por las cuentas de demostración y sus revisiones, PDF, contenidos, confirmaciones y responsables; las firmas propiedad y subidas por esas
--          cuentas (sin uso fuera de lo que se elimina) y las autorizaciones sobre ellas u otorgadas a/por esas cuentas; las SESIONES de las cuentas de demostración.
-- DESACTIVA (no borra): las tres cuentas de demostración (status INACTIVE). Se conservan porque audit.cambios guarda su historial (sin clave foránea: borrarlas dejaría actores huérfanos).
-- CONSERVA: todo lo demás — documentos 33–36 y sus revisiones, firmas 5/6/7/9, sus autorizaciones, abreviaturas, clientes, usuarios, auditoría (las bajas quedan registradas con origen LIMPIEZA_DEMO_6F).
--
-- SEGURIDAD: rol administrativo y base daubert_hub_test; frase de confirmación; los identificadores, conteos y huellas DEBEN coincidir con el PREVIEW (si algo cambió, aborta sin tocar nada);
--   bloqueo exclusivo de las tablas afectadas; sin TRUNCATE, sin CASCADE, sin session_replication_role. Se deshabilitan SOLO los 8 triggers que impiden el DELETE (6 documentales + firmas y
--   autorizaciones), dentro de la transacción, y se vuelven a habilitar antes del COMMIT; la auditoría, las claves foráneas y la RLS siguen activas. Antes del COMMIT se verifica que triggers,
--   políticas, RLS y todo lo conservado quedaron exactamente igual.
--   psql -X -v ON_ERROR_STOP=1 -d daubert_hub_test -U postgres -W -v confirmar=SI_ELIMINAR_SOLO_LA_DEMOSTRACION_6F <parámetros del PREVIEW> -f limpieza_demo_6F.delete.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?confirmar}
\else
  \echo 'ABORTO: falta -v confirmar=SI_ELIMINAR_SOLO_LA_DEMOSTRACION_6F'
  \quit
\endif
\if :{?huella_triggers}
\else
  \echo 'ABORTO: faltan los parámetros del PREVIEW (docs, revs, firmas, auts, usuarios, n_pdfs, n_contenidos, n_confirmaciones, n_responsables, huella_conservado, huella_triggers).'
  \quit
\endif

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';
-- Mismo formato de salida que el PREVIEW (la huella usa fila::text): independiente de la zona horaria del servidor.
SET LOCAL TimeZone = 'UTC'; SET LOCAL DateStyle = 'ISO, YMD'; SET LOCAL IntervalStyle = 'postgres'; SET LOCAL bytea_output = 'hex'; SET LOCAL extra_float_digits = 1;
SELECT set_config('l.confirmar', :'confirmar', true), set_config('l.docs', :'docs', true), set_config('l.revs', :'revs', true), set_config('l.firmas', :'firmas', true),
       set_config('l.auts', :'auts', true), set_config('l.usuarios', :'usuarios', true), set_config('l.n_pdfs', :'n_pdfs', true), set_config('l.n_cont', :'n_contenidos', true),
       set_config('l.n_conf', :'n_confirmaciones', true), set_config('l.n_resp', :'n_responsables', true), set_config('l.h_cons', :'huella_conservado', true), set_config('l.h_trg', :'huella_triggers', true),
       set_config('app.origin', 'LIMPIEZA_DEMO_6F', true), set_config('app.request_id', 'limpieza-demo-6f-' || to_char(now(), 'YYYYMMDDHH24MISS'), true), set_config('app.user_email', 'operador-limpieza-test', true);

DO $$
DECLARE
  v_trg constant text[] := ARRAY['trg_manufactura_documentos_inmutable', 'trg_manufactura_revisiones_no_delete', 'trg_manufactura_pdfs_inmutable', 'trg_manufactura_pdf_contenidos_inmutable',
                                 'trg_manufactura_confirmaciones_inmutable', 'trg_manufactura_responsables_guardia', 'trg_manufactura_firmas_no_delete', 'trg_manufactura_firma_aut_no_delete'];
  u bigint[]; d bigint[]; r bigint[]; f bigint[]; a bigint[];
  v_h text; v_pol text; v_n bigint; v_vuelta int := 0; v_ses bigint;
  lista text;
BEGIN
  -- 1. guardias
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF current_setting('l.confirmar') <> 'SI_ELIMINAR_SOLO_LA_DEMOSTRACION_6F' THEN RAISE EXCEPTION 'ABORTO: frase de confirmación incorrecta.'; END IF;
  FOREACH lista IN ARRAY ARRAY[current_setting('l.docs'), current_setting('l.revs'), current_setting('l.firmas'), current_setting('l.auts'), current_setting('l.usuarios')] LOOP
    IF lista !~ '^(ninguno|[0-9]{1,18}(,[0-9]{1,18})*)$' THEN RAISE EXCEPTION 'ABORTO: lista de identificadores inválida: %', lista; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgname = ANY (v_trg) AND t.tgenabled = 'O') <> 8 THEN
    RAISE EXCEPTION 'ABORTO: los 8 triggers de protección no están todos presentes y habilitados.';
  END IF;

  -- 2. bloqueo exclusivo
  LOCK TABLE manufactura.revision_responsables, manufactura.pdf_contenidos, manufactura.pdfs, manufactura.confirmaciones_revision, manufactura.revisiones, manufactura.documentos,
             manufactura.firma_autorizaciones, manufactura.firmas IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE security.users, security.sessions IN SHARE ROW EXCLUSIVE MODE;

  -- 3. recalcular el conjunto con el MISMO criterio del PREVIEW y exigir que sea idéntico
  SELECT coalesce(array_agg(user_id ORDER BY user_id), '{}') INTO u FROM security.users WHERE user_id > 247 AND email IN ('demo.admin.manufactura@example.invalid', 'demo.general1.manufactura@example.invalid', 'demo.general2.manufactura@example.invalid');
  SELECT coalesce(array_agg(documento_id ORDER BY documento_id), '{}') INTO d FROM manufactura.documentos WHERE codigo_dcmx IN ('DEMOFPMG101', 'DEMOFPMG102', 'DEMOFPMG103', 'DEMOFPMG104') AND creado_por_usuario_id = ANY (u);
  SELECT coalesce(array_agg(revision_id ORDER BY revision_id), '{}') INTO r FROM manufactura.revisiones WHERE documento_id = ANY (d);
  SELECT coalesce(array_agg(firma_id ORDER BY firma_id), '{}') INTO f FROM manufactura.firmas x WHERE propietario_usuario_id = ANY (u) AND subida_por_usuario_id = ANY (u)
    AND NOT EXISTS (SELECT 1 FROM manufactura.revision_responsables rr WHERE rr.firma_id = x.firma_id AND NOT (rr.revision_id = ANY (r)));
  SELECT coalesce(array_agg(autorizacion_id ORDER BY autorizacion_id), '{}') INTO a FROM manufactura.firma_autorizaciones x WHERE firma_id = ANY (f) OR usuario_id = ANY (u) OR otorgada_por_usuario_id = ANY (u);
  IF coalesce(array_to_string(u, ','), '') <> replace(current_setting('l.usuarios'), 'ninguno', '') THEN RAISE EXCEPTION 'ABORTO: cuentas de demostración distintas del PREVIEW (% vs %).', u, current_setting('l.usuarios'); END IF;
  IF coalesce(array_to_string(d, ','), '') <> replace(current_setting('l.docs'), 'ninguno', '') THEN RAISE EXCEPTION 'ABORTO: documentos distintos del PREVIEW (% vs %).', d, current_setting('l.docs'); END IF;
  IF coalesce(array_to_string(r, ','), '') <> replace(current_setting('l.revs'), 'ninguno', '') THEN RAISE EXCEPTION 'ABORTO: revisiones distintas del PREVIEW (% vs %).', r, current_setting('l.revs'); END IF;
  IF coalesce(array_to_string(f, ','), '') <> replace(current_setting('l.firmas'), 'ninguno', '') THEN RAISE EXCEPTION 'ABORTO: firmas distintas del PREVIEW (% vs %).', f, current_setting('l.firmas'); END IF;
  IF coalesce(array_to_string(a, ','), '') <> replace(current_setting('l.auts'), 'ninguno', '') THEN RAISE EXCEPTION 'ABORTO: autorizaciones distintas del PREVIEW (% vs %).', a, current_setting('l.auts'); END IF;
  -- Nada de la línea base puede caer en el conjunto (defensa adicional).
  IF EXISTS (SELECT 1 FROM unnest(d) x WHERE x <= 36) OR EXISTS (SELECT 1 FROM unnest(r) x WHERE x <= 73) OR EXISTS (SELECT 1 FROM unnest(f) x WHERE x <= 9) OR EXISTS (SELECT 1 FROM unnest(u) x WHERE x <= 247) THEN
    RAISE EXCEPTION 'ABORTO: el conjunto incluye identificadores de la línea base anterior a la Fase 6F.';
  END IF;
  IF (SELECT count(*) FROM manufactura.pdfs WHERE revision_id = ANY (r)) <> current_setting('l.n_pdfs')::bigint OR (SELECT count(*) FROM manufactura.pdf_contenidos WHERE revision_id = ANY (r)) <> current_setting('l.n_cont')::bigint
     OR (SELECT count(*) FROM manufactura.confirmaciones_revision WHERE revision_id = ANY (r)) <> current_setting('l.n_conf')::bigint OR (SELECT count(*) FROM manufactura.revision_responsables WHERE revision_id = ANY (r)) <> current_setting('l.n_resp')::bigint THEN
    RAISE EXCEPTION 'ABORTO: los conteos de dependencias cambiaron desde el PREVIEW.';
  END IF;
  -- Huella de lo conservado (mismo cálculo que el PREVIEW).
  SELECT md5(concat_ws('#',
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.documento_id), '')) FROM manufactura.documentos t WHERE NOT (documento_id = ANY (d))),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.revision_id), '')) FROM manufactura.revisiones t WHERE NOT (revision_id = ANY (r))),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.pdfs t WHERE NOT (revision_id = ANY (r))),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.revision_responsables t WHERE NOT (revision_id = ANY (r))),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.firma_id), '')) FROM manufactura.firmas t WHERE NOT (firma_id = ANY (f))),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.autorizacion_id), '')) FROM manufactura.firma_autorizaciones t WHERE NOT (autorizacion_id = ANY (a))),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
    (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users WHERE NOT (user_id = ANY (u))),
    (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
    (SELECT count(*)::text FROM core.empresa_roles))) INTO v_h;
  IF v_h <> current_setting('l.h_cons') THEN RAISE EXCEPTION 'ABORTO: lo que se conserva cambió desde el PREVIEW. Repita el PREVIEW.'; END IF;
  SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)) INTO v_h FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal;
  IF v_h <> current_setting('l.h_trg') THEN RAISE EXCEPTION 'ABORTO: los triggers de manufactura no coinciden con el PREVIEW.'; END IF;
  SELECT md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname)) INTO v_pol FROM pg_policies WHERE schemaname = 'manufactura';
  RAISE NOTICE 'Conjunto verificado: usuarios %, documentos %, revisiones %, firmas %, autorizaciones %.', u, d, r, f, a;

  -- 4. deshabilitar SOLO los 8 triggers que bloquean el DELETE
  ALTER TABLE manufactura.documentos DISABLE TRIGGER trg_manufactura_documentos_inmutable;
  ALTER TABLE manufactura.revisiones DISABLE TRIGGER trg_manufactura_revisiones_no_delete;
  ALTER TABLE manufactura.pdfs DISABLE TRIGGER trg_manufactura_pdfs_inmutable;
  ALTER TABLE manufactura.pdf_contenidos DISABLE TRIGGER trg_manufactura_pdf_contenidos_inmutable;
  ALTER TABLE manufactura.confirmaciones_revision DISABLE TRIGGER trg_manufactura_confirmaciones_inmutable;
  ALTER TABLE manufactura.revision_responsables DISABLE TRIGGER trg_manufactura_responsables_guardia;
  ALTER TABLE manufactura.firmas DISABLE TRIGGER trg_manufactura_firmas_no_delete;
  ALTER TABLE manufactura.firma_autorizaciones DISABLE TRIGGER trg_manufactura_firma_aut_no_delete;

  -- 5. eliminación por identificador exacto, en orden de dependencia (claves foráneas activas, sin CASCADE)
  DELETE FROM manufactura.revision_responsables WHERE revision_id = ANY (r);
  DELETE FROM manufactura.pdf_contenidos WHERE revision_id = ANY (r);
  DELETE FROM manufactura.pdfs WHERE revision_id = ANY (r);
  DELETE FROM manufactura.confirmaciones_revision WHERE revision_id = ANY (r);
  LOOP
    DELETE FROM manufactura.revisiones x WHERE x.revision_id = ANY (r) AND NOT EXISTS (SELECT 1 FROM manufactura.revisiones h WHERE h.basada_en_revision_id = x.revision_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;
    v_vuelta := v_vuelta + 1;
    IF v_vuelta > 100 THEN RAISE EXCEPTION 'ABORTO: la cadena de revisiones no termina.'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM manufactura.revisiones WHERE revision_id = ANY (r)) THEN RAISE EXCEPTION 'Quedaron revisiones de demostración (alguna revisión conservada se basa en ellas): se revierte.'; END IF;
  DELETE FROM manufactura.documentos WHERE documento_id = ANY (d);
  DELETE FROM manufactura.firma_autorizaciones WHERE autorizacion_id = ANY (a);
  DELETE FROM manufactura.firmas WHERE firma_id = ANY (f);
  DELETE FROM security.sessions WHERE user_id = ANY (u);
  GET DIAGNOSTICS v_ses = ROW_COUNT;
  UPDATE security.users SET status = 'INACTIVE' WHERE user_id = ANY (u) AND status <> 'INACTIVE';

  -- 6. restaurar los 8 triggers
  ALTER TABLE manufactura.documentos ENABLE TRIGGER trg_manufactura_documentos_inmutable;
  ALTER TABLE manufactura.revisiones ENABLE TRIGGER trg_manufactura_revisiones_no_delete;
  ALTER TABLE manufactura.pdfs ENABLE TRIGGER trg_manufactura_pdfs_inmutable;
  ALTER TABLE manufactura.pdf_contenidos ENABLE TRIGGER trg_manufactura_pdf_contenidos_inmutable;
  ALTER TABLE manufactura.confirmaciones_revision ENABLE TRIGGER trg_manufactura_confirmaciones_inmutable;
  ALTER TABLE manufactura.revision_responsables ENABLE TRIGGER trg_manufactura_responsables_guardia;
  ALTER TABLE manufactura.firmas ENABLE TRIGGER trg_manufactura_firmas_no_delete;
  ALTER TABLE manufactura.firma_autorizaciones ENABLE TRIGGER trg_manufactura_firma_aut_no_delete;

  -- 7. verificación final ANTES del COMMIT
  IF EXISTS (SELECT 1 FROM manufactura.documentos WHERE documento_id = ANY (d)) OR EXISTS (SELECT 1 FROM manufactura.firmas WHERE firma_id = ANY (f)) OR EXISTS (SELECT 1 FROM manufactura.firma_autorizaciones WHERE autorizacion_id = ANY (a))
     OR EXISTS (SELECT 1 FROM manufactura.pdfs p WHERE NOT EXISTS (SELECT 1 FROM manufactura.revisiones x WHERE x.revision_id = p.revision_id)) THEN RAISE EXCEPTION 'Quedaron restos o huérfanos: se revierte.'; END IF;
  SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)) INTO v_h FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal;
  IF v_h <> current_setting('l.h_trg') THEN RAISE EXCEPTION 'Los triggers no quedaron exactamente como estaban: se revierte.'; END IF;
  SELECT md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname)) INTO v_h FROM pg_policies WHERE schemaname = 'manufactura';
  IF v_h <> v_pol THEN RAISE EXCEPTION 'Las políticas RLS cambiaron: se revierte.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) <> 0 THEN RAISE EXCEPTION 'Alguna tabla perdió la RLS: se revierte.'; END IF;
  SELECT md5(concat_ws('#',
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.documento_id), '')) FROM manufactura.documentos t),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.revision_id), '')) FROM manufactura.revisiones t),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.pdfs t),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.revision_responsables t),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.firma_id), '')) FROM manufactura.firmas t),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.autorizacion_id), '')) FROM manufactura.firma_autorizaciones t),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
    (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users WHERE NOT (user_id = ANY (u))),
    (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
    (SELECT count(*)::text FROM core.empresa_roles))) INTO v_h;
  IF v_h <> current_setting('l.h_cons') THEN RAISE EXCEPTION 'Lo conservado cambió durante la limpieza: se revierte.'; END IF;
  IF EXISTS (SELECT 1 FROM security.users WHERE user_id = ANY (u) AND status <> 'INACTIVE') THEN RAISE EXCEPTION 'Alguna cuenta de demostración sigue activa: se revierte.'; END IF;
  RAISE NOTICE 'ELIMINADOS: % documentos, % revisiones, % pdfs, % contenidos, % confirmaciones, % responsables, % firmas, % autorizaciones, % sesiones. DESACTIVADAS: % cuentas.',
    cardinality(d), cardinality(r), current_setting('l.n_pdfs'), current_setting('l.n_cont'), current_setting('l.n_conf'), current_setting('l.n_resp'), cardinality(f), cardinality(a), v_ses, cardinality(u);
END $$;

SELECT 'DELETE_OK limpieza selectiva de la demostración 6F (lo anterior a la Fase 6F, la auditoría, triggers y RLS intactos)' AS resultado;
COMMIT;
