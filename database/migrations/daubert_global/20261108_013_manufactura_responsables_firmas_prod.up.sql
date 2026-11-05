-- GENERADO desde TEST 102 (20261103_102_manufactura_responsables_firmas_test) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA 013. NO editar a mano: se regenera y se revisa el diff.
-- =====================================================================================================================
-- UP · manufactura · RESPONSABLES Y FIRMAS (SOLO PRODUCCIÓN: daubert_global)   [migración 102, adicional a la 101]
--
-- ALCANCE (todo en UNA transacción; si algo falla no queda nada):
--   · CREA 3 tablas NUEVAS en el esquema `manufactura` (ya existente por la migración 101):
--       firmas                (catálogo de imágenes JPG/PNG ya procesadas por la API; propietario, quién subió y quién incorporó)
--       firma_autorizaciones  (permiso de USO de una imagen por otro usuario; NO es una aprobación documental)
--       revision_responsables (hasta 3 responsables por revisión: posición, función, nombre impreso y referencia a la imagen)
--   · CREA 8 funciones y sus triggers de integridad/auditoría, 6 políticas RLS y privilegios mínimos para `daubert_hub_app`.
--   · NO modifica ninguna tabla, función, trigger ni política existente (ni de manufactura ni de otros esquemas); NO toca roles, ACL,
--     daubert_global, n8n ni otras bases. Las 5 tablas de la 101 quedan idénticas.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261108_013_manufactura_responsables_firmas_prod.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.revisiones') IS NULL OR to_regproc('manufactura.fn_auditar_manufactura') IS NULL OR to_regproc('manufactura.fn_actor') IS NULL THEN
    RAISE EXCEPTION 'ABORTO: falta la migración 101 (esquema manufactura).';
  END IF;
  IF to_regclass('manufactura.firmas') IS NOT NULL OR to_regclass('manufactura.revision_responsables') IS NOT NULL OR to_regclass('manufactura.firma_autorizaciones') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTO: la migración 102 ya está aplicada (no se reaplica).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Catálogo de firmas. El CONTENIDO es inmutable (la API lo valida y re-codifica antes de guardarlo); solo cambia el estado (ACTIVA → RETIRADA).
--    Nunca se borra: una revisión finalizada conserva su referencia aunque la firma se retire.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.firmas (
  firma_id                   bigint GENERATED ALWAYS AS IDENTITY,
  public_id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  propietario_usuario_id     bigint,                       -- NULL = persona sin cuenta (solo la incorpora un ADMIN)
  propietario_nombre         text NOT NULL,                -- si hay cuenta, lo fija la base desde security.users (no se puede declarar otro)
  subida_por_usuario_id      bigint NOT NULL,              -- quién subió el archivo (actor de la sesión)
  subida_por_email           text NOT NULL,
  incorporada_por_usuario_id bigint NOT NULL,              -- quién la incorporó al catálogo (actor de la sesión; ADMIN si el propietario es otra persona)
  incorporada_por_email      text NOT NULL,
  tipo_mime                  text NOT NULL,
  ancho                      integer NOT NULL,
  alto                       integer NOT NULL,
  bytes                      integer NOT NULL,
  sha256                     text NOT NULL,
  contenido                  bytea NOT NULL,
  estado                     text NOT NULL DEFAULT 'ACTIVA',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  retirada_en                timestamptz,
  CONSTRAINT pk_manufactura_firmas PRIMARY KEY (firma_id),
  CONSTRAINT uq_manufactura_firmas_public UNIQUE (public_id),
  CONSTRAINT fk_manufactura_firmas_propietario FOREIGN KEY (propietario_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_firmas_subida FOREIGN KEY (subida_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_firmas_incorporada FOREIGN KEY (incorporada_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_firmas_nombre CHECK (btrim(propietario_nombre) <> '' AND char_length(propietario_nombre) <= 120),
  CONSTRAINT ck_manufactura_firmas_mime CHECK (tipo_mime IN ('image/png', 'image/jpeg')),
  CONSTRAINT ck_manufactura_firmas_dim CHECK (ancho BETWEEN 1 AND 2000 AND alto BETWEEN 1 AND 2000),
  CONSTRAINT ck_manufactura_firmas_bytes CHECK (bytes BETWEEN 1 AND 262144 AND octet_length(contenido) = bytes),
  CONSTRAINT ck_manufactura_firmas_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_manufactura_firmas_estado CHECK (estado IN ('ACTIVA', 'RETIRADA') AND ((estado = 'RETIRADA') = (retirada_en IS NOT NULL)))
);
CREATE INDEX ix_manufactura_firmas_propietario ON manufactura.firmas (propietario_usuario_id);
ALTER TABLE manufactura.firmas ALTER COLUMN contenido SET STORAGE EXTERNAL;
COMMENT ON TABLE manufactura.firmas IS 'Catálogo de imágenes de firma (JPG/PNG re-codificadas por la API). Contenido inmutable; no se borra. Visible solo para su propietario, quien la subió/incorporó y quienes tienen autorización de uso.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Autorización de USO de una imagen (acceso al recurso; no aprueba ningún documento).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.firma_autorizaciones (
  autorizacion_id        bigint GENERATED ALWAYS AS IDENTITY,
  firma_id               bigint NOT NULL,
  usuario_id             bigint NOT NULL,                  -- quien puede USAR la imagen
  otorgada_por_usuario_id bigint NOT NULL,
  otorgada_por_email     text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  revocada_en            timestamptz,
  revocada_por_usuario_id bigint,
  CONSTRAINT pk_manufactura_firma_aut PRIMARY KEY (autorizacion_id),
  CONSTRAINT fk_manufactura_firma_aut_firma FOREIGN KEY (firma_id) REFERENCES manufactura.firmas (firma_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_firma_aut_usuario FOREIGN KEY (usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_firma_aut_otorgante FOREIGN KEY (otorgada_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_firma_aut_revoca FOREIGN KEY (revocada_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_manufactura_firma_aut_vigente ON manufactura.firma_autorizaciones (firma_id, usuario_id) WHERE revocada_en IS NULL;
CREATE INDEX ix_manufactura_firma_aut_usuario ON manufactura.firma_autorizaciones (usuario_id) WHERE revocada_en IS NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Responsables de una revisión (1 a 3): posición, función, nombre impreso y referencia (opcional) a la imagen.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.revision_responsables (
  responsable_id bigint GENERATED ALWAYS AS IDENTITY,
  revision_id    bigint NOT NULL,
  posicion       smallint NOT NULL,
  funcion        text NOT NULL,
  nombre         text NOT NULL,
  firma_id       bigint,
  firma_sha256   text,                                     -- huella de la imagen usada (constancia; la fija la base)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_manufactura_responsables PRIMARY KEY (responsable_id),
  CONSTRAINT uq_manufactura_responsables_pos UNIQUE (revision_id, posicion),
  CONSTRAINT fk_manufactura_responsables_revision FOREIGN KEY (revision_id) REFERENCES manufactura.revisiones (revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_responsables_firma FOREIGN KEY (firma_id) REFERENCES manufactura.firmas (firma_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_responsables_pos CHECK (posicion BETWEEN 1 AND 3),
  CONSTRAINT ck_manufactura_responsables_funcion CHECK (funcion IN ('GENERO', 'REVISO', 'APROBO')),
  CONSTRAINT ck_manufactura_responsables_nombre CHECK (btrim(nombre) <> '' AND char_length(nombre) <= 120),
  CONSTRAINT ck_manufactura_responsables_firma CHECK ((firma_id IS NULL) = (firma_sha256 IS NULL) AND (firma_sha256 IS NULL OR firma_sha256 ~ '^[0-9a-f]{64}$'))
);
COMMENT ON TABLE manufactura.revision_responsables IS 'Responsables impresos de una revisión (máx. 3). Solo se modifican mientras la revisión es BORRADOR; congelados en FINALIZANDO/FINALIZADA.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Funciones y triggers
-- ---------------------------------------------------------------------------------------------------------------------
-- ¿Puede este usuario USAR esta imagen? (propietaria, o autorización vigente) y la firma está ACTIVA. Se evalúa con los privilegios de quien escribe (RLS aplica).
CREATE FUNCTION manufactura.fn_firma_utilizable(p_firma_id bigint, p_usuario bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, manufactura
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM manufactura.firmas f
     WHERE f.firma_id = p_firma_id AND f.estado = 'ACTIVA'
       AND (f.propietario_usuario_id = p_usuario
            OR EXISTS (SELECT 1 FROM manufactura.firma_autorizaciones a WHERE a.firma_id = f.firma_id AND a.usuario_id = p_usuario AND a.revocada_en IS NULL)))
$fn$;

CREATE FUNCTION manufactura.fn_firmas_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text; v_nombre text;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  IF NEW.propietario_usuario_id IS NOT NULL THEN
    IF NEW.propietario_usuario_id <> v_id AND NOT manufactura.fn_actor_es_admin() THEN
      RAISE EXCEPTION 'Solo un ADMIN incorpora la firma de otra persona.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT u.display_name INTO v_nombre FROM security.users u WHERE u.user_id = NEW.propietario_usuario_id AND u.status = 'ACTIVE';
    IF v_nombre IS NULL THEN RAISE EXCEPTION 'El propietario de la firma debe ser un usuario ACTIVO.' USING ERRCODE = 'integrity_constraint_violation'; END IF;
    NEW.propietario_nombre := v_nombre;            -- el nombre del propietario sale de la cuenta, no de lo que se declare
  ELSIF NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo un ADMIN autorizado incorpora firmas de personas sin cuenta.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF encode(sha256(NEW.contenido), 'hex') <> NEW.sha256 OR octet_length(NEW.contenido) <> NEW.bytes THEN
    RAISE EXCEPTION 'El contenido no coincide con el SHA-256 / tamaño declarados.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.subida_por_usuario_id := v_id; NEW.subida_por_email := v_email;
  NEW.incorporada_por_usuario_id := v_id; NEW.incorporada_por_email := v_email;
  NEW.estado := 'ACTIVA'; NEW.retirada_en := NULL; NEW.created_at := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_firmas_insert BEFORE INSERT ON manufactura.firmas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_firmas_before_insert();

-- Persona sin cuenta: el ADMIN que la incorpora queda autorizado a usarla (custodio); la propietaria con cuenta la usa por ser propietaria.
CREATE FUNCTION manufactura.fn_firmas_after_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
BEGIN
  IF NEW.propietario_usuario_id IS NULL THEN
    INSERT INTO manufactura.firma_autorizaciones (firma_id, usuario_id, otorgada_por_usuario_id, otorgada_por_email) VALUES (NEW.firma_id, NEW.incorporada_por_usuario_id, NEW.incorporada_por_usuario_id, NEW.incorporada_por_email);
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_firmas_after_insert AFTER INSERT ON manufactura.firmas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_firmas_after_insert();

CREATE FUNCTION manufactura.fn_firmas_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint;
BEGIN
  SELECT a.usuario_id INTO v_id FROM manufactura.fn_actor() a;
  IF to_jsonb(NEW) - 'estado' - 'retirada_en' <> to_jsonb(OLD) - 'estado' - 'retirada_en' THEN
    RAISE EXCEPTION 'El contenido y los datos de una firma son inmutables; solo puede retirarse.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.estado = 'RETIRADA' OR NEW.estado <> 'RETIRADA' THEN
    RAISE EXCEPTION 'Una firma solo cambia de ACTIVA a RETIRADA.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_id IS DISTINCT FROM OLD.propietario_usuario_id AND v_id <> OLD.incorporada_por_usuario_id AND NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo la propietaria, quien la incorporó o un ADMIN pueden retirarla.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.retirada_en := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_firmas_update BEFORE UPDATE ON manufactura.firmas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_firmas_before_update();
CREATE TRIGGER trg_manufactura_firmas_no_delete BEFORE DELETE ON manufactura.firmas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

CREATE FUNCTION manufactura.fn_firma_aut_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text; v_f manufactura.firmas%ROWTYPE;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  SELECT * INTO v_f FROM manufactura.firmas WHERE firma_id = NEW.firma_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La firma no existe o no es accesible.' USING ERRCODE = 'insufficient_privilege'; END IF;
  -- Autoriza la propietaria; si la propietaria no tiene cuenta, quien la incorporó (ADMIN) o cualquier ADMIN.
  IF NOT ((v_f.propietario_usuario_id IS NOT NULL AND v_f.propietario_usuario_id = v_id)
          OR (v_f.propietario_usuario_id IS NULL AND (v_f.incorporada_por_usuario_id = v_id OR manufactura.fn_actor_es_admin()))) THEN
    RAISE EXCEPTION 'Solo la propietaria de la firma (o, si no tiene cuenta, el ADMIN que la incorporó) puede autorizar su uso.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_f.estado <> 'ACTIVA' THEN RAISE EXCEPTION 'La firma está retirada.' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM security.users u WHERE u.user_id = NEW.usuario_id AND u.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'El usuario autorizado debe estar ACTIVO.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.otorgada_por_usuario_id := v_id; NEW.otorgada_por_email := v_email; NEW.created_at := now(); NEW.revocada_en := NULL; NEW.revocada_por_usuario_id := NULL;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_firma_aut_insert BEFORE INSERT ON manufactura.firma_autorizaciones FOR EACH ROW EXECUTE FUNCTION manufactura.fn_firma_aut_before_insert();

CREATE FUNCTION manufactura.fn_firma_aut_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_f manufactura.firmas%ROWTYPE;
BEGIN
  SELECT a.usuario_id INTO v_id FROM manufactura.fn_actor() a;
  IF to_jsonb(NEW) - 'revocada_en' - 'revocada_por_usuario_id' <> to_jsonb(OLD) - 'revocada_en' - 'revocada_por_usuario_id' OR OLD.revocada_en IS NOT NULL OR NEW.revocada_en IS NULL THEN
    RAISE EXCEPTION 'Una autorización solo puede revocarse (una vez).' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT * INTO v_f FROM manufactura.firmas WHERE firma_id = OLD.firma_id;
  IF NOT ((v_f.propietario_usuario_id IS NOT NULL AND v_f.propietario_usuario_id = v_id)
          OR (v_f.propietario_usuario_id IS NULL AND (v_f.incorporada_por_usuario_id = v_id OR manufactura.fn_actor_es_admin()))) THEN
    RAISE EXCEPTION 'Solo la propietaria de la firma (o su ADMIN custodio) puede revocar el uso.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.revocada_en := now(); NEW.revocada_por_usuario_id := v_id;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_firma_aut_update BEFORE UPDATE ON manufactura.firma_autorizaciones FOR EACH ROW EXECUTE FUNCTION manufactura.fn_firma_aut_before_update();
CREATE TRIGGER trg_manufactura_firma_aut_no_delete BEFORE DELETE ON manufactura.firma_autorizaciones FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();

CREATE FUNCTION manufactura.fn_responsables_guardia() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_rev manufactura.revisiones%ROWTYPE; v_f manufactura.firmas%ROWTYPE; v_revision_id bigint;
BEGIN
  SELECT a.usuario_id INTO v_id FROM manufactura.fn_actor() a;
  v_revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  SELECT * INTO v_rev FROM manufactura.revisiones WHERE revision_id = v_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La revisión no existe o no es accesible.' USING ERRCODE = 'insufficient_privilege'; END IF;
  -- Solo un BORRADOR admite cambios de responsables (FINALIZANDO ya está congelado: el PDF sale de estas filas).
  IF v_rev.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Los responsables de una revisión % no se modifican.', v_rev.estado USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_rev.creado_por_usuario_id <> v_id AND NOT manufactura.fn_actor_es_admin() THEN
    RAISE EXCEPTION 'Solo el creador de la revisión o un ADMIN modifican sus responsables.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.revision_id <> OLD.revision_id OR NEW.posicion <> OLD.posicion) THEN
    RAISE EXCEPTION 'La revisión y la posición de un responsable no cambian.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.firma_id IS NOT NULL THEN
    -- Una imagen nueva debe ser UTILIZABLE por quien edita (propia o autorizada y ACTIVA); la ya asignada se conserva aunque después se retire.
    IF (TG_OP = 'INSERT' OR NEW.firma_id IS DISTINCT FROM OLD.firma_id) AND NOT manufactura.fn_firma_utilizable(NEW.firma_id, v_id) THEN
      RAISE EXCEPTION 'No tienes autorización para usar esa firma.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_f FROM manufactura.firmas WHERE firma_id = NEW.firma_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'No tienes autorización para usar esa firma.' USING ERRCODE = 'insufficient_privilege'; END IF;
    NEW.nombre := v_f.propietario_nombre;     -- con imagen, el nombre impreso es el de su propietaria: no se puede atribuir a otra persona
    NEW.firma_sha256 := v_f.sha256;
  ELSE
    NEW.firma_sha256 := NULL;
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_responsables_guardia BEFORE INSERT OR UPDATE OR DELETE ON manufactura.revision_responsables FOR EACH ROW EXECUTE FUNCTION manufactura.fn_responsables_guardia();

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Auditoría (misma función redactora de la 101): el contenido de la imagen no se copia a audit.cambios.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TRIGGER trg_audit_manufactura_firmas        AFTER INSERT OR UPDATE OR DELETE ON manufactura.firmas                FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('firma_id', 'omitir', 'contenido');
CREATE TRIGGER trg_audit_manufactura_firma_aut     AFTER INSERT OR UPDATE OR DELETE ON manufactura.firma_autorizaciones  FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('autorizacion_id', 'omitir');
CREATE TRIGGER trg_audit_manufactura_responsables  AFTER INSERT OR UPDATE OR DELETE ON manufactura.revision_responsables FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('responsable_id', 'omitir', 'nombre');

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Visibilidad por filas
--    · firmas: propietaria, quien la subió/incorporó, o con autorización vigente. NO se listan las firmas de la empresa.
--    · autorizaciones: la persona autorizada, la propietaria y quien la otorgó.
--    · responsables: visibles si la revisión es visible; modificables por el creador de la revisión o un ADMIN (y el trigger exige BORRADOR).
-- ---------------------------------------------------------------------------------------------------------------------
-- Las políticas de firmas y autorizaciones se refieren entre sí: para evitar recursión de RLS se consultan con funciones SECURITY DEFINER mínimas (solo devuelven un booleano / un id).
CREATE FUNCTION manufactura.fn_firma_autorizada_a(p_firma_id bigint, p_usuario bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, manufactura
AS $fn$ SELECT EXISTS (SELECT 1 FROM manufactura.firma_autorizaciones a WHERE a.firma_id = p_firma_id AND a.usuario_id = p_usuario AND a.revocada_en IS NULL) $fn$;
CREATE FUNCTION manufactura.fn_firma_propietario(p_firma_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, manufactura
AS $fn$ SELECT f.propietario_usuario_id FROM manufactura.firmas f WHERE f.firma_id = p_firma_id $fn$;
REVOKE ALL ON FUNCTION manufactura.fn_firma_autorizada_a(bigint, bigint), manufactura.fn_firma_propietario(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION manufactura.fn_firma_autorizada_a(bigint, bigint), manufactura.fn_firma_propietario(bigint) TO daubert_hub_app;

ALTER TABLE manufactura.firmas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufactura.firma_autorizaciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufactura.revision_responsables ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_firmas_sel ON manufactura.firmas FOR SELECT TO daubert_hub_app
  USING (propietario_usuario_id = manufactura.fn_actor_id() OR subida_por_usuario_id = manufactura.fn_actor_id() OR incorporada_por_usuario_id = manufactura.fn_actor_id()
         OR manufactura.fn_firma_autorizada_a(firmas.firma_id, manufactura.fn_actor_id()));
CREATE POLICY pol_firmas_ins ON manufactura.firmas FOR INSERT TO daubert_hub_app WITH CHECK (true);
CREATE POLICY pol_firmas_upd ON manufactura.firmas FOR UPDATE TO daubert_hub_app
  USING (propietario_usuario_id = manufactura.fn_actor_id() OR incorporada_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin()) WITH CHECK (true);

CREATE POLICY pol_firma_aut_sel ON manufactura.firma_autorizaciones FOR SELECT TO daubert_hub_app
  USING (usuario_id = manufactura.fn_actor_id() OR otorgada_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_firma_propietario(firma_autorizaciones.firma_id) = manufactura.fn_actor_id());
CREATE POLICY pol_firma_aut_ins ON manufactura.firma_autorizaciones FOR INSERT TO daubert_hub_app WITH CHECK (true);
CREATE POLICY pol_firma_aut_upd ON manufactura.firma_autorizaciones FOR UPDATE TO daubert_hub_app
  USING (otorgada_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin() OR manufactura.fn_firma_propietario(firma_autorizaciones.firma_id) = manufactura.fn_actor_id()) WITH CHECK (true);

CREATE POLICY pol_responsables_sel ON manufactura.revision_responsables FOR SELECT TO daubert_hub_app
  USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = revision_responsables.revision_id));
CREATE POLICY pol_responsables_ins ON manufactura.revision_responsables FOR INSERT TO daubert_hub_app
  WITH CHECK (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = revision_responsables.revision_id AND (r.creado_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin())));
CREATE POLICY pol_responsables_upd ON manufactura.revision_responsables FOR UPDATE TO daubert_hub_app
  USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = revision_responsables.revision_id AND (r.creado_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin()))) WITH CHECK (true);
CREATE POLICY pol_responsables_del ON manufactura.revision_responsables FOR DELETE TO daubert_hub_app
  USING (EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.revision_id = revision_responsables.revision_id AND (r.creado_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin())));

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Privilegios mínimos (sin DDL, sin TRUNCATE; DELETE únicamente en responsables, donde el trigger exige BORRADOR)
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON manufactura.firmas, manufactura.firma_autorizaciones, manufactura.revision_responsables FROM PUBLIC;
REVOKE ALL ON FUNCTION manufactura.fn_firma_utilizable(bigint, bigint) FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE (estado, retirada_en)  ON manufactura.firmas                TO daubert_hub_app;
GRANT SELECT, INSERT, UPDATE (revocada_en, revocada_por_usuario_id) ON manufactura.firma_autorizaciones TO daubert_hub_app;
GRANT SELECT, INSERT, UPDATE, DELETE                ON manufactura.revision_responsables TO daubert_hub_app;
GRANT EXECUTE ON FUNCTION manufactura.fn_firma_utilizable(bigint, bigint) TO daubert_hub_app;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') <> 8 THEN RAISE EXCEPTION 'Se esperaban 8 tablas en manufactura.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) <> 8 THEN RAISE EXCEPTION 'RLS debe estar activa en las 8 tablas.'; END IF;
  IF has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'DELETE') OR has_table_privilege('daubert_hub_app', 'manufactura.firma_autorizaciones', 'DELETE')
     OR has_table_privilege('daubert_hub_app', 'manufactura.firmas', 'TRUNCATE') OR has_table_privilege('daubert_hub_app', 'manufactura.revision_responsables', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Privilegios de la aplicación más amplios de lo permitido.';
  END IF;
  IF has_column_privilege('daubert_hub_app', 'manufactura.firmas', 'contenido', 'UPDATE') THEN RAISE EXCEPTION 'El contenido de una firma no debe ser actualizable.'; END IF;
END $$;

SELECT 'UP_OK manufactura 102 (3 tablas, RLS, 8 funciones, triggers, privilegios mínimos)' AS resultado;
COMMIT;
