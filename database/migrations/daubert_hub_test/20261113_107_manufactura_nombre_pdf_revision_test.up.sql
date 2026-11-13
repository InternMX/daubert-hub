-- =====================================================================================================================
-- UP · manufactura · NOMBRE DEL PDF CON REVISIÓN SIN TRUNCAR (SOLO TEST: daubert_hub_test)   [migración 107, adicional a la 101–106]
--
-- PROPÓSITO: que la base y la API calculen EXACTAMENTE el mismo nombre del PDF finalizado, `CODIGO[-VARIANTE]_REVNN.pdf`, también con revisiones de tres o más dígitos.
--   ANTES (101): ... || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf'                                   -> revisión 100 = «REV10», 105 = «REV10» (TRUNCADA)
--   AHORA      : ... || '_REV' || lpad(p_revision::text, greatest(2, length(p_revision::text)), '0') || '.pdf' -> 1 = «REV01», 99 = «REV99», 100 = «REV100», 105 = «REV105»
--   Para revisiones 1–99 el resultado es idéntico al de la 101 (los PDF ya registrados siguen coincidiendo con la función). La API (nombreArchivoFinalizado) usa padStart(2, '0').
--   El código documental se conserva tal cual (CON_REV01.pdf); la variante se normaliza igual que antes.
--
-- ALCANCE (UNA transacción; si algo falla no queda nada). SOLO reemplaza el CUERPO de manufactura.fn_nombre_pdf(text, text, integer) con CREATE OR REPLACE:
--   · Misma firma, mismo lenguaje (sql), IMMUTABLE, SET search_path = pg_catalog, sin SECURITY DEFINER: CREATE OR REPLACE conserva propietario y privilegios (se comprueba al final).
--   · NO toca tablas, columnas, datos, documentos, PDF, firmas, triggers, políticas RLS, privilegios, auditoría ni ninguna otra función. Es la misma definición que la 020 de PROD.
--   · Rechaza cualquier estado desconocido: base distinta, rol no administrativo, 101 ausente, función ausente o con otro propietario, atributos o definición distintos de los de la 101.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_test_user). Antes: precheck (anotar huella_resto). Después: postcheck con -v huella_resto=<valor>.
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261113_107_manufactura_nombre_pdf_revision_test.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE v_oid oid := to_regprocedure('manufactura.fn_nombre_pdf(text,text,integer)'); v_f pg_proc%ROWTYPE;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.pdfs') IS NULL THEN RAISE EXCEPTION 'ABORTO: falta la migración 101.'; END IF;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'ABORTO: no existe manufactura.fn_nombre_pdf(text, text, integer).'; END IF;
  SELECT * INTO v_f FROM pg_proc WHERE oid = v_oid;
  IF v_f.proowner <> (SELECT nspowner FROM pg_namespace WHERE nspname = 'manufactura') THEN RAISE EXCEPTION 'ABORTO: el propietario de fn_nombre_pdf no es el del esquema manufactura.'; END IF;
  IF v_f.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'sql') OR v_f.provolatile <> 'i' OR v_f.prosecdef OR v_f.prorettype <> 'text'::regtype
     OR v_f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'ABORTO: fn_nombre_pdf no tiene los atributos de la 101 (sql, IMMUTABLE, search_path=pg_catalog, sin SECURITY DEFINER).';
  END IF;
  IF v_f.prosrc = $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, greatest(2, length(p_revision::text)), '0') || '.pdf' $b$ THEN
    RAISE EXCEPTION 'ABORTO: la migración 107 ya está aplicada (no se reaplica).';
  END IF;
  IF v_f.prosrc <> $b$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' $b$ THEN
    RAISE EXCEPTION 'ABORTO: la definición de fn_nombre_pdf no es la de la 101 (estado desconocido).';
  END IF;
END $$;

-- Propietario y privilegios ANTES del cambio (se comparan al final).
CREATE TEMP TABLE m107_antes ON COMMIT DROP AS
  SELECT proowner, proacl FROM pg_proc WHERE oid = 'manufactura.fn_nombre_pdf(text,text,integer)'::regprocedure;

CREATE OR REPLACE FUNCTION manufactura.fn_nombre_pdf(p_codigo text, p_variante text, p_revision integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $fn$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, greatest(2, length(p_revision::text)), '0') || '.pdf' $fn$;

-- Validación final dentro de la transacción: si algo no cuadra, se revierte TODO.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, m107_antes a WHERE p.oid = 'manufactura.fn_nombre_pdf(text,text,integer)'::regprocedure
                 AND p.proowner = a.proowner AND p.proacl IS NOT DISTINCT FROM a.proacl AND p.provolatile = 'i' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']) THEN
    RAISE EXCEPTION 'ABORTO: fn_nombre_pdf cambió de propietario, privilegios o atributos.';
  END IF;
  IF manufactura.fn_nombre_pdf('ABC', NULL, 1) <> 'ABC_REV01.pdf' OR manufactura.fn_nombre_pdf('ABC', NULL, 99) <> 'ABC_REV99.pdf'
     OR manufactura.fn_nombre_pdf('ABC', NULL, 100) <> 'ABC_REV100.pdf' OR manufactura.fn_nombre_pdf('HOJA48', 'doblada', 105) <> 'HOJA48-DOBLADA_REV105.pdf'
     OR manufactura.fn_nombre_pdf('CON', NULL, 1) <> 'CON_REV01.pdf' OR manufactura.fn_nombre_pdf('A', 'Doble cara.2', 12) <> 'A-DOBLE-CARA-2_REV12.pdf' THEN
    RAISE EXCEPTION 'ABORTO: fn_nombre_pdf no produce los nombres esperados.';
  END IF;
END $$;

SELECT 'UP_OK manufactura 107 (fn_nombre_pdf: revisión con dos dígitos como mínimo, sin truncar; sin cambios en datos, tablas, triggers, políticas ni privilegios)' AS resultado;
COMMIT;
