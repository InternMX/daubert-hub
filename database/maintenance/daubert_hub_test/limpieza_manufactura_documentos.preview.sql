-- =====================================================================================================================
-- PREVIEW · limpieza de documentos de Hojas de Manufactura (SOLO TEST: daubert_hub_test). SOLO LECTURA: no modifica nada.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -f limpieza_manufactura_documentos.preview.sql
-- Muestra: documentos afectados, conteo exacto por tabla, lo que se CONSERVA (con huella), dependencias inesperadas y los parámetros exactos para el script de eliminación.
-- Condición para continuar: preview_ok = t (sección 6). Guarde la salida: el DELETE exige estos valores y se niega a ejecutar si algo cambió entre el PREVIEW y la ejecución.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
\pset null '(nulo)'
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;   -- fija la forma en que se escriben las expresiones de las políticas (la huella no depende de la configuración del rol)
DO $$ BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo (no daubert_hub_test_user).'; END IF;
END $$;

\echo '== 1. Sesión'
SELECT current_user AS rol, current_database() AS base, now() AS momento;

\echo '== 2. Conteo exacto por tabla (lo que se ELIMINARÍA)'
SELECT 'documentos' AS tabla, count(*) AS filas FROM manufactura.documentos
UNION ALL SELECT 'revisiones (total)', count(*) FROM manufactura.revisiones
UNION ALL SELECT '  · BORRADOR', count(*) FROM manufactura.revisiones WHERE estado = 'BORRADOR'
UNION ALL SELECT '  · FINALIZANDO', count(*) FROM manufactura.revisiones WHERE estado = 'FINALIZANDO'
UNION ALL SELECT '  · FINALIZADA', count(*) FROM manufactura.revisiones WHERE estado = 'FINALIZADA'
UNION ALL SELECT '  · DESCARTADA', count(*) FROM manufactura.revisiones WHERE estado = 'DESCARTADA'
UNION ALL SELECT 'pdfs', count(*) FROM manufactura.pdfs
UNION ALL SELECT 'pdf_contenidos', count(*) FROM manufactura.pdf_contenidos
UNION ALL SELECT 'confirmaciones_revision', count(*) FROM manufactura.confirmaciones_revision
UNION ALL SELECT 'revision_responsables', count(*) FROM manufactura.revision_responsables;
SELECT pg_size_pretty(COALESCE(sum(octet_length(contenido)), 0)) AS bytes_de_pdf_a_eliminar FROM manufactura.pdf_contenidos;

\echo '== 3. Documentos afectados'
SELECT d.documento_id, d.codigo_dcmx, d.variante, d.created_at::date AS creado,
       count(r.*) AS revisiones, string_agg(coalesce(r.revision::text, '-') || ':' || r.estado, ' ' ORDER BY r.revision_id) AS estados
  FROM manufactura.documentos d LEFT JOIN manufactura.revisiones r USING (documento_id)
 GROUP BY d.documento_id, d.codigo_dcmx, d.variante, d.created_at ORDER BY d.documento_id;

\echo '== 4. Lo que se CONSERVA (no se toca)'
SELECT 'manufactura.firmas' AS tabla, count(*) AS filas FROM manufactura.firmas
UNION ALL SELECT 'manufactura.firma_autorizaciones', count(*) FROM manufactura.firma_autorizaciones
UNION ALL SELECT 'manufactura.cliente_abreviaturas', count(*) FROM manufactura.cliente_abreviaturas
UNION ALL SELECT 'security.users', count(*) FROM security.users
UNION ALL SELECT 'core.empresas', count(*) FROM core.empresas
UNION ALL SELECT 'core.empresa_roles', count(*) FROM core.empresa_roles
UNION ALL SELECT 'audit.cambios (historial; no se borra)', count(*) FROM audit.cambios WHERE esquema = 'manufactura';

\echo '== 5. Dependencias y mecanismos de seguridad'
-- Claves foráneas que apuntan a las tablas a vaciar: solo deben existir las 6 esperadas, todas dentro del propio esquema.
SELECT c.conrelid::regclass AS tabla_hija, c.conname AS restriccion, c.confrelid::regclass AS tabla_padre,
       (c.conname IN ('fk_manufactura_revisiones_documento', 'fk_manufactura_revisiones_basada', 'fk_manufactura_pdfs_revision', 'fk_manufactura_pdf_contenidos',
                      'fk_manufactura_confirmaciones_revision', 'fk_manufactura_responsables_revision')) AS esperada
  FROM pg_constraint c
 WHERE c.contype = 'f' AND c.confrelid IN ('manufactura.documentos'::regclass, 'manufactura.revisiones'::regclass, 'manufactura.pdfs'::regclass,
                                             'manufactura.pdf_contenidos'::regclass, 'manufactura.confirmaciones_revision'::regclass, 'manufactura.revision_responsables'::regclass)
 ORDER BY 1, 2;
-- Triggers que impiden borrar (se deshabilitan SOLO ellos, dentro de la transacción del DELETE, y se vuelven a habilitar antes del COMMIT).
SELECT c.relname AS tabla, t.tgname AS trigger, t.tgenabled AS habilitado, pg_get_triggerdef(t.oid) LIKE '%DELETE%' AS actua_en_delete
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgname IN ('trg_manufactura_documentos_inmutable', 'trg_manufactura_revisiones_no_delete', 'trg_manufactura_pdfs_inmutable',
       'trg_manufactura_pdf_contenidos_inmutable', 'trg_manufactura_confirmaciones_inmutable', 'trg_manufactura_responsables_guardia') ORDER BY 1, 2;
-- Sesiones con trabajo abierto sobre estas tablas (informativo: el DELETE toma bloqueo exclusivo y espera como máximo 15 s).
SELECT count(*) AS otras_sesiones_en_la_base, count(*) FILTER (WHERE state <> 'idle') AS no_inactivas FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();

\echo '== 6. Parámetros para el DELETE y condición de continuidad'
WITH
 dep AS (SELECT count(*) AS n FROM pg_constraint c WHERE c.contype = 'f'
          AND c.confrelid IN ('manufactura.documentos'::regclass, 'manufactura.revisiones'::regclass, 'manufactura.pdfs'::regclass, 'manufactura.pdf_contenidos'::regclass,
                              'manufactura.confirmaciones_revision'::regclass, 'manufactura.revision_responsables'::regclass)
          AND c.conname NOT IN ('fk_manufactura_revisiones_documento', 'fk_manufactura_revisiones_basada', 'fk_manufactura_pdfs_revision', 'fk_manufactura_pdf_contenidos',
                                'fk_manufactura_confirmaciones_revision', 'fk_manufactura_responsables_revision')),
 trg AS (SELECT count(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgname IN ('trg_manufactura_documentos_inmutable', 'trg_manufactura_revisiones_no_delete', 'trg_manufactura_pdfs_inmutable',
                'trg_manufactura_pdf_contenidos_inmutable', 'trg_manufactura_confirmaciones_inmutable', 'trg_manufactura_responsables_guardia') AND t.tgenabled = 'O'),
 hp AS (SELECT md5(concat_ws('#',
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firmas t),
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.firma_autorizaciones t),
          (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM manufactura.cliente_abreviaturas t),
          (SELECT md5(coalesce(string_agg(concat_ws(',', user_id, email, role, status), '|' ORDER BY user_id), '')) FROM security.users),
          (SELECT md5(coalesce(string_agg(concat_ws(',', empresa_id, nombre_comercial, estatus), '|' ORDER BY empresa_id), '')) FROM core.empresas),
          (SELECT count(*)::text FROM core.empresa_roles))) AS h),
 ht AS (SELECT md5(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)) AS h, count(*) AS n
          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'manufactura' AND NOT t.tgisinternal),
 hpol AS (SELECT md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY tablename, policyname)) AS h FROM pg_policies WHERE schemaname = 'manufactura'),
 n AS (SELECT (SELECT count(*) FROM manufactura.documentos) AS docs, (SELECT count(*) FROM manufactura.revisiones) AS revs, (SELECT count(*) FROM manufactura.pdfs) AS pdfs)
SELECT n.docs AS esperados_documentos, n.revs AS esperados_revisiones, n.pdfs AS esperados_pdfs,
       hp.h AS huella_protegidos, ht.h AS huella_triggers, hpol.h AS huella_politicas,
       (dep.n = 0 AND trg.n = 6) AS preview_ok,
       format(E'psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -v confirmar=SI_ELIMINAR_TODOS_LOS_DOCUMENTOS_DE_MANUFACTURA_EN_TEST -v esperados_documentos=%s -v esperados_revisiones=%s -v esperados_pdfs=%s -v huella_protegidos=%s -v huella_triggers=%s -f limpieza_manufactura_documentos.delete.sql',
              n.docs, n.revs, n.pdfs, hp.h, ht.h) AS comando_delete
  FROM n, hp, ht, hpol, dep, trg;
ROLLBACK;
