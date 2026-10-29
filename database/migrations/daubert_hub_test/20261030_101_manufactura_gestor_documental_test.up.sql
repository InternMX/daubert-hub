-- =====================================================================================================================
-- UP · manufactura · gestor documental de Hojas de Instrucción de Manufactura (SOLO TEST: daubert_hub_test)
--
-- ALCANCE DE LAS ESCRITURAS (todo dentro de UNA transacción; si algo falla no queda nada):
--   · CREA el esquema `manufactura` (dueño: el rol administrativo que ejecuta) con 5 tablas, sus funciones y triggers.
--   · CONCEDE al rol `daubert_hub_test_user` SOLO los privilegios de datos listados al final (sin DDL, sin DELETE).
--   · NO modifica ni lee datos de ninguna tabla existente; NO toca core, security, ops, operacion, audit (salvo
--     que los triggers de auditoría nuevos escribirán en audit.cambios cuando la aplicación use las tablas nuevas).
--   · NO toca roles, permisos de otras bases, daubert_global ni n8n.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_test_user):
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
--        -f 20261030_101_manufactura_gestor_documental_test.up.sql
-- Requisito previo: backup confirmado y precheck con ALL_PRECHECKS_PASS = true.
-- =====================================================================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- 0. Guards de destino y de estado (se repiten aquí: el precheck pudo ejecutarse contra otra base).
DO $$
DECLARE v_app pg_roles%ROWTYPE;
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN
    RAISE EXCEPTION 'ABORTO: esta migración es solo para daubert_hub_test (base actual: %).', current_database();
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo (el rol actual % no es administrador).', current_user;
  END IF;
  SELECT * INTO v_app FROM pg_roles WHERE rolname = 'daubert_hub_test_user';
  IF NOT FOUND OR v_app.rolsuper OR v_app.rolcreaterole OR v_app.rolcreatedb THEN
    RAISE EXCEPTION 'ABORTO: el rol daubert_hub_test_user no existe o tiene privilegios que no debe tener.';
  END IF;
  IF to_regclass('security.users') IS NULL OR to_regclass('core.empresas') IS NULL OR to_regproc('audit.fn_registrar_cambio') IS NULL THEN
    RAISE EXCEPTION 'ABORTO: faltan objetos requeridos (security.users, core.empresas, audit.fn_registrar_cambio).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') THEN
    RAISE EXCEPTION 'ABORTO: el esquema manufactura ya existe (no se reaplica).';
  END IF;
END $$;

CREATE SCHEMA manufactura;
COMMENT ON SCHEMA manufactura IS 'Gestor documental de Hojas de Instrucción de Manufactura (TEST). Revisiones finalizadas inmutables; PDF almacenados con SHA-256.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Funciones auxiliares
-- ---------------------------------------------------------------------------------------------------------------------

-- Identidad de auditoría de la transacción: la fija la API desde la SESIÓN autenticada con set_config('app.user_id'/'app.user_email', ..., true)
-- (el mismo mecanismo que usa audit.fn_registrar_cambio). Sin identidad no se escribe: el actor nunca viene de columnas enviadas por el cliente.
CREATE FUNCTION manufactura.fn_actor(OUT usuario_id bigint, OUT usuario_email text)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $fn$
BEGIN
  usuario_id    := NULLIF(current_setting('app.user_id', true), '')::bigint;
  usuario_email := NULLIF(current_setting('app.user_email', true), '');
  IF usuario_id IS NULL OR usuario_email IS NULL THEN
    RAISE EXCEPTION 'Sin identidad de sesión (app.user_id / app.user_email): no se registra la operación.' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$fn$;

CREATE FUNCTION manufactura.fn_hash_json(p jsonb) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fn$ SELECT encode(sha256(convert_to(p::text, 'UTF8')), 'hex') $fn$;

CREATE FUNCTION manufactura.fn_inmutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION '%.% es inmutable: no admite % (corrija con una nueva revisión o un nuevo registro).', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Documentos: una línea de revisiones de una hoja. UN CÓDIGO DCMX puede tener VARIAS hojas (variantes: p. ej. Hojas
--    doblada / extendida, otra etiqueta o cliente). La regla es (código, variante) único; no «un documento por código».
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.documentos (
  documento_id          bigint GENERATED ALWAYS AS IDENTITY,
  public_id             uuid NOT NULL DEFAULT gen_random_uuid(),
  codigo_dcmx           text NOT NULL,
  codigo_clave          text GENERATED ALWAYS AS (lower(codigo_dcmx)) STORED,
  variante              text,
  variante_clave        text GENERATED ALWAYS AS (lower(coalesce(variante, ''))) STORED,
  creado_por_usuario_id bigint NOT NULL,
  creado_por_email      text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_manufactura_documentos PRIMARY KEY (documento_id),
  CONSTRAINT uq_manufactura_documentos_public UNIQUE (public_id),
  CONSTRAINT uq_manufactura_documentos_codigo_variante UNIQUE (codigo_clave, variante_clave),
  CONSTRAINT ck_manufactura_documentos_codigo CHECK (codigo_dcmx ~ '^[A-Za-z0-9._-]{1,64}$' AND codigo_dcmx !~ '^[.-]'),
  CONSTRAINT ck_manufactura_documentos_variante CHECK (variante IS NULL OR variante ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$'),
  CONSTRAINT fk_manufactura_documentos_usuario FOREIGN KEY (creado_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_documentos_email CHECK (btrim(creado_por_email) <> '')
);
COMMENT ON TABLE manufactura.documentos IS 'Línea de revisiones de una hoja. Único por (código DCMX, variante); un código puede tener varias variantes. Inmutable.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Revisiones: borradores y versiones finalizadas, con la COPIA de la especificación técnica utilizada.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.revisiones (
  revision_id                bigint GENERATED ALWAYS AS IDENTITY,
  public_id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  documento_id               bigint NOT NULL,
  revision                   integer,                       -- NULL hasta finalizar; 1, 2, 3… al finalizar (la asigna el trigger)
  estado                     text NOT NULL DEFAULT 'BORRADOR',
  version                    integer NOT NULL DEFAULT 1,    -- bloqueo optimista de edición
  familia                    text NOT NULL,
  especificacion             jsonb NOT NULL,                -- copia de la especificación (datos, procedencia, color, incidencias reconocidas, 6 campos de BIND)
  especificacion_sha256      text NOT NULL,                 -- lo calcula el trigger (no la aplicación)
  elaboro_nombre             text,                          -- nombre IMPRESO (sugerido desde la sesión, editable); NO es la identidad de auditoría
  elaboro_confirmado         boolean NOT NULL DEFAULT false,
  autorizo_nombre            text,                          -- opcional; sin flujo de autorización
  revisor_usuario_id         bigint,                        -- revisor asignado (ve el borrador y puede registrar su revisión)
  cliente_empresa_id         bigint,
  cliente_nombre             text,
  cliente_verificado         boolean NOT NULL DEFAULT false,-- true = vinculado a core.empresas; false = identificación manual de TEST (no apta para emisión)
  basada_en_revision_id      bigint,
  creado_por_usuario_id      bigint NOT NULL,
  creado_por_email           text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  actualizado_por_usuario_id bigint NOT NULL,
  actualizado_por_email      text NOT NULL,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  finalizando_token          uuid,                          -- lo genera la base al pasar a FINALIZANDO
  finalizando_por_usuario_id bigint,
  finalizando_por_email      text,
  finalizando_desde          timestamptz,
  finalizado_por_usuario_id  bigint,
  finalizado_por_email       text,
  finalizado_en              timestamptz,
  CONSTRAINT pk_manufactura_revisiones PRIMARY KEY (revision_id),
  CONSTRAINT uq_manufactura_revisiones_public UNIQUE (public_id),
  CONSTRAINT uq_manufactura_revisiones_doc_id UNIQUE (documento_id, revision_id),
  CONSTRAINT uq_manufactura_revisiones_doc_revision UNIQUE (documento_id, revision),
  CONSTRAINT fk_manufactura_revisiones_documento FOREIGN KEY (documento_id) REFERENCES manufactura.documentos (documento_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_basada FOREIGN KEY (documento_id, basada_en_revision_id) REFERENCES manufactura.revisiones (documento_id, revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_cliente FOREIGN KEY (cliente_empresa_id) REFERENCES core.empresas (empresa_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_revisor FOREIGN KEY (revisor_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_creado FOREIGN KEY (creado_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_actualizado FOREIGN KEY (actualizado_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_finalizando FOREIGN KEY (finalizando_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_revisiones_finalizado FOREIGN KEY (finalizado_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_revisiones_estado CHECK (estado IN ('BORRADOR', 'FINALIZANDO', 'FINALIZADA', 'DESCARTADA')),
  CONSTRAINT ck_manufactura_revisiones_version CHECK (version >= 1),
  CONSTRAINT ck_manufactura_revisiones_revision CHECK (revision IS NULL OR revision >= 1),
  CONSTRAINT ck_manufactura_revisiones_familia CHECK (familia IN ('BOLSA_PLANA_1', 'HOJA_PAQ', 'BOLSA_FUELLE', 'BOLSA_NATURAL', 'ROLLO_CONTINUO', 'TERMOENCOGIBLE', 'COEX')),
  CONSTRAINT ck_manufactura_revisiones_especificacion CHECK (
    jsonb_typeof(especificacion) = 'object' AND especificacion ? 'datos' AND octet_length(especificacion::text) <= 65536
    -- defensa en profundidad: ninguna credencial ni token de BIND/sesión entra en la copia
    AND especificacion::text !~* '(authorization|bearer[[:space:]]|api[_-]?key|subscription[_-]?key|password|passwd|secret|token)'
  ),
  CONSTRAINT ck_manufactura_revisiones_hash CHECK (especificacion_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_manufactura_revisiones_nombres CHECK (
    (elaboro_nombre IS NULL OR (btrim(elaboro_nombre) <> '' AND char_length(elaboro_nombre) <= 120))
    AND (autorizo_nombre IS NULL OR (btrim(autorizo_nombre) <> '' AND char_length(autorizo_nombre) <= 120))
    AND (cliente_nombre IS NULL OR (btrim(cliente_nombre) <> '' AND char_length(cliente_nombre) <= 200))
  ),
  CONSTRAINT ck_manufactura_revisiones_cliente CHECK (cliente_verificado = false OR cliente_empresa_id IS NOT NULL),
  CONSTRAINT ck_manufactura_revisiones_coherencia CHECK (
    CASE estado
      WHEN 'BORRADOR'    THEN revision IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL AND finalizado_por_usuario_id IS NULL
      WHEN 'FINALIZANDO' THEN revision IS NULL AND finalizando_token IS NOT NULL AND finalizando_desde IS NOT NULL AND finalizando_por_usuario_id IS NOT NULL AND finalizado_en IS NULL
      WHEN 'FINALIZADA'  THEN revision IS NOT NULL AND finalizando_token IS NULL AND finalizado_en IS NOT NULL AND finalizado_por_usuario_id IS NOT NULL AND finalizado_por_email IS NOT NULL
                              AND cliente_nombre IS NOT NULL AND elaboro_nombre IS NOT NULL AND elaboro_confirmado
      WHEN 'DESCARTADA'  THEN revision IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL
      ELSE false
    END
  )
);
-- Un solo borrador (o finalización en curso) por documento.
CREATE UNIQUE INDEX uq_manufactura_revisiones_abierta ON manufactura.revisiones (documento_id) WHERE estado IN ('BORRADOR', 'FINALIZANDO');
CREATE INDEX ix_manufactura_revisiones_estado ON manufactura.revisiones (estado, updated_at DESC);
CREATE INDEX ix_manufactura_revisiones_creador ON manufactura.revisiones (creado_por_usuario_id);
CREATE INDEX ix_manufactura_revisiones_revisor ON manufactura.revisiones (revisor_usuario_id) WHERE revisor_usuario_id IS NOT NULL;
COMMENT ON TABLE manufactura.revisiones IS 'Borradores y versiones de una hoja con la copia de la especificación. FINALIZADA es inmutable (trigger). Actor tomado de app.user_id/app.user_email.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. PDF finalizado: metadatos (auditable) y contenido (bytea) separados; el contenido NO se audita para no copiar bytes a audit.cambios.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.pdfs (
  revision_id               bigint NOT NULL,
  pdf_sha256                text NOT NULL,
  bytes                     integer NOT NULL,
  especificacion_sha256     text NOT NULL,                  -- hash de la copia de la que PROCEDE el PDF (debe coincidir con la revisión)
  nombre_archivo            text NOT NULL,
  generado_por_usuario_id   bigint NOT NULL,
  generado_por_email        text NOT NULL,
  generado_en               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_manufactura_pdfs PRIMARY KEY (revision_id),
  CONSTRAINT fk_manufactura_pdfs_revision FOREIGN KEY (revision_id) REFERENCES manufactura.revisiones (revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_pdfs_usuario FOREIGN KEY (generado_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_pdfs_sha CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$' AND especificacion_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_manufactura_pdfs_bytes CHECK (bytes BETWEEN 1 AND 5242880),
  CONSTRAINT ck_manufactura_pdfs_nombre CHECK (nombre_archivo ~ '^[A-Za-z0-9._-]{1,120}\.pdf$')
);
CREATE TABLE manufactura.pdf_contenidos (
  revision_id bigint NOT NULL,
  contenido   bytea NOT NULL,
  CONSTRAINT pk_manufactura_pdf_contenidos PRIMARY KEY (revision_id),
  CONSTRAINT fk_manufactura_pdf_contenidos FOREIGN KEY (revision_id) REFERENCES manufactura.pdfs (revision_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_pdf_contenidos_tamano CHECK (octet_length(contenido) BETWEEN 1 AND 5242880)
);
ALTER TABLE manufactura.pdf_contenidos ALTER COLUMN contenido SET STORAGE EXTERNAL;   -- un PDF ya viene comprimido: sin recompresión TOAST

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Confirmaciones de revisión: acción AUTENTICADA y vinculada al contenido (versión + hash); nunca por capturar un nombre.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.confirmaciones_revision (
  confirmacion_id       bigint GENERATED ALWAYS AS IDENTITY,
  revision_id           bigint NOT NULL,
  usuario_id            bigint NOT NULL,
  usuario_email         text NOT NULL,
  usuario_nombre        text NOT NULL,                      -- display_name en el momento de la revisión
  version               integer NOT NULL,
  especificacion_sha256 text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_manufactura_confirmaciones PRIMARY KEY (confirmacion_id),
  CONSTRAINT uq_manufactura_confirmaciones UNIQUE (revision_id, usuario_id, especificacion_sha256),
  CONSTRAINT fk_manufactura_confirmaciones_revision FOREIGN KEY (revision_id) REFERENCES manufactura.revisiones (revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_confirmaciones_usuario FOREIGN KEY (usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_confirmaciones_sha CHECK (especificacion_sha256 ~ '^[0-9a-f]{64}$')
);

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Triggers de integridad (la API es la primera barrera; la base garantiza lo esencial aunque la API falle)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION manufactura.fn_documentos_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO NEW.creado_por_usuario_id, NEW.creado_por_email FROM manufactura.fn_actor() a;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_documentos_insert BEFORE INSERT ON manufactura.documentos FOR EACH ROW EXECUTE FUNCTION manufactura.fn_documentos_before_insert();
CREATE TRIGGER trg_manufactura_documentos_inmutable BEFORE UPDATE OR DELETE ON manufactura.documentos FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

CREATE FUNCTION manufactura.fn_revisiones_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  -- Solo se crean BORRADORES: una versión finalizada únicamente nace de la transición controlada (FINALIZANDO → FINALIZADA).
  IF NEW.estado <> 'BORRADOR' OR NEW.revision IS NOT NULL THEN
    RAISE EXCEPTION 'Una revisión solo puede crearse como BORRADOR.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.basada_en_revision_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = NEW.basada_en_revision_id AND r.documento_id = NEW.documento_id AND r.estado = 'FINALIZADA') THEN
    RAISE EXCEPTION 'Una nueva revisión solo puede basarse en una versión FINALIZADA del mismo documento.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.version := 1;
  NEW.creado_por_usuario_id := v_id;      NEW.creado_por_email := v_email;      NEW.created_at := now();
  NEW.actualizado_por_usuario_id := v_id; NEW.actualizado_por_email := v_email; NEW.updated_at := now();
  NEW.finalizando_token := NULL; NEW.finalizando_por_usuario_id := NULL; NEW.finalizando_por_email := NULL; NEW.finalizando_desde := NULL;
  NEW.finalizado_por_usuario_id := NULL; NEW.finalizado_por_email := NULL; NEW.finalizado_en := NULL;
  NEW.especificacion_sha256 := manufactura.fn_hash_json(NEW.especificacion);
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_revisiones_insert BEFORE INSERT ON manufactura.revisiones FOR EACH ROW EXECUTE FUNCTION manufactura.fn_revisiones_before_insert();

CREATE FUNCTION manufactura.fn_revisiones_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE
  v_id bigint; v_email text; v_contenido_cambia boolean; v_siguiente integer;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;

  IF OLD.estado IN ('FINALIZADA', 'DESCARTADA') THEN
    RAISE EXCEPTION 'La revisión % está % y es inmutable.', OLD.revision_id, OLD.estado USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Identidad y origen: nunca cambian.
  IF NEW.revision_id <> OLD.revision_id OR NEW.public_id <> OLD.public_id OR NEW.documento_id <> OLD.documento_id
     OR NEW.creado_por_usuario_id <> OLD.creado_por_usuario_id OR NEW.creado_por_email <> OLD.creado_por_email OR NEW.created_at <> OLD.created_at
     OR NEW.basada_en_revision_id IS DISTINCT FROM OLD.basada_en_revision_id THEN
    RAISE EXCEPTION 'Las columnas de identidad y origen de una revisión no se modifican.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  NEW.especificacion_sha256 := manufactura.fn_hash_json(NEW.especificacion);
  v_contenido_cambia := NEW.especificacion IS DISTINCT FROM OLD.especificacion OR NEW.familia IS DISTINCT FROM OLD.familia
    OR NEW.elaboro_nombre IS DISTINCT FROM OLD.elaboro_nombre OR NEW.elaboro_confirmado IS DISTINCT FROM OLD.elaboro_confirmado
    OR NEW.autorizo_nombre IS DISTINCT FROM OLD.autorizo_nombre OR NEW.revisor_usuario_id IS DISTINCT FROM OLD.revisor_usuario_id
    OR NEW.cliente_empresa_id IS DISTINCT FROM OLD.cliente_empresa_id OR NEW.cliente_nombre IS DISTINCT FROM OLD.cliente_nombre
    OR NEW.cliente_verificado IS DISTINCT FROM OLD.cliente_verificado;
  NEW.actualizado_por_usuario_id := v_id; NEW.actualizado_por_email := v_email; NEW.updated_at := now();

  IF OLD.estado = 'BORRADOR' THEN
    IF NEW.estado = 'BORRADOR' THEN
      IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'Edición de borrador: la versión debe incrementarse en 1 (bloqueo optimista).' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSIF NEW.estado = 'FINALIZANDO' THEN
      IF v_contenido_cambia OR NEW.version <> OLD.version THEN
        RAISE EXCEPTION 'Al iniciar la finalización el contenido y la versión no pueden cambiar.' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      NEW.finalizando_token := gen_random_uuid(); NEW.finalizando_por_usuario_id := v_id; NEW.finalizando_por_email := v_email; NEW.finalizando_desde := now();
    ELSIF NEW.estado = 'DESCARTADA' THEN
      IF NEW.version <> OLD.version + 1 THEN NEW.version := OLD.version + 1; END IF;
    ELSE
      RAISE EXCEPTION 'Transición no permitida: BORRADOR → %.', NEW.estado USING ERRCODE = 'integrity_constraint_violation';
    END IF;

  ELSIF OLD.estado = 'FINALIZANDO' THEN
    -- Durante la finalización el contenido está CONGELADO (el PDF debe proceder exactamente de la copia registrada).
    IF v_contenido_cambia OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'El contenido de una revisión en finalización está congelado.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.estado = 'BORRADOR' THEN                                    -- cancelar o recuperar tras un fallo
      NEW.finalizando_token := NULL; NEW.finalizando_por_usuario_id := NULL; NEW.finalizando_por_email := NULL; NEW.finalizando_desde := NULL;
    ELSIF NEW.estado = 'FINALIZANDO' THEN                              -- reclamar una finalización abandonada (> 10 min)
      IF OLD.finalizando_desde > now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'Hay una finalización en curso (menos de 10 minutos).' USING ERRCODE = 'lock_not_available';
      END IF;
      NEW.finalizando_token := gen_random_uuid(); NEW.finalizando_por_usuario_id := v_id; NEW.finalizando_por_email := v_email; NEW.finalizando_desde := now();
    ELSIF NEW.estado = 'FINALIZADA' THEN
      -- El PDF debe existir, proceder de ESTA copia exacta y estar íntegro.
      IF NOT EXISTS (
           SELECT 1 FROM manufactura.pdfs p JOIN manufactura.pdf_contenidos c USING (revision_id)
            WHERE p.revision_id = OLD.revision_id AND p.especificacion_sha256 = NEW.especificacion_sha256
              AND encode(sha256(c.contenido), 'hex') = p.pdf_sha256 AND octet_length(c.contenido) = p.bytes) THEN
        RAISE EXCEPTION 'No se finaliza sin un PDF íntegro generado desde exactamente esta especificación.' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      -- Numeración correlativa por documento (serializada con un candado de transacción; el índice único es la red de seguridad).
      PERFORM pg_advisory_xact_lock(hashtext('manufactura.revision'), OLD.documento_id::integer);
      SELECT COALESCE(max(r.revision), 0) + 1 INTO v_siguiente FROM manufactura.revisiones r WHERE r.documento_id = OLD.documento_id;
      NEW.revision := v_siguiente;
      NEW.finalizado_por_usuario_id := v_id; NEW.finalizado_por_email := v_email; NEW.finalizado_en := now();
      NEW.finalizando_token := NULL;
    ELSE
      RAISE EXCEPTION 'Transición no permitida: FINALIZANDO → %.', NEW.estado USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_revisiones_update BEFORE UPDATE ON manufactura.revisiones FOR EACH ROW EXECUTE FUNCTION manufactura.fn_revisiones_before_update();
CREATE TRIGGER trg_manufactura_revisiones_no_delete BEFORE DELETE ON manufactura.revisiones FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

CREATE FUNCTION manufactura.fn_pdfs_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text; v_rev manufactura.revisiones%ROWTYPE;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  SELECT * INTO v_rev FROM manufactura.revisiones WHERE revision_id = NEW.revision_id;
  IF NOT FOUND OR v_rev.estado <> 'FINALIZANDO' THEN
    RAISE EXCEPTION 'El PDF solo se registra para una revisión en FINALIZANDO.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.especificacion_sha256 <> v_rev.especificacion_sha256 THEN
    RAISE EXCEPTION 'El PDF no procede de la copia de especificación registrada (hash distinto).' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.generado_por_usuario_id := v_id; NEW.generado_por_email := v_email; NEW.generado_en := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_pdfs_insert BEFORE INSERT ON manufactura.pdfs FOR EACH ROW EXECUTE FUNCTION manufactura.fn_pdfs_before_insert();
CREATE TRIGGER trg_manufactura_pdfs_inmutable BEFORE UPDATE OR DELETE ON manufactura.pdfs FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

CREATE FUNCTION manufactura.fn_pdf_contenidos_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_pdf manufactura.pdfs%ROWTYPE;
BEGIN
  SELECT * INTO v_pdf FROM manufactura.pdfs WHERE revision_id = NEW.revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el registro del PDF.' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = NEW.revision_id AND r.estado = 'FINALIZANDO') THEN
    RAISE EXCEPTION 'El contenido del PDF solo se registra durante la finalización.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- La base verifica la integridad: el hash y el tamaño declarados deben ser los de los bytes recibidos.
  IF encode(sha256(NEW.contenido), 'hex') <> v_pdf.pdf_sha256 OR octet_length(NEW.contenido) <> v_pdf.bytes THEN
    RAISE EXCEPTION 'El contenido no coincide con el SHA-256 / tamaño registrados.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_pdf_contenidos_insert BEFORE INSERT ON manufactura.pdf_contenidos FOR EACH ROW EXECUTE FUNCTION manufactura.fn_pdf_contenidos_before_insert();
CREATE TRIGGER trg_manufactura_pdf_contenidos_inmutable BEFORE UPDATE OR DELETE ON manufactura.pdf_contenidos FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

CREATE FUNCTION manufactura.fn_confirmaciones_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text; v_rev manufactura.revisiones%ROWTYPE; v_nombre text;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  SELECT * INTO v_rev FROM manufactura.revisiones WHERE revision_id = NEW.revision_id;
  IF NOT FOUND OR v_rev.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La revisión solo se registra sobre un BORRADOR vigente.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT u.display_name INTO v_nombre FROM security.users u WHERE u.user_id = v_id AND u.status = 'ACTIVE';
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'La cuenta que revisa no está activa.' USING ERRCODE = 'insufficient_privilege'; END IF;
  -- Queda vinculada al contenido exacto revisado: cualquier edición posterior (versión/hash) la deja desactualizada.
  NEW.usuario_id := v_id; NEW.usuario_email := v_email; NEW.usuario_nombre := v_nombre;
  NEW.version := v_rev.version; NEW.especificacion_sha256 := v_rev.especificacion_sha256; NEW.created_at := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_confirmaciones_insert BEFORE INSERT ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION manufactura.fn_confirmaciones_before_insert();
CREATE TRIGGER trg_manufactura_confirmaciones_inmutable BEFORE UPDATE OR DELETE ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Auditoría: se REUTILIZA audit.fn_registrar_cambio (usuario real desde app.user_id / app.user_email, request_id, antes/después).
--    El contenido binario del PDF (pdf_contenidos) no se audita: lo cubre el INSERT de pdfs (hash, tamaño, actor).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TRIGGER trg_audit_manufactura_documentos     AFTER INSERT OR UPDATE OR DELETE ON manufactura.documentos             FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('documento_id');
CREATE TRIGGER trg_audit_manufactura_revisiones     AFTER INSERT OR UPDATE OR DELETE ON manufactura.revisiones             FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('revision_id');
CREATE TRIGGER trg_audit_manufactura_pdfs           AFTER INSERT OR UPDATE OR DELETE ON manufactura.pdfs                   FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('revision_id');
CREATE TRIGGER trg_audit_manufactura_confirmaciones AFTER INSERT OR UPDATE OR DELETE ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('confirmacion_id');

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Privilegios: el rol de la aplicación recibe SOLO lo imprescindible. Sin DDL, sin DELETE, sin TRUNCATE; nadie más tiene acceso.
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON SCHEMA manufactura FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA manufactura FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA manufactura FROM PUBLIC;
GRANT USAGE ON SCHEMA manufactura TO daubert_hub_test_user;
GRANT SELECT, INSERT         ON manufactura.documentos             TO daubert_hub_test_user;
GRANT SELECT, INSERT, UPDATE ON manufactura.revisiones             TO daubert_hub_test_user;   -- UPDATE efectivo solo sobre borradores (trigger)
GRANT SELECT, INSERT         ON manufactura.pdfs                   TO daubert_hub_test_user;
GRANT SELECT, INSERT         ON manufactura.pdf_contenidos         TO daubert_hub_test_user;
GRANT SELECT, INSERT         ON manufactura.confirmaciones_revision TO daubert_hub_test_user;
GRANT EXECUTE ON FUNCTION manufactura.fn_actor(), manufactura.fn_hash_json(jsonb) TO daubert_hub_test_user;

-- Validación final dentro de la transacción: si algo no cuadra, se revierte TODO.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') <> 5 THEN RAISE EXCEPTION 'Se esperaban 5 tablas en manufactura.'; END IF;
  IF has_table_privilege('daubert_hub_test_user', 'manufactura.revisiones', 'DELETE') OR has_table_privilege('daubert_hub_test_user', 'manufactura.pdfs', 'UPDATE') THEN
    RAISE EXCEPTION 'Privilegios de la aplicación más amplios de lo permitido.';
  END IF;
  IF has_schema_privilege('daubert_hub_test_user', 'manufactura', 'CREATE') THEN RAISE EXCEPTION 'La aplicación no debe poder crear objetos.'; END IF;
END $$;

SELECT 'UP_OK manufactura (5 tablas, 4 triggers de auditoría, privilegios mínimos)' AS resultado;
COMMIT;
