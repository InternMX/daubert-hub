-- GENERADO desde TEST 101 (20261030_101_manufactura_gestor_documental_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 012. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- UP · manufactura · gestor documental de Hojas de Instrucción de Manufactura (SOLO PRODUCCIÓN: daubert_global)   [revisión 3]
--
-- ALCANCE DE LAS ESCRITURAS (todo dentro de UNA transacción; si algo falla no queda nada):
--   · CREA el esquema `manufactura` (dueño: el rol administrativo que ejecuta) con 5 tablas, 15 funciones, triggers y políticas RLS.
--   · CONCEDE al rol `daubert_hub_app` SOLO los privilegios de datos listados al final (sin DDL, sin DELETE, sin TRUNCATE).
--   · NO modifica ni lee datos de ninguna tabla existente; NO toca core, security, ops, operacion ni audit (salvo que los triggers
--     de auditoría nuevos escribirán en audit.cambios cuando la aplicación use las tablas nuevas).
--   · NO toca roles, permisos de otras bases, daubert_global ni n8n.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 \
--        -f 20261108_012_manufactura_gestor_documental_prod.up.sql
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
  IF current_database() <> 'daubert_global' THEN
    RAISE EXCEPTION 'ABORTO: esta migración es solo para daubert_global (base actual: %).', current_database();
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo (el rol actual % no es administrador).', current_user;
  END IF;
  SELECT * INTO v_app FROM pg_roles WHERE rolname = 'daubert_hub_app';
  IF NOT FOUND OR v_app.rolsuper OR v_app.rolcreaterole OR v_app.rolcreatedb OR v_app.rolbypassrls THEN
    RAISE EXCEPTION 'ABORTO: el rol daubert_hub_app no existe o tiene privilegios que no debe tener (superusuario/creación/BYPASSRLS).';
  END IF;
  IF to_regclass('security.users') IS NULL OR to_regclass('core.empresas') IS NULL OR to_regproc('audit.fn_registrar_cambio') IS NULL THEN
    RAISE EXCEPTION 'ABORTO: faltan objetos requeridos (security.users, core.empresas, audit.fn_registrar_cambio).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura') THEN
    RAISE EXCEPTION 'ABORTO: el esquema manufactura ya existe (no se reaplica).';
  END IF;
END $$;

CREATE SCHEMA manufactura;
COMMENT ON SCHEMA manufactura IS 'Gestor documental de Hojas de Instrucción de Manufactura (PRODUCCIÓN). Revisiones finalizadas inmutables; PDF almacenados con SHA-256.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Funciones auxiliares
-- ---------------------------------------------------------------------------------------------------------------------

-- Identidad de la transacción: la fija la API desde la SESIÓN autenticada con set_config('app.user_id' / 'app.user_email', ..., true)
-- (el mismo mecanismo que usa audit.fn_registrar_cambio). Sin identidad no se escribe: el actor nunca viene de columnas enviadas por el cliente.
CREATE FUNCTION manufactura.fn_actor(OUT usuario_id bigint, OUT usuario_email text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog
AS $fn$
BEGIN
  usuario_id    := NULLIF(current_setting('app.user_id', true), '')::bigint;
  usuario_email := NULLIF(current_setting('app.user_email', true), '');
  IF usuario_id IS NULL OR usuario_email IS NULL THEN
    RAISE EXCEPTION 'Sin identidad de sesión (app.user_id / app.user_email): no se registra la operación.' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$fn$;

-- Versiones para las políticas de fila (devuelven NULL / false sin identidad: nunca lanzan).
CREATE FUNCTION manufactura.fn_actor_id() RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $fn$ SELECT CASE WHEN NULLIF(current_setting('app.user_id', true), '') ~ '^[0-9]{1,18}$' THEN NULLIF(current_setting('app.user_id', true), '')::bigint END $fn$;

CREATE FUNCTION manufactura.fn_actor_es_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, security
AS $fn$ SELECT EXISTS (SELECT 1 FROM security.users u WHERE u.user_id = manufactura.fn_actor_id() AND u.role = 'ADMIN' AND u.status = 'ACTIVE') $fn$;

-- Huella de lo TÉCNICO de una revisión: familia + copia de la especificación. Cualquier cambio técnico cambia la huella (invalida revisiones).
CREATE FUNCTION manufactura.fn_hash_revision(p_familia text, p_especificacion jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $fn$ SELECT encode(sha256(convert_to(p_familia || E'\n' || p_especificacion::text, 'UTF8')), 'hex') $fn$;

-- Nombre del PDF finalizado: CODIGO-VARIANTE_REV01.pdf (o CODIGO_REV01.pdf sin variante). La base lo impone: el nombre y la revisión impresa no pueden divergir.
CREATE FUNCTION manufactura.fn_nombre_pdf(p_codigo text, p_variante text, p_revision integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $fn$ SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' $fn$;

-- Validación ESTRUCTURAL de la copia de la especificación (revisión 3). NO examina el texto de los valores: una descripción legítima («TOKEN», «SECRET», «PASSWORD»…)
-- se acepta. Se rechazan únicamente: claves con nombre de credencial en cualquier nivel (authorization, bearer, api key, password, secret, token, cookie…), claves que no
-- sean identificadores simples, claves de primer nivel desconocidas y claves de `bind` fuera de los 6 campos permitidos (sin ID, costos ni credenciales).
CREATE FUNCTION manufactura.fn_claves_validas(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $fn$
  -- jsonb_path_query(p, '$.**') enumera TODOS los nodos (objetos, arreglos y valores) de cualquier nivel.
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_path_query(p, 'lax $.**') AS nodo(v), LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(nodo.v) = 'object' THEN nodo.v ELSE '{}'::jsonb END) AS clave(k)
     WHERE clave.k !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' OR clave.k ~* '(authorization|bearer|api_?key|subscription|password|passwd|secret|token|credential|cookie)')
$fn$;

CREATE FUNCTION manufactura.fn_especificacion_valida(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, manufactura
AS $fn$
  SELECT jsonb_typeof(p) = 'object' AND p ? 'datos' AND octet_length(p::text) <= 65536
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k <> ALL (ARRAY['datos', 'bind', 'procedencia', 'colorPersonalizado', 'incidenciasReconocidas']))
     AND (NOT p ? 'bind' OR (jsonb_typeof(p -> 'bind') = 'object' AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p -> 'bind') k WHERE k <> ALL (ARRAY['Code', 'Title', 'Description', 'Weight', 'CreationDate']))))
     AND manufactura.fn_claves_validas(p)
$fn$;

-- Auditoría de manufactura (revisión 3). Misma tabla (audit.cambios), mismas variables de sesión (app.user_id / app.user_email / app.request_id / app.origin) y misma semántica
-- que audit.fn_registrar_cambio, PERO sin copiar columnas privadas: la aplicación puede LEER audit.cambios, y la función original copia la fila completa (incluida la copia de la
-- especificación de un borrador ajeno), lo que anularía la visibilidad por filas. Argumentos del trigger: 1.º = columna clave; los demás = columnas a omitir.
-- SECURITY DEFINER (como la original) con search_path fijo y dueño administrador.
CREATE FUNCTION manufactura.fn_auditar_manufactura() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit
AS $fn$
DECLARE
  v_old jsonb; v_new jsonb; v_row jsonb; v_omitir text[] := ARRAY(SELECT unnest(TG_ARGV[2:TG_NARGS - 1])); v_clave text := TG_ARGV[0];
BEGIN
  IF TG_NARGS < 1 THEN RAISE EXCEPTION 'fn_auditar_manufactura requiere la columna clave.'; END IF;
  IF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW) - v_omitir;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) - v_omitir; v_new := to_jsonb(NEW) - v_omitir;
    IF (v_old - 'updated_at') = (v_new - 'updated_at') AND (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN RETURN NEW; END IF;
  ELSE v_old := to_jsonb(OLD) - v_omitir;
  END IF;
  v_row := COALESCE(v_new, v_old);
  INSERT INTO audit.cambios (esquema, tabla, registro_id, operacion, usuario_id, usuario_email, origen, request_id, datos_anteriores, datos_nuevos)
  VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, v_clave || '=' || COALESCE(v_row ->> v_clave, 'NULL'), TG_OP,
          NULLIF(current_setting('app.user_id', true), ''), NULLIF(current_setting('app.user_email', true), ''),
          COALESCE(NULLIF(current_setting('app.origin', true), ''), 'SISTEMA'), NULLIF(current_setting('app.request_id', true), ''), v_old, v_new);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION manufactura.fn_inmutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION '%.% es inmutable: no admite % (corrija con una nueva revisión o un nuevo registro).', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Documentos: una línea de revisiones de una hoja. UN CÓDIGO DCMX puede tener VARIAS hojas (variantes: p. ej. Hojas doblada /
--    extendida, otra etiqueta o cliente). La regla es (código, variante) único; no «un documento por código».
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
  revision_prevista          integer,                       -- reservada al pasar a FINALIZANDO (el PDF imprime este número); es exacta porque solo hay UNA revisión abierta por documento
  estado                     text NOT NULL DEFAULT 'BORRADOR',
  version                    integer NOT NULL DEFAULT 1,    -- bloqueo optimista de edición
  familia                    text NOT NULL,
  especificacion             jsonb NOT NULL,                -- copia de la especificación (datos, procedencia, color, incidencias reconocidas, 6 campos de BIND)
  especificacion_sha256      text NOT NULL,                 -- huella de familia + especificación; la calcula el trigger (no la aplicación)
  elaboro_nombre             text,                          -- nombre IMPRESO (sugerido desde la sesión, editable); NO es la identidad de auditoría
  elaboro_confirmado         boolean NOT NULL DEFAULT false,-- confirmación expresa: obligatoria para finalizar
  autorizo_nombre            text,                          -- opcional; sin flujo de autorización
  revisor_usuario_id         bigint,                        -- revisor asignado: usuario ACTIVO; solo el creador o un ADMIN lo asigna
  cliente_empresa_id         bigint,
  cliente_nombre             text,
  cliente_verificado         boolean NOT NULL DEFAULT false,-- true = vinculado a core.empresas; false = identificación manual (no vinculada al catálogo de clientes)
  entorno_emision            text NOT NULL DEFAULT 'PRODUCCION',-- constancia: documentos de producción
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
  CONSTRAINT ck_manufactura_revisiones_revision CHECK ((revision IS NULL OR revision >= 1) AND (revision_prevista IS NULL OR revision_prevista >= 1)),
  CONSTRAINT ck_manufactura_revisiones_entorno CHECK (entorno_emision = 'PRODUCCION'),
  CONSTRAINT ck_manufactura_revisiones_familia CHECK (familia IN ('BOLSA_PLANA_1', 'HOJA_PAQ', 'BOLSA_FUELLE', 'BOLSA_NATURAL', 'ROLLO_CONTINUO', 'TERMOENCOGIBLE', 'COEX')),
  -- Validación ESTRUCTURAL (claves), no del texto de los valores: las descripciones de productos pueden contener cualquier palabra.
  CONSTRAINT ck_manufactura_revisiones_especificacion CHECK (manufactura.fn_especificacion_valida(especificacion)),
  CONSTRAINT ck_manufactura_revisiones_hash CHECK (especificacion_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_manufactura_revisiones_nombres CHECK (
    (elaboro_nombre IS NULL OR (btrim(elaboro_nombre) <> '' AND char_length(elaboro_nombre) <= 120))
    AND (autorizo_nombre IS NULL OR (btrim(autorizo_nombre) <> '' AND char_length(autorizo_nombre) <= 120))
    AND (cliente_nombre IS NULL OR (btrim(cliente_nombre) <> '' AND char_length(cliente_nombre) <= 200))
  ),
  CONSTRAINT ck_manufactura_revisiones_cliente CHECK (cliente_verificado = false OR cliente_empresa_id IS NOT NULL),
  CONSTRAINT ck_manufactura_revisiones_coherencia CHECK (
    CASE estado
      WHEN 'BORRADOR'    THEN revision IS NULL AND revision_prevista IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL AND finalizado_por_usuario_id IS NULL
      WHEN 'FINALIZANDO' THEN revision IS NULL AND revision_prevista IS NOT NULL AND finalizando_token IS NOT NULL AND finalizando_desde IS NOT NULL AND finalizando_por_usuario_id IS NOT NULL AND finalizado_en IS NULL
      WHEN 'FINALIZADA'  THEN revision IS NOT NULL AND revision = revision_prevista AND finalizando_token IS NULL AND finalizado_en IS NOT NULL AND finalizado_por_usuario_id IS NOT NULL AND finalizado_por_email IS NOT NULL
                              AND cliente_nombre IS NOT NULL AND elaboro_nombre IS NOT NULL AND elaboro_confirmado
      WHEN 'DESCARTADA'  THEN revision IS NULL AND revision_prevista IS NULL AND finalizando_token IS NULL AND finalizado_en IS NULL
      ELSE false
    END
  )
);
-- Un solo borrador (o finalización en curso) por documento: de aquí sale que la numeración sea exacta y sin carreras.
CREATE UNIQUE INDEX uq_manufactura_revisiones_abierta ON manufactura.revisiones (documento_id) WHERE estado IN ('BORRADOR', 'FINALIZANDO');
CREATE INDEX ix_manufactura_revisiones_estado ON manufactura.revisiones (estado, updated_at DESC);
CREATE INDEX ix_manufactura_revisiones_creador ON manufactura.revisiones (creado_por_usuario_id);
CREATE INDEX ix_manufactura_revisiones_revisor ON manufactura.revisiones (revisor_usuario_id) WHERE revisor_usuario_id IS NOT NULL;
COMMENT ON TABLE manufactura.revisiones IS 'Borradores y versiones de una hoja con la copia de la especificación. FINALIZADA es inmutable (trigger). Actor tomado de app.user_id/app.user_email. Visibilidad por RLS.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. PDF finalizado: metadatos (auditable) y contenido (bytea) separados; el contenido NO se audita para no copiar bytes a audit.cambios.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.pdfs (
  revision_id               bigint NOT NULL,
  pdf_sha256                text NOT NULL,
  bytes                     integer NOT NULL,
  especificacion_sha256     text NOT NULL,                  -- huella de la copia de la que PROCEDE el PDF (debe coincidir con la revisión)
  nombre_archivo            text NOT NULL,
  generado_por_usuario_id   bigint NOT NULL,
  generado_por_email        text NOT NULL,
  generado_en               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_manufactura_pdfs PRIMARY KEY (revision_id),
  CONSTRAINT fk_manufactura_pdfs_revision FOREIGN KEY (revision_id) REFERENCES manufactura.revisiones (revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_pdfs_usuario FOREIGN KEY (generado_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_pdfs_sha CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$' AND especificacion_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_manufactura_pdfs_bytes CHECK (bytes BETWEEN 1 AND 5242880),
  CONSTRAINT ck_manufactura_pdfs_nombre CHECK (nombre_archivo ~ '^[A-Za-z0-9._-]{1,120}_REV[0-9]{2,}\.pdf$')
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
-- 5. Confirmaciones de revisión: acción AUTENTICADA y vinculada al contenido (versión + huella); nunca por capturar un nombre.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.confirmaciones_revision (
  confirmacion_id       bigint GENERATED ALWAYS AS IDENTITY,
  revision_id           bigint NOT NULL,
  usuario_id            bigint NOT NULL,
  usuario_email         text NOT NULL,
  usuario_nombre        text NOT NULL,                      -- display_name en el momento de la revisión
  version               integer NOT NULL,
  especificacion_sha256 text NOT NULL,                      -- la confirmación solo vale mientras la huella de la revisión siga siendo esta
  es_autorrevision      boolean NOT NULL,                   -- constancia: quien revisa es quien creó el borrador (permitido)
  como_revisor_asignado boolean NOT NULL,
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
DECLARE v_id bigint; v_email text; v_dueno bigint;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  -- Solo se crean BORRADORES: una versión finalizada únicamente nace de la transición controlada (FINALIZANDO → FINALIZADA).
  IF NEW.estado <> 'BORRADOR' OR NEW.revision IS NOT NULL OR NEW.revision_prevista IS NOT NULL THEN
    RAISE EXCEPTION 'Una revisión solo puede crearse como BORRADOR.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Solo el creador del documento o un ADMIN agregan revisiones (las cuentas GENERAL, únicamente a documentos propios).
  SELECT d.creado_por_usuario_id INTO v_dueno FROM manufactura.documentos d WHERE d.documento_id = NEW.documento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El documento no existe o no es accesible.' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF v_dueno <> v_id AND NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo el creador del documento o un ADMIN pueden agregar revisiones.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.basada_en_revision_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = NEW.basada_en_revision_id AND r.documento_id = NEW.documento_id AND r.estado = 'FINALIZADA') THEN
    RAISE EXCEPTION 'Una nueva revisión solo puede basarse en una versión FINALIZADA del mismo documento.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.revisor_usuario_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM security.users u WHERE u.user_id = NEW.revisor_usuario_id AND u.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'El revisor asignado debe ser un usuario ACTIVO.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.version := 1; NEW.entorno_emision := 'PRODUCCION';
  NEW.creado_por_usuario_id := v_id;      NEW.creado_por_email := v_email;      NEW.created_at := now();
  NEW.actualizado_por_usuario_id := v_id; NEW.actualizado_por_email := v_email; NEW.updated_at := now();
  NEW.finalizando_token := NULL; NEW.finalizando_por_usuario_id := NULL; NEW.finalizando_por_email := NULL; NEW.finalizando_desde := NULL;
  NEW.finalizado_por_usuario_id := NULL; NEW.finalizado_por_email := NULL; NEW.finalizado_en := NULL;
  NEW.especificacion_sha256 := manufactura.fn_hash_revision(NEW.familia, NEW.especificacion);
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
  -- Solo el creador de la revisión o un ADMIN modifican, inician la finalización o descartan (el revisor NO modifica datos técnicos).
  IF OLD.creado_por_usuario_id <> v_id AND NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo el creador de la revisión o un ADMIN pueden modificarla.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Identidad y origen: nunca cambian.
  IF NEW.revision_id <> OLD.revision_id OR NEW.public_id <> OLD.public_id OR NEW.documento_id <> OLD.documento_id
     OR NEW.creado_por_usuario_id <> OLD.creado_por_usuario_id OR NEW.creado_por_email <> OLD.creado_por_email OR NEW.created_at <> OLD.created_at
     OR NEW.basada_en_revision_id IS DISTINCT FROM OLD.basada_en_revision_id OR NEW.entorno_emision <> OLD.entorno_emision THEN
    RAISE EXCEPTION 'Las columnas de identidad y origen de una revisión no se modifican.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.revisor_usuario_id IS DISTINCT FROM OLD.revisor_usuario_id AND NEW.revisor_usuario_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM security.users u WHERE u.user_id = NEW.revisor_usuario_id AND u.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'El revisor asignado debe ser un usuario ACTIVO.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  NEW.especificacion_sha256 := manufactura.fn_hash_revision(NEW.familia, NEW.especificacion);
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
      -- Reserva la revisión que se imprimirá en el PDF (exacta: solo hay una revisión abierta por documento; el candado serializa).
      PERFORM pg_advisory_xact_lock(hashtext('manufactura.revision'), OLD.documento_id::integer);
      SELECT COALESCE(max(r.revision), 0) + 1 INTO v_siguiente FROM manufactura.revisiones r WHERE r.documento_id = OLD.documento_id;
      NEW.revision_prevista := v_siguiente;
      NEW.finalizando_token := gen_random_uuid(); NEW.finalizando_por_usuario_id := v_id; NEW.finalizando_por_email := v_email; NEW.finalizando_desde := now();
    ELSIF NEW.estado = 'DESCARTADA' THEN
      NEW.version := OLD.version + 1;
    ELSE
      RAISE EXCEPTION 'Transición no permitida: BORRADOR → %.', NEW.estado USING ERRCODE = 'integrity_constraint_violation';
    END IF;

  ELSIF OLD.estado = 'FINALIZANDO' THEN
    -- Durante la finalización el contenido está CONGELADO (el PDF debe proceder exactamente de la copia registrada).
    IF v_contenido_cambia OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'El contenido de una revisión en finalización está congelado.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.estado = 'BORRADOR' THEN                                    -- cancelar o recuperar tras un fallo
      IF EXISTS (SELECT 1 FROM manufactura.pdfs p WHERE p.revision_id = OLD.revision_id) THEN
        RAISE EXCEPTION 'La revisión ya tiene un PDF registrado: no puede volver a borrador.' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      NEW.revision_prevista := NULL; NEW.finalizando_token := NULL; NEW.finalizando_por_usuario_id := NULL; NEW.finalizando_por_email := NULL; NEW.finalizando_desde := NULL;
    ELSIF NEW.estado = 'FINALIZANDO' THEN                              -- reclamar una finalización abandonada (> 10 min): token nuevo; el anterior queda inválido
      IF OLD.finalizando_desde > now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'Hay una finalización en curso (menos de 10 minutos).' USING ERRCODE = 'lock_not_available';
      END IF;
      NEW.revision_prevista := OLD.revision_prevista;
      NEW.finalizando_token := gen_random_uuid(); NEW.finalizando_por_usuario_id := v_id; NEW.finalizando_por_email := v_email; NEW.finalizando_desde := now();
    ELSIF NEW.estado = 'FINALIZADA' THEN
      -- El PDF debe existir, proceder de ESTA copia exacta, tener el nombre/revisión que le corresponden y estar íntegro.
      IF NOT EXISTS (
           SELECT 1 FROM manufactura.pdfs p JOIN manufactura.pdf_contenidos c USING (revision_id)
            WHERE p.revision_id = OLD.revision_id AND p.especificacion_sha256 = NEW.especificacion_sha256
              AND encode(sha256(c.contenido), 'hex') = p.pdf_sha256 AND octet_length(c.contenido) = p.bytes) THEN
        RAISE EXCEPTION 'No se finaliza sin un PDF íntegro generado desde exactamente esta especificación.' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('manufactura.revision'), OLD.documento_id::integer);
      SELECT COALESCE(max(r.revision), 0) + 1 INTO v_siguiente FROM manufactura.revisiones r WHERE r.documento_id = OLD.documento_id;
      IF v_siguiente <> OLD.revision_prevista THEN
        RAISE EXCEPTION 'La revisión prevista (%) ya no es la siguiente (%): no se finaliza.', OLD.revision_prevista, v_siguiente USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      NEW.revision := OLD.revision_prevista; NEW.revision_prevista := OLD.revision_prevista;
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
DECLARE v_id bigint; v_email text; v_rev manufactura.revisiones%ROWTYPE; v_doc manufactura.documentos%ROWTYPE;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  SELECT * INTO v_rev FROM manufactura.revisiones WHERE revision_id = NEW.revision_id;
  IF NOT FOUND OR v_rev.estado <> 'FINALIZANDO' THEN
    RAISE EXCEPTION 'El PDF solo se registra para una revisión en FINALIZANDO.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_rev.finalizando_por_usuario_id <> v_id AND NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo quien inició la finalización (o un ADMIN) registra el PDF.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.especificacion_sha256 <> v_rev.especificacion_sha256 THEN
    RAISE EXCEPTION 'El PDF no procede de la copia de especificación registrada (huella distinta).' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT * INTO v_doc FROM manufactura.documentos WHERE documento_id = v_rev.documento_id;
  IF NEW.nombre_archivo <> manufactura.fn_nombre_pdf(v_doc.codigo_dcmx, v_doc.variante, v_rev.revision_prevista) THEN
    RAISE EXCEPTION 'El nombre del PDF debe ser %.', manufactura.fn_nombre_pdf(v_doc.codigo_dcmx, v_doc.variante, v_rev.revision_prevista) USING ERRCODE = 'integrity_constraint_violation';
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
  -- Pueden registrar su revisión: el revisor asignado, el creador (autorrevisión permitida, con constancia) y un ADMIN.
  IF v_id IS DISTINCT FROM v_rev.revisor_usuario_id AND v_id <> v_rev.creado_por_usuario_id AND NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo el revisor asignado, el creador o un ADMIN pueden registrar la revisión.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Queda vinculada al contenido exacto revisado: cualquier cambio técnico posterior (huella/versión) la deja sin vigencia.
  NEW.usuario_id := v_id; NEW.usuario_email := v_email; NEW.usuario_nombre := v_nombre;
  NEW.version := v_rev.version; NEW.especificacion_sha256 := v_rev.especificacion_sha256;
  NEW.es_autorrevision := (v_id = v_rev.creado_por_usuario_id);
  NEW.como_revisor_asignado := (v_id IS NOT DISTINCT FROM v_rev.revisor_usuario_id);
  NEW.created_at := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_confirmaciones_insert BEFORE INSERT ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION manufactura.fn_confirmaciones_before_insert();
CREATE TRIGGER trg_manufactura_confirmaciones_inmutable BEFORE UPDATE OR DELETE ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Auditoría en audit.cambios con la función REDACTORA manufactura.fn_auditar_manufactura (usuario real desde app.user_id / app.user_email, request_id, antes/después).
--    El contenido binario del PDF (pdf_contenidos) no se audita: lo cubre el INSERT de pdfs (huella, tamaño, actor).
-- ---------------------------------------------------------------------------------------------------------------------
-- Se omiten las columnas privadas de borradores: código/variante del documento (el documento_id los identifica) y, en revisiones, la copia de la especificación y los nombres
-- impresos / cliente. Se auditan identidad, estado, versión, huella, familia, actores y fechas.
CREATE TRIGGER trg_audit_manufactura_documentos     AFTER INSERT OR UPDATE OR DELETE ON manufactura.documentos             FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('documento_id', 'omitir', 'codigo_dcmx', 'codigo_clave', 'variante', 'variante_clave');
CREATE TRIGGER trg_audit_manufactura_revisiones     AFTER INSERT OR UPDATE OR DELETE ON manufactura.revisiones             FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('revision_id', 'omitir', 'especificacion', 'elaboro_nombre', 'autorizo_nombre', 'cliente_nombre');
CREATE TRIGGER trg_audit_manufactura_pdfs           AFTER INSERT OR UPDATE OR DELETE ON manufactura.pdfs                   FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('revision_id', 'omitir');
CREATE TRIGGER trg_audit_manufactura_confirmaciones AFTER INSERT OR UPDATE OR DELETE ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('confirmacion_id', 'omitir');

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Visibilidad por filas (RLS), aplicada a la aplicación (el dueño/administrador la omite):
--    · FINALIZADAS: visibles para todo usuario autenticado.
--    · BORRADORES / FINALIZANDO / DESCARTADAS: solo su creador, su revisor asignado y un ADMIN.
--    · Modificar: solo el creador de la revisión o un ADMIN (además del trigger).
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE manufactura.documentos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufactura.revisiones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufactura.pdfs                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufactura.pdf_contenidos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufactura.confirmaciones_revision ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_revisiones_sel ON manufactura.revisiones FOR SELECT TO daubert_hub_app
  USING (estado = 'FINALIZADA' OR creado_por_usuario_id = manufactura.fn_actor_id() OR revisor_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin());
CREATE POLICY pol_revisiones_ins ON manufactura.revisiones FOR INSERT TO daubert_hub_app WITH CHECK (true);
CREATE POLICY pol_revisiones_upd ON manufactura.revisiones FOR UPDATE TO daubert_hub_app
  USING (creado_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin()) WITH CHECK (true);

CREATE POLICY pol_documentos_sel ON manufactura.documentos FOR SELECT TO daubert_hub_app
  USING (creado_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin()
         OR EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.documento_id = documentos.documento_id));   -- r ya filtra por su propia política
CREATE POLICY pol_documentos_ins ON manufactura.documentos FOR INSERT TO daubert_hub_app WITH CHECK (true);

CREATE POLICY pol_pdfs_sel ON manufactura.pdfs FOR SELECT TO daubert_hub_app USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = pdfs.revision_id));
CREATE POLICY pol_pdfs_ins ON manufactura.pdfs FOR INSERT TO daubert_hub_app WITH CHECK (true);
CREATE POLICY pol_pdf_contenidos_sel ON manufactura.pdf_contenidos FOR SELECT TO daubert_hub_app USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = pdf_contenidos.revision_id));
CREATE POLICY pol_pdf_contenidos_ins ON manufactura.pdf_contenidos FOR INSERT TO daubert_hub_app WITH CHECK (true);
CREATE POLICY pol_confirmaciones_sel ON manufactura.confirmaciones_revision FOR SELECT TO daubert_hub_app USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = confirmaciones_revision.revision_id));
CREATE POLICY pol_confirmaciones_ins ON manufactura.confirmaciones_revision FOR INSERT TO daubert_hub_app WITH CHECK (true);

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. Privilegios: el rol de la aplicación recibe SOLO lo imprescindible. Sin DDL, sin DELETE, sin TRUNCATE; nadie más tiene acceso.
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON SCHEMA manufactura FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA manufactura FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA manufactura FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA manufactura FROM PUBLIC;
GRANT USAGE ON SCHEMA manufactura TO daubert_hub_app;
GRANT SELECT, INSERT         ON manufactura.documentos             TO daubert_hub_app;
GRANT SELECT, INSERT, UPDATE ON manufactura.revisiones             TO daubert_hub_app;   -- UPDATE efectivo solo sobre borradores del creador/ADMIN (trigger + RLS)
GRANT SELECT, INSERT         ON manufactura.pdfs                   TO daubert_hub_app;
GRANT SELECT, INSERT         ON manufactura.pdf_contenidos         TO daubert_hub_app;
GRANT SELECT, INSERT         ON manufactura.confirmaciones_revision TO daubert_hub_app;
GRANT EXECUTE ON FUNCTION manufactura.fn_actor(), manufactura.fn_actor_id(), manufactura.fn_actor_es_admin(),
                          manufactura.fn_hash_revision(text, jsonb), manufactura.fn_nombre_pdf(text, text, integer),
                          manufactura.fn_especificacion_valida(jsonb), manufactura.fn_claves_validas(jsonb) TO daubert_hub_app;   -- los CHECK se evalúan con los privilegios de quien escribe

-- Validación final dentro de la transacción: si algo no cuadra, se revierte TODO.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') <> 5 THEN RAISE EXCEPTION 'Se esperaban 5 tablas en manufactura.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) <> 5 THEN RAISE EXCEPTION 'RLS debe estar activa en las 5 tablas.'; END IF;
  IF has_table_privilege('daubert_hub_app', 'manufactura.revisiones', 'DELETE') OR has_table_privilege('daubert_hub_app', 'manufactura.pdfs', 'UPDATE') THEN
    RAISE EXCEPTION 'Privilegios de la aplicación más amplios de lo permitido.';
  END IF;
  IF has_schema_privilege('daubert_hub_app', 'manufactura', 'CREATE') THEN RAISE EXCEPTION 'La aplicación no debe poder crear objetos.'; END IF;
END $$;

SELECT 'UP_OK manufactura (5 tablas, RLS, 15 funciones, 4 triggers de auditoría redactores, privilegios mínimos)' AS resultado;
COMMIT;
