-- Administrative TEST connection ONLY. Synthetic fixtures and SQL contract assertions.
-- No Outlook/n8n calls, no real files, no changes to existing users or aliases.
-- Run AFTER 012 up + postcheck. Refuses to overwrite a previous fixture set.
BEGIN;
SET LOCAL statement_timeout = '30s';
DO $fixtures$
DECLARE
  v_marker constant text := 'HUB_TEST_FILE_ASSIGNMENTS_V1';
  v_company bigint;
  v_correo bigint;
  v_file bigint;
  v_again bigint;
  v_hash text := encode(sha256(convert_to('%PDF-1.4 SYNTHETIC_A EOF', 'UTF8')), 'hex');
  v_hash_b text := encode(sha256(convert_to('%PDF-1.4 SYNTHETIC_B EOF', 'UTF8')), 'hex');
  v_zip text := encode(sha256(convert_to('SYNTHETIC_ZIP_A', 'UTF8')), 'hex');
  v_zip_b text := encode(sha256(convert_to('SYNTHETIC_ZIP_B', 'UTF8')), 'hex');
  v_case text;
  v_cases text[] := ARRAY['SAFE01','SAFE02','SAFE03','SAFE04','SAFE05','SAFE06','SAFE07','SAFE08',
    'SAFE09','SAFE10','SAFE11','SAFE12','UNKNOWN','UNVERIFIED','DUPLICATE','CONFLICT','CHANGED_ZIP',
    'RESULT_EFFECT','DRAFT_EFFECT','STARTED','PENDING','LEGACY'];
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'Fixtures restricted to daubert_hub_test'; END IF;
  IF EXISTS (SELECT 1 FROM core.correos_notificacion_pago WHERE outlook_message_id LIKE v_marker || '%')
     OR EXISTS (SELECT 1 FROM core.empresas WHERE nombre_comercial LIKE v_marker || '%') THEN
    RAISE EXCEPTION 'Fixture set already exists; do not overwrite or delete it automatically';
  END IF;
  PERFORM set_config('app.origin', 'DAUBERT_HUB_TEST', true);
  PERFORM set_config('app.request_id', v_marker, true);
  FOR i IN 1..3 LOOP
    INSERT INTO core.empresas(tipo_empresa, nombre_comercial, estatus)
      VALUES ('PROVEEDOR', v_marker || '_COMPANY_' || i, 'ACTIVO') RETURNING empresa_id INTO v_company;
    INSERT INTO core.empresa_roles(empresa_id, rol, estatus) VALUES (v_company, 'PROVEEDOR', 'ACTIVO');
    INSERT INTO core.empresas_notificacion_pago(empresa_id, procesa_comprobantes_pago, notificaciones_activas)
      VALUES (v_company, true, false);
  END LOOP;
  FOREACH v_case IN ARRAY v_cases LOOP
    INSERT INTO core.correos_notificacion_pago(outlook_message_id, estado)
      VALUES (v_marker || '_' || v_case, 'PENDIENTE') RETURNING correo_id INTO v_correo;
    IF v_case <> 'LEGACY' THEN
      v_file := core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip,
        0, v_hash, 'synthetic-a.pdf', 'SYNTHETIC ALIAS A', 'ALIAS_NO_CATALOGADO',
        v_case <> 'UNVERIFIED', v_case NOT IN ('UNKNOWN', 'UNVERIFIED'));
      v_again := core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip,
        0, v_hash, 'synthetic-a.pdf', 'SYNTHETIC ALIAS A', 'ALIAS_NO_CATALOGADO', true, true);
      IF v_again <> v_file THEN RAISE EXCEPTION 'Registration is not idempotent'; END IF;
      IF v_case IN ('UNKNOWN', 'UNVERIFIED') AND EXISTS (
        SELECT 1 FROM core.archivos_notificacion_pago WHERE archivo_id = v_file AND estado_operativo = 'SIN_EFECTOS'
      ) THEN RAISE EXCEPTION 'Re-registration incorrectly promoted uncertain history'; END IF;
      IF v_case LIKE 'SAFE%' THEN
        -- Same file names/hashes in different correos are deliberately distinct occurrences.
        PERFORM core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip,
          1, v_hash_b, 'synthetic-b.pdf', 'SYNTHETIC ALIAS B', 'ALIAS_NO_CATALOGADO', true, true);
      ELSIF v_case = 'DUPLICATE' THEN
        -- Distinct ZIP entries, same bytes and name: legacy errors cannot disambiguate them.
        v_again := core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip,
          1, v_hash, 'synthetic-a.pdf', 'SYNTHETIC ALIAS A', 'ALIAS_NO_CATALOGADO', true, true);
        IF v_again = v_file THEN RAISE EXCEPTION 'Duplicate ZIP occurrences were collapsed'; END IF;
      ELSIF v_case = 'CONFLICT' THEN
        PERFORM core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip,
          0, v_hash_b, 'synthetic-a.pdf', 'SYNTHETIC ALIAS A', 'ALIAS_NO_CATALOGADO', true, true);
        IF NOT EXISTS (SELECT 1 FROM core.archivos_notificacion_pago
          WHERE archivo_id = v_file AND estado_identidad = 'AMBIGUA' AND file_sha256 = v_hash) THEN
          RAISE EXCEPTION 'Conflicting registration overwrote immutable provenance';
        END IF;
      ELSIF v_case = 'CHANGED_ZIP' THEN
        PERFORM core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip_b,
          0, v_hash, 'synthetic-a.pdf', 'SYNTHETIC ALIAS A', 'ALIAS_NO_CATALOGADO', true, true);
        IF EXISTS (SELECT 1 FROM core.archivos_notificacion_pago
          WHERE correo_id = v_correo AND estado_identidad <> 'AMBIGUA') THEN
          RAISE EXCEPTION 'Changed ZIP was silently accepted';
        END IF;
      ELSIF v_case = 'STARTED' THEN
        PERFORM * FROM core.fn_resolver_archivo_notificacion_pago(v_file, v_correo,
          'SYNTHETIC_ATTACHMENT_A', v_zip, 0, v_hash, true);
        PERFORM core.fn_registrar_archivo_notificacion_pago(v_correo, 'SYNTHETIC_ATTACHMENT_A', v_zip,
          0, v_hash, 'synthetic-a.pdf', 'SYNTHETIC ALIAS A', 'ALIAS_NO_CATALOGADO', true, true);
        IF NOT EXISTS (SELECT 1 FROM core.archivos_notificacion_pago
          WHERE archivo_id = v_file AND estado_operativo = 'INICIADO') THEN
          RAISE EXCEPTION 'Operational claim was reset';
        END IF;
      END IF;
      -- Explicit NULL provenance must fail closed, not bypass SQL three-valued comparisons.
      BEGIN
        PERFORM * FROM core.fn_resolver_archivo_notificacion_pago(v_file, v_correo, NULL, v_zip, 0, v_hash, false);
        RAISE EXCEPTION 'NULL provenance unexpectedly accepted';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'PAYMENT_FILE_IDENTITY_MISMATCH' THEN RAISE; END IF;
      END;
    END IF;
    UPDATE core.correos_notificacion_pago SET
      estado = CASE WHEN v_case = 'PENDING' THEN 'PENDIENTE' ELSE 'ERROR' END,
      detalle_error = 'synthetic-a.pdf: ALIAS_NO_CATALOGADO - SYNTHETIC ALIAS A | HASH=' || v_hash ||
        CASE WHEN v_case LIKE 'SAFE%' THEN ' | synthetic-b.pdf: ALIAS_NO_CATALOGADO - SYNTHETIC ALIAS B | HASH=' || v_hash_b
             WHEN v_case = 'DUPLICATE' THEN ' | synthetic-a.pdf: ALIAS_NO_CATALOGADO - SYNTHETIC ALIAS A | HASH=' || v_hash
             ELSE '' END,
      updated_at = clock_timestamp()
      WHERE correo_id = v_correo;
    IF v_case = 'RESULT_EFFECT' THEN
      INSERT INTO core.resultados_notificacion_pago(correo_id, empresa_id, estado)
        VALUES (v_correo, v_company, 'LISTO');
    ELSIF v_case = 'DRAFT_EFFECT' THEN
      INSERT INTO core.borradores_notificacion_pago(correo_id, empresa_id, estado)
        VALUES (v_correo, v_company, 'PENDIENTE'); -- Synthetic database fixture; NO Outlook operation.
    END IF;
    IF v_case IN ('UNKNOWN','UNVERIFIED','CONFLICT','CHANGED_ZIP','RESULT_EFFECT','DRAFT_EFFECT','STARTED','PENDING')
       AND core.fn_archivo_notificacion_asignable(v_file, v_correo) THEN
      RAISE EXCEPTION 'Unsafe fixture % was considered assignable', v_case;
    END IF;
    IF v_case LIKE 'SAFE%' AND NOT core.fn_archivo_notificacion_asignable(v_file, v_correo) THEN
      RAISE EXCEPTION 'Verified safe fixture unexpectedly blocked';
    END IF;
  END LOOP;
END $fixtures$;
SELECT 'Synthetic fixtures + trusted SQL contract assertions OK' AS result,
  (SELECT count(*) FROM core.correos_notificacion_pago WHERE outlook_message_id LIKE 'HUB_TEST_FILE_ASSIGNMENTS_V1_%') AS synthetic_correo_count;
COMMIT;
