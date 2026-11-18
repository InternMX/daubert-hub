-- =====================================================================================================================
-- LIMPIEZA · elimina TODOS los documentos de Hojas de Manufactura de TEST (SOLO daubert_hub_test). UNA transacción: o queda todo vacío o no cambia nada.
--
-- ELIMINA (en este orden): revision_responsables → pdf_contenidos → pdfs → confirmaciones_revision → revisiones (de las más nuevas a las más antiguas, por la relación «basada en») → documentos.
-- CONSERVA: manufactura.firmas, firma_autorizaciones, cliente_abreviaturas, security.users, core.empresas/empresa_roles, configuración y audit.cambios (el historial de auditoría no se borra; las bajas
--   quedan registradas con origen LIMPIEZA_TEST). No toca daubert_global ni otras automatizaciones.
--
-- SEGURIDAD
--   · Exige el rol administrativo, la base daubert_hub_test, la frase de confirmación y los parámetros del PREVIEW (conteos y huellas). Si algo cambió desde el PREVIEW, aborta SIN borrar.
--   · Bloquea las 6 tablas (ACCESS EXCLUSIVE, máx. 15 s) para que ninguna sesión escriba durante la limpieza.
--   · NO usa TRUNCATE, ni CASCADE, ni session_replication_role. Las revisiones FINALIZADA/DESCARTADA son inmutables por trigger: se deshabilitan SOLO esos 6 triggers (los que bloquean el DELETE),
--     dentro de esta transacción, y se vuelven a habilitar antes del COMMIT (DDL transaccional: si algo falla, vuelven solos a su estado). La auditoría, las claves foráneas, la RLS y los demás triggers
--     siguen activos. Antes del COMMIT se verifica que TODOS los triggers y políticas quedaron exactamente como antes y que lo conservado no cambió.
--
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -v confirmar=SI_ELIMINAR_TODOS_LOS_DOCUMENTOS_DE_MANUFACTURA_EN_TEST \
--        -v esperados_documentos=N -v esperados_revisiones=N -v esperados_pdfs=N -v huella_protegidos=… -v huella_triggers=… -f limpieza_manufactura_documentos.delete.sql
--   (el PREVIEW imprime la línea completa en «comando_delete»)
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\if :{?confirmar}
\else
  \echo 'ABORTO: falta -v confirmar=SI_ELIMINAR_TODOS_LOS_DOCUMENTOS_DE_MANUFACTURA_EN_TEST'
  \quit
\endif
\if :{?esperados_documentos}
\else
  \echo 'ABORTO: faltan los parámetros del PREVIEW (esperados_documentos, esperados_revisiones, esperados_pdfs, huella_protegidos, huella_triggers).'
  \quit
\endif
\if :{?esperados_revisiones}
\else
  \echo 'ABORTO: falta -v esperados_revisiones.'
  \quit
\endif
\if :{?esperados_pdfs}
\else
  \echo 'ABORTO: falta -v esperados_pdfs.'
  \quit
\endif
\if :{?huella_protegidos}
\else
  \echo 'ABORTO: falta -v huella_protegidos.'
  \quit
\endif
\if :{?huella_triggers}
\else
  \echo 'ABORTO: falta -v huella_triggers.'
  \quit
\endif

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';
SET LOCAL search_path = pg_catalog;
SELECT set_config('limpieza.confirmar', :'confirmar', true), set_config('limpieza.docs', :'esperados_documentos', true), set_config('limpieza.revs', :'esperados_revisiones', true),
       set_config('limpieza.pdfs', :'esperados_pdfs', true), set_config('limpieza.h_prot', :'huella_protegidos', true), set_config('limpieza.h_trg', :'huella_triggers', true),
       -- Las bajas quedan en audit.cambios con este origen (sin usuario de la aplicación).
       set_config('app.origin', 'LIMPIEZA_TEST', true), set_config('app.request_id', 'limpieza-' || to_char(now(), 'YYYYMMDDHH24MISS'), true), set_config('app.user_email', 'operador-limpieza-test', true);

DO $$
DECLARE
  v_triggers constant text[] := ARRAY['trg_manufactura_documentos_inmutable', 'trg_manufactura_revisiones_no_delete', 'trg_manufactura_pdfs_inmutable',
                                      'trg_manufactura_pdf_contenidos_inmutable', 'trg_manufactura_confirmaciones_inmutable', 'trg_manufactura_responsables_guardia'];
  v_fks constant text[] := ARRAY['fk_manufactura_revisiones_documento', 'fk_manufactura_revisiones_basada', 'fk_manufactura_pdfs_revision', 'fk_manufactura_pdf_contenidos',
                                 'fk_manufactura_confirmaciones_revision', 'fk_manufactura_responsables_revision'];
  v_docs bigint; v_revs bigint; v_pdfs bigint; v_resp bigint; v_conf bigint; v_cont bigint; v_n bigint; v_vuelta int := 0; v_h text; v_trg_antes bigint; v_pol_antes text;
  v_prot_antes text; v_users bigint; v_emp bigint;
BEGIN
  -- ---------------------------------------------------------------- 1. guardias
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF current_setting('limpieza.confirmar') <> 'SI_ELIMINAR_TODOS_LOS_DOCUMENTOS_DE_MANUFACTURA_EN_TEST' THEN RAISE EXCEPTION 'ABORTO: frase de confirmación incorrecta.'; END IF;
  IF current_setting('limpieza.docs') !~ '^[0-9]{1,9}$' OR current_setting('limpieza.revs') !~ '^[0-9]{1,9}$' OR current_setting('limpieza.pdfs') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'ABORTO: los conteos esperados deben ser números.'; END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgname = ANY (v_triggers) AND t.tgenabled = 'O') <> 6 THEN
    RAISE EXCEPTION 'ABORTO: los 6 triggers de protección no están todos presentes y habilitados.';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid IN ('manufactura.documentos'::regclass, 'manufactura.revisiones'::regclass, 'manufactura.pdfs'::regclass,
         'manufactura.pdf_contenidos'::regclass, 'manufactura.confirmaciones_revision'::regclass, 'manufactura.revision_responsables'::regclass) AND NOT (c.conname = ANY (v_fks));
  IF v_n <> 0 THEN RAISE EXCEPTION 'ABORTO: hay % claves foráneas inesperadas que apuntan a estas tablas (revise el PREVIEW).', v_n; END IF;

  -- ---------------------------------------------------------------- 2. bloqueo exclusivo (nadie escribe mientras se limpia)
  LOCK TABLE manufactura.revision_responsables, manufactura.pdf_contenidos, manufactura.pdfs, manufactura.confirmaciones_revision, manufactura.revisiones, manufactura.documentos IN ACCESS EXCLUSIVE MODE;

  -- ---------------------------------------------------------------- 3. el estado debe ser EXACTAMENTE el del PREVIEW
  SELECT count(*) INTO v_docs FROM manufactura.documentos; SELECT count(*) INTO v_revs FROM manufactura.revisiones; SELECT count(*) INTO v_pdfs FROM manufactura.pdfs;
  IF v_docs <> current_setting('limpieza.docs')::bigint OR v_revs <> current_setting('limpieza.revs')::bigint OR v_pdfs <> current_setting('limpieza.pdfs')::bigint THEN
    RAISE EXCEPTION 'ABORTO: los conteos cambiaron desde el PREVIEW (documentos %/%, revisiones %/%, pdfs %/%). Repita el PREVIEW.', v_docs, current_setting('limpieza.docs'), v_revs, current_setting('limpieza.revs'), v_pdfs, current_setting('limpieza.pdfs');
  END IF;
  SELECT md5(concat_ws('#',
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firmas t),
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firma_autorizaciones t),
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
          (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users),
          (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
          (SELECT count(*)::text FROM core.empresa_roles))) INTO v_prot_antes;
  IF v_prot_antes <> current_setting('limpieza.h_prot') THEN RAISE EXCEPTION 'ABORTO: lo que se conserva (firmas, autorizaciones, abreviaturas, usuarios, clientes) cambió desde el PREVIEW. Repita el PREVIEW.'; END IF;
  SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)), count(*) INTO v_h, v_trg_antes
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal;
  IF v_h <> current_setting('limpieza.h_trg') THEN RAISE EXCEPTION 'ABORTO: los triggers de manufactura no coinciden con el PREVIEW.'; END IF;
  SELECT md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname)) INTO v_pol_antes FROM pg_policies WHERE schemaname = 'manufactura';
  SELECT count(*) INTO v_users FROM security.users; SELECT count(*) INTO v_emp FROM core.empresas;
  RAISE NOTICE 'Estado verificado: % documentos, % revisiones, % pdfs. Se procede.', v_docs, v_revs, v_pdfs;

  -- ---------------------------------------------------------------- 4. deshabilitar SOLO los 6 triggers que bloquean el DELETE (dentro de esta transacción)
  ALTER TABLE manufactura.documentos DISABLE TRIGGER trg_manufactura_documentos_inmutable;
  ALTER TABLE manufactura.revisiones DISABLE TRIGGER trg_manufactura_revisiones_no_delete;
  ALTER TABLE manufactura.pdfs DISABLE TRIGGER trg_manufactura_pdfs_inmutable;
  ALTER TABLE manufactura.pdf_contenidos DISABLE TRIGGER trg_manufactura_pdf_contenidos_inmutable;
  ALTER TABLE manufactura.confirmaciones_revision DISABLE TRIGGER trg_manufactura_confirmaciones_inmutable;
  ALTER TABLE manufactura.revision_responsables DISABLE TRIGGER trg_manufactura_responsables_guardia;

  -- ---------------------------------------------------------------- 5. eliminación en orden de dependencia (las claves foráneas siguen activas: no puede quedar nada colgando)
  SELECT count(*) INTO v_resp FROM manufactura.revision_responsables; SELECT count(*) INTO v_cont FROM manufactura.pdf_contenidos; SELECT count(*) INTO v_conf FROM manufactura.confirmaciones_revision;
  DELETE FROM manufactura.revision_responsables;
  DELETE FROM manufactura.pdf_contenidos;
  DELETE FROM manufactura.pdfs;
  DELETE FROM manufactura.confirmaciones_revision;
  -- Revisiones: de las más nuevas a las más antiguas (una revisión «basada en» otra no puede sobrevivir a su base; la FK es RESTRICT).
  LOOP
    DELETE FROM manufactura.revisiones r WHERE NOT EXISTS (SELECT 1 FROM manufactura.revisiones h WHERE h.basada_en_revision_id = r.revision_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;
    v_vuelta := v_vuelta + 1;
    IF v_vuelta > 1000 THEN RAISE EXCEPTION 'ABORTO: la cadena de revisiones no termina (¿ciclo?).'; END IF;
  END LOOP;
  DELETE FROM manufactura.documentos;

  -- ---------------------------------------------------------------- 6. restaurar los 6 triggers
  ALTER TABLE manufactura.documentos ENABLE TRIGGER trg_manufactura_documentos_inmutable;
  ALTER TABLE manufactura.revisiones ENABLE TRIGGER trg_manufactura_revisiones_no_delete;
  ALTER TABLE manufactura.pdfs ENABLE TRIGGER trg_manufactura_pdfs_inmutable;
  ALTER TABLE manufactura.pdf_contenidos ENABLE TRIGGER trg_manufactura_pdf_contenidos_inmutable;
  ALTER TABLE manufactura.confirmaciones_revision ENABLE TRIGGER trg_manufactura_confirmaciones_inmutable;
  ALTER TABLE manufactura.revision_responsables ENABLE TRIGGER trg_manufactura_responsables_guardia;

  -- ---------------------------------------------------------------- 7. verificación final ANTES del COMMIT (cualquier fallo revierte todo)
  IF (SELECT count(*) FROM manufactura.documentos) + (SELECT count(*) FROM manufactura.revisiones) + (SELECT count(*) FROM manufactura.pdfs) + (SELECT count(*) FROM manufactura.pdf_contenidos)
     + (SELECT count(*) FROM manufactura.confirmaciones_revision) + (SELECT count(*) FROM manufactura.revision_responsables) <> 0 THEN RAISE EXCEPTION 'Quedaron filas en las tablas documentales: se revierte.'; END IF;
  SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)) INTO v_h
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal;
  IF v_h <> current_setting('limpieza.h_trg') THEN RAISE EXCEPTION 'Los triggers no quedaron exactamente como estaban: se revierte.'; END IF;
  SELECT md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname)) INTO v_h FROM pg_policies WHERE schemaname = 'manufactura';
  IF v_h <> v_pol_antes THEN RAISE EXCEPTION 'Las políticas RLS cambiaron: se revierte.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) <> 0 THEN RAISE EXCEPTION 'Alguna tabla perdió la RLS: se revierte.'; END IF;
  SELECT md5(concat_ws('#',
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firmas t),
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firma_autorizaciones t),
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
          (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users),
          (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
          (SELECT count(*)::text FROM core.empresa_roles))) INTO v_h;
  IF v_h <> v_prot_antes THEN RAISE EXCEPTION 'Lo conservado (firmas, autorizaciones, abreviaturas, usuarios, clientes) cambió: se revierte.'; END IF;
  IF (SELECT count(*) FROM security.users) <> v_users OR (SELECT count(*) FROM core.empresas) <> v_emp THEN RAISE EXCEPTION 'Cambió el conteo de usuarios o empresas: se revierte.'; END IF;
  RAISE NOTICE 'ELIMINADOS: % documentos, % revisiones, % pdfs, % contenidos de pdf, % confirmaciones, % responsables (% vueltas).', v_docs, v_revs, v_pdfs, v_cont, v_conf, v_resp, v_vuelta;
END $$;

SELECT 'DELETE_OK limpieza de documentos de manufactura (gestor documental vacío; catálogos, firmas, autorizaciones, usuarios y auditoría intactos)' AS resultado;
COMMIT;
