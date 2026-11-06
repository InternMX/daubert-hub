-- Synthetic MINIMAL schema for isolated PostgreSQL/PGlite only; never a Daubert migration.
CREATE ROLE daubert_hub_test_user LOGIN;
CREATE ROLE daubert_hub_app LOGIN;
CREATE ROLE n8n_app LOGIN;
CREATE ROLE n8n_cat_test LOGIN;
CREATE SCHEMA operacion; CREATE SCHEMA ops; CREATE SCHEMA security; CREATE SCHEMA core;
GRANT USAGE ON SCHEMA operacion TO daubert_hub_test_user,n8n_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA operacion GRANT ALL ON TABLES TO n8n_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA operacion GRANT ALL ON FUNCTIONS TO n8n_app;
CREATE TABLE security.users (user_id bigint PRIMARY KEY, email text NOT NULL, display_name text NOT NULL,
  role text NOT NULL, status text NOT NULL, must_change_password boolean NOT NULL);
INSERT INTO security.users VALUES (1,'admin@example.invalid','Admin histórico','ADMIN','ACTIVE',false),
  (2,'general@example.invalid','General','GENERAL','ACTIVE',false);
CREATE TABLE ops.automatizaciones (automatizacion_id bigint PRIMARY KEY,codigo text NOT NULL);
INSERT INTO ops.automatizaciones VALUES (1,'REMISIONES_CATERPILLAR'),(2,'REMISIONES_AUDI');
CREATE TABLE ops.ejecuciones_automatizacion (ejecucion_id bigint PRIMARY KEY,automatizacion_id bigint NOT NULL,estado text NOT NULL);
CREATE TABLE operacion.series_documentales (serie_id bigint PRIMARY KEY,siguiente_folio bigint,folio_minimo_ajustable bigint);
INSERT INTO operacion.series_documentales VALUES (5,200,119);
CREATE TABLE operacion.reservas_folios (reserva_id bigint PRIMARY KEY,ejecucion_id bigint,estatus text);
CREATE TABLE operacion.remisiones (remision_id bigint PRIMARY KEY,ejecucion_id bigint NOT NULL,serie_id bigint,
  folio bigint,estatus text NOT NULL,motivo_cancelacion text,pdf_path text,updated_at timestamptz NOT NULL);
CREATE TABLE operacion.remision_detalle (detalle_id bigint PRIMARY KEY,remision_id bigint,cantidad_texto text);
CREATE FUNCTION core.fn_actualizar_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER trg_remisiones_updated_at BEFORE UPDATE ON operacion.remisiones
  FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at();
