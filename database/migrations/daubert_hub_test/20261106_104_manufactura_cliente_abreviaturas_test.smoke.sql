-- =====================================================================================================================
-- SMOKE · manufactura 104 · abreviaturas de cliente (SOLO TEST, OPCIONAL, tras el postcheck) — con el ROL DE LA APLICACIÓN
-- Todo queda dentro de una transacción que termina en ROLLBACK (no deja abreviaturas ni residuos de auditoría; NO crea empresas). Requiere 1 ADMIN y 2 GENERAL activos y 2 clientes (rol CLIENTE activo).
--   psql -h localhost -p 5432 -d daubert_hub_test -U daubert_hub_test_user -X -w -v ON_ERROR_STOP=1 -f 20261106_104_manufactura_cliente_abreviaturas_test.smoke.sql
-- Esperado: todas las filas con ok = true y smoke_all_pass = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
DO $$ BEGIN IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test.'; END IF; END $$;
SELECT (SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') AS audit_antes \gset
BEGIN;
DO $$ BEGIN IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: ejecútelo con el rol de la aplicación.'; END IF; END $$;
CREATE TEMP TABLE _res (n serial, prueba text, ok boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.yo(p_id bigint, p_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.request_id', 'smoke104-' || p_id, true), set_config('app.user_id', p_id::text, true), set_config('app.user_email', p_email, true) $$;

DO $$
DECLARE
  v_adm bigint; v_adm_e text; v_g1 bigint; v_g1_e text; v_g2 bigint; v_g2_e text; v_c1 bigint; v_c2 bigint; v_noc bigint; v_a1 bigint; v_a2 bigint; v_n int; v_ok boolean; v_pub uuid;
BEGIN
  SELECT user_id, email INTO v_adm, v_adm_e FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g1, v_g1_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' ORDER BY user_id LIMIT 1;
  SELECT user_id, email INTO v_g2, v_g2_e FROM security.users WHERE role = 'GENERAL' AND status = 'ACTIVE' AND user_id <> v_g1 ORDER BY user_id LIMIT 1;
  IF v_adm IS NULL OR v_g1 IS NULL OR v_g2 IS NULL THEN RAISE EXCEPTION 'Se requieren 1 ADMIN y 2 GENERAL activos.'; END IF;
  SELECT e.empresa_id INTO v_c1 FROM core.empresas e WHERE manufactura.fn_cliente_vigente(e.empresa_id) ORDER BY e.empresa_id LIMIT 1;
  SELECT e.empresa_id INTO v_c2 FROM core.empresas e WHERE manufactura.fn_cliente_vigente(e.empresa_id) AND e.empresa_id <> v_c1 ORDER BY e.empresa_id LIMIT 1;
  SELECT e.empresa_id INTO v_noc FROM core.empresas e WHERE NOT manufactura.fn_cliente_vigente(e.empresa_id) ORDER BY e.empresa_id LIMIT 1;
  IF v_c1 IS NULL OR v_c2 IS NULL THEN RAISE EXCEPTION 'Se requieren 2 clientes (rol CLIENTE activo) en core.empresas.'; END IF;

  -- T1/T2/T3: una cuenta GENERAL solo PROPONE
  PERFORM pg_temp.yo(v_g1, v_g1_e);
  INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('zzq', v_c1, 'PROPUESTA', 'PROPUESTA_USUARIO') RETURNING abreviatura_id, public_id INTO v_a1, v_pub;
  INSERT INTO _res (prueba, ok) SELECT 'GENERAL propone (se normaliza a mayúsculas, queda PROPUESTA)', (abreviatura = 'ZZQ' AND estado = 'PROPUESTA' AND propuesta_por_usuario_id = v_g1) FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = v_a1;
  BEGIN INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZR', v_c1, 'CONFIRMADA', 'PROPUESTA_USUARIO'); INSERT INTO _res (prueba, ok) VALUES ('GENERAL no puede crear CONFIRMADA', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('GENERAL no puede crear CONFIRMADA', true); END;
  BEGIN INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZR', v_c1, 'CANDIDATA', 'EXTRACCION_HISTORICA'); INSERT INTO _res (prueba, ok) VALUES ('GENERAL no puede crear CANDIDATA ni origen de extracción', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('GENERAL no puede crear CANDIDATA ni origen de extracción', true); END;
  -- T4: GENERAL no resuelve
  BEGIN UPDATE manufactura.cliente_abreviaturas SET estado = 'CONFIRMADA' WHERE abreviatura_id = v_a1; INSERT INTO _res (prueba, ok) VALUES ('GENERAL no puede confirmar su propia propuesta', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('GENERAL no puede confirmar su propia propuesta', true); END;
  -- T5: otra cuenta GENERAL no ve la propuesta ajena
  PERFORM pg_temp.yo(v_g2, v_g2_e);
  SELECT count(*) INTO v_n FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = v_a1;
  INSERT INTO _res (prueba, ok) VALUES ('otra cuenta GENERAL no ve una propuesta ajena sin confirmar', v_n = 0);

  -- T6: ADMIN confirma; deja resolución; misma abreviatura para otro cliente es válida; duplicado exacto no
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  UPDATE manufactura.cliente_abreviaturas SET estado = 'CONFIRMADA' WHERE abreviatura_id = v_a1;
  INSERT INTO _res (prueba, ok) SELECT 'ADMIN confirma y queda registrado quién resolvió y cuándo', (estado = 'CONFIRMADA' AND resuelta_por_usuario_id = v_adm AND resuelta_en IS NOT NULL) FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = v_a1;
  BEGIN INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZQ', v_c1, 'PROPUESTA', 'MANUAL_ADMIN'); INSERT INTO _res (prueba, ok) VALUES ('duplicado exacto vigente rechazado', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _res (prueba, ok) VALUES ('duplicado exacto vigente rechazado', true); END;
  INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen, documentos_evidencia, codigos_evidencia) VALUES ('ZZQ', v_c2, 'CONFIRMADA', 'MANUAL_ADMIN', 3, 2) RETURNING abreviatura_id INTO v_a2;
  INSERT INTO _res (prueba, ok) VALUES ('la misma abreviatura se asocia a otro cliente (prefijo compartido legítimo)', v_a2 IS NOT NULL);
  IF v_noc IS NOT NULL THEN
    BEGIN INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZN', v_noc, 'PROPUESTA', 'MANUAL_ADMIN'); INSERT INTO _res (prueba, ok) VALUES ('un cliente sin rol CLIENTE activo es rechazado', false);
    EXCEPTION WHEN integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('un cliente sin rol CLIENTE activo es rechazado', true); END;
  ELSE INSERT INTO _res (prueba, ok) VALUES ('un cliente sin rol CLIENTE activo es rechazado (omitida: no hay empresa que no sea cliente)', true); END IF;

  -- T7: motor de sugerencias
  SELECT count(*) FILTER (WHERE requiere_eleccion AND decisivo AND nivel = 3) INTO v_n FROM manufactura.fn_sugerir_cliente('ZZQFPMG001');
  INSERT INTO _res (prueba, ok) VALUES ('abreviatura compartida: ofrece las dos alternativas y exige elegir', v_n = 2);
  INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, alcance, codigo_patron, estado, origen) VALUES ('ZZQ', v_c2, 'CODIGO_COMPLETO', 'ZZQFPMG001', 'CONFIRMADA', 'MANUAL_ADMIN');
  INSERT INTO _res (prueba, ok) SELECT 'excepción por código completo confirmada tiene prioridad (sin ambigüedad) y conserva las demás como información', count(*) FILTER (WHERE decisivo AND nivel = 1 AND NOT requiere_eleccion AND cliente_empresa_id = v_c2) = 1 AND count(*) = 3 FROM manufactura.fn_sugerir_cliente('ZZQFPMG001');
  INSERT INTO _res (prueba, ok) SELECT 'un código distinto sigue sin excepción: vuelve a exigir elección', count(*) FILTER (WHERE requiere_eleccion) = 2 FROM manufactura.fn_sugerir_cliente('ZZQFPMG002');
  INSERT INTO _res (prueba, ok) SELECT 'sin asociación: no devuelve nada (el usuario elige o escribe el cliente)', count(*) = 0 FROM manufactura.fn_sugerir_cliente('QQQFPMG001');
  INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZW', v_c1, 'CANDIDATA', 'EXTRACCION_HISTORICA');
  INSERT INTO _res (prueba, ok) SELECT 'una CANDIDATA no se sugiere salvo que se pida, y entonces nunca es decisiva', (SELECT count(*) FROM manufactura.fn_sugerir_cliente('ZZWFPMG001')) = 0
     AND (SELECT count(*) FILTER (WHERE nivel = 9 AND NOT decisivo AND requiere_eleccion) FROM manufactura.fn_sugerir_cliente('ZZWFPMG001', true)) = 1;

  -- T8: inmutabilidad, borrado y sesión
  BEGIN UPDATE manufactura.cliente_abreviaturas SET cliente_empresa_id = v_c2 WHERE abreviatura_id = v_a1; INSERT INTO _res (prueba, ok) VALUES ('el cliente de una asociación no se cambia', false);
  EXCEPTION WHEN insufficient_privilege OR integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('el cliente de una asociación no se cambia', true); END;
  BEGIN DELETE FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = v_a1; INSERT INTO _res (prueba, ok) VALUES ('no se borran asociaciones', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _res (prueba, ok) VALUES ('no se borran asociaciones', true); END;
  PERFORM set_config('app.user_id', '', true); PERFORM set_config('app.user_email', '', true);
  BEGIN INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZV', v_c1, 'PROPUESTA', 'MANUAL_ADMIN'); INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión no se registra nada', false);
  EXCEPTION WHEN insufficient_privilege OR integrity_constraint_violation THEN INSERT INTO _res (prueba, ok) VALUES ('sin identidad de sesión no se registra nada', true); END;
  PERFORM pg_temp.yo(v_adm, v_adm_e);
  SELECT count(*) INTO v_n FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'cliente_abreviaturas';
  INSERT INTO _res (prueba, ok) VALUES ('las altas y resoluciones quedan en auditoría', v_n >= 4);
END $$;

SELECT n, prueba, ok FROM _res ORDER BY n;
SELECT bool_and(ok) AS smoke_all_pass, count(*) AS pruebas FROM _res;
ROLLBACK;
-- Tras el ROLLBACK no debe quedar nada de la prueba.
SELECT (SELECT count(*) FROM manufactura.cliente_abreviaturas) AS abreviaturas_tras_rollback, ((SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura') - :audit_antes) AS audit_residuos;
