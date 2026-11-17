-- =====================================================================================================================
-- DOWN · manufactura 107 (SOLO TEST: daubert_hub_test). IDEMPOTENTE. No toca datos.
-- Restaura el cuerpo de manufactura.fn_nombre_pdf de la 101 (revisión con lpad(…, 2), que TRUNCA las revisiones de tres dígitos).
-- REVERSIÓN SEGURA: la definición de la 101 solo difiere de la 107 en revisiones >= 100. Si existe CUALQUIER revisión con número (o número reservado al finalizar) >= 100, o algún PDF
-- registrado cuyo nombre no coincida con el de la 101, ABORTA sin cambiar nada: esos PDF finalizados son inmutables y la función restaurada declararía para ellos otro nombre
-- (p. ej. REV10 en vez de REV100). En ese caso no se revierte: se corrige hacia adelante.
-- Si la función ya tiene la definición de la 101, no hace nada. Cualquier otra definición es un estado desconocido: ABORTA.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261113_107_manufactura_nombre_pdf_revision_test.down.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
END $$;
SET LOCAL lock_timeout = '10s';
-- Bloquea el registro de PDF y la reserva de revisiones mientras se comprueba y se restaura (nadie puede finalizar entre la comprobación y el cambio).
LOCK TABLE manufactura.revisiones, manufactura.pdfs IN SHARE MODE;
CREATE TEMP TABLE m107_accion ON COMMIT DROP AS SELECT 'pendiente'::text AS accion;
DO $$
DECLARE v_oid oid := to_regprocedure('manufactura.fn_nombre_pdf(text,text,integer)'); v_src text; v_n bigint; v_m bigint;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'ABORTO: no existe manufactura.fn_nombre_pdf(text, text, integer).'; END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src = $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' $b$ THEN
    UPDATE m107_accion SET accion = 'ya_revertida'; RETURN;
  END IF;
  IF v_src <> $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, greatest(2, length(p_revision::text)), '0') || '.pdf' $b$ THEN
    RAISE EXCEPTION 'ABORTO: la definición de fn_nombre_pdf no es la de la 107 ni la de la 101 (estado desconocido).';
  END IF;
  SELECT count(*) INTO v_n FROM manufactura.revisiones WHERE greatest(coalesce(revision, 0), coalesce(revision_prevista, 0)) >= 100;
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORTO: hay % revisiones con número >= 100; la definición de la 101 truncaría su nombre de PDF. No se revierte (corregir hacia adelante).', v_n; END IF;
  SELECT count(*) INTO v_m FROM manufactura.pdfs p JOIN manufactura.revisiones r ON r.revision_id = p.revision_id JOIN manufactura.documentos d ON d.documento_id = r.documento_id
   WHERE p.nombre_archivo <> d.codigo_dcmx || CASE WHEN d.variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(d.variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END
                             || '_REV' || lpad(coalesce(r.revision, r.revision_prevista)::text, 2, '0') || '.pdf';
  IF v_m > 0 THEN RAISE EXCEPTION 'ABORTO: % PDF registrados no coinciden con el nombre de la 101. No se revierte (corregir hacia adelante).', v_m; END IF;
  UPDATE m107_accion SET accion = 'revertir';
END $$;
CREATE TEMP TABLE m107_antes ON COMMIT DROP AS SELECT proowner, proacl FROM pg_proc WHERE oid = 'manufactura.fn_nombre_pdf(text,text,integer)'::regprocedure;
-- Se ejecuta solo si la comprobación lo autorizó (accion = 'revertir'); idempotente si ya estaba revertida.
SELECT CASE (SELECT accion FROM m107_accion) WHEN 'revertir' THEN 'se restaura la definición de la 101' ELSE 'sin cambios: la definición ya es la de la 101' END AS accion;
DO $do$
BEGIN
  IF (SELECT accion FROM m107_accion) = 'revertir' THEN
    EXECUTE $sql$CREATE OR REPLACE FUNCTION manufactura.fn_nombre_pdf(p_codigo text, p_variante text, p_revision integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $fn$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' $fn$$sql$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, m107_antes a WHERE p.oid = 'manufactura.fn_nombre_pdf(text,text,integer)'::regprocedure AND p.proowner = a.proowner AND p.proacl IS NOT DISTINCT FROM a.proacl
                 AND p.prosrc = $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' $b$) THEN
    RAISE EXCEPTION 'ABORTO: la restauración no dejó la definición, el propietario o los privilegios esperados.';
  END IF;
END $do$;
SELECT 'DOWN_OK 107 (fn_nombre_pdf con la definición de la 101; datos intactos)' AS resultado;
COMMIT;
