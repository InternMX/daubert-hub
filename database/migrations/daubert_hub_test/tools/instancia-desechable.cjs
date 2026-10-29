'use strict';

// Réplica mínima (security.users, core.empresas, audit.cambios + la definición REAL de audit.fn_registrar_cambio) para validar el esquema `manufactura`
// en una instancia PostgreSQL DESECHABLE. Compartida por el arnés de la migración y por las pruebas de integración del gestor documental.
// NUNCA se usa contra daubert_hub_test ni daubert_global: el host y el puerto los fija quien llama (127.0.0.1 + puerto de contenedor temporal).
const INIT = `
CREATE ROLE daubert_hub_test_user LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE daubert_hub_app LOGIN PASSWORD 'scratch';
CREATE ROLE n8n_app LOGIN PASSWORD 'scratch';
CREATE DATABASE daubert_hub_test OWNER postgres;
CREATE DATABASE otra_base OWNER postgres;
\\c daubert_hub_test
CREATE SCHEMA security; CREATE SCHEMA core; CREATE SCHEMA audit; CREATE SCHEMA ops; CREATE SCHEMA operacion;
CREATE TABLE security.users (user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, display_name text NOT NULL, email text NOT NULL, password_hash text NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE core.empresas (empresa_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tipo_empresa text NOT NULL, nombre_comercial text NOT NULL, estatus text NOT NULL DEFAULT 'ACTIVO');
CREATE TABLE audit.cambios (cambio_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, fecha timestamptz NOT NULL DEFAULT now(), esquema text NOT NULL, tabla text NOT NULL, registro_id text, operacion text NOT NULL, usuario_id text, usuario_email text, origen text NOT NULL DEFAULT 'SISTEMA', request_id text, datos_anteriores jsonb, datos_nuevos jsonb);
CREATE FUNCTION audit.fn_registrar_cambio() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'audit' AS $f$
DECLARE v_old JSONB; v_new JSONB; v_row JSONB; v_registro_id TEXT := ''; i INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN v_new := TO_JSONB(NEW);
    ELSIF TG_OP = 'UPDATE' THEN v_old := TO_JSONB(OLD); v_new := TO_JSONB(NEW); IF (v_old - 'updated_at') = (v_new - 'updated_at') THEN RETURN NEW; END IF;
    ELSE v_old := TO_JSONB(OLD); END IF;
    v_row := COALESCE(v_new, v_old);
    FOR i IN 0..TG_NARGS - 1 LOOP IF i > 0 THEN v_registro_id := v_registro_id || '|'; END IF; v_registro_id := v_registro_id || TG_ARGV[i] || '=' || COALESCE(v_row ->> TG_ARGV[i], 'NULL'); END LOOP;
    INSERT INTO audit.cambios (esquema, tabla, registro_id, operacion, usuario_id, usuario_email, origen, request_id, datos_anteriores, datos_nuevos)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, v_registro_id, TG_OP, NULLIF(CURRENT_SETTING('app.user_id', TRUE), ''), NULLIF(CURRENT_SETTING('app.user_email', TRUE), ''), COALESCE(NULLIF(CURRENT_SETTING('app.origin', TRUE), ''), 'SISTEMA'), NULLIF(CURRENT_SETTING('app.request_id', TRUE), ''), v_old, v_new);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $f$;
INSERT INTO security.users (display_name, email, password_hash, role, status) VALUES
  ('Admin Uno', 'admin1@example.invalid', 'x', 'ADMIN', 'ACTIVE'), ('General Dos', 'g2@example.invalid', 'x', 'GENERAL', 'ACTIVE'),
  ('General Tres', 'g3@example.invalid', 'x', 'GENERAL', 'ACTIVE'), ('Inactivo Cuatro', 'g4@example.invalid', 'x', 'GENERAL', 'INACTIVE'),
  ('Admin Cinco', 'admin5@example.invalid', 'x', 'ADMIN', 'ACTIVE');
CREATE TABLE core.empresa_roles (empresa_id bigint NOT NULL REFERENCES core.empresas, rol text NOT NULL, estatus text NOT NULL DEFAULT 'ACTIVO');
INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('CLIENTE', 'Cliente simulado'), ('PROVEEDOR', 'Proveedor simulado');
INSERT INTO core.empresa_roles (empresa_id, rol) VALUES (1, 'CLIENTE'), (2, 'PROVEEDOR');
GRANT USAGE ON SCHEMA security, core, audit TO daubert_hub_test_user;
GRANT SELECT ON security.users, core.empresas, core.empresa_roles TO daubert_hub_test_user;
GRANT SELECT, INSERT ON audit.cambios TO daubert_hub_test_user;
`;

module.exports = { INIT };
