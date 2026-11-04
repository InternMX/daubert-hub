-- =====================================================================================================================
-- UP · manufactura · ABREVIATURAS DE CLIENTE (SOLO TEST: daubert_hub_test)   [migración 104, adicional a la 101, 102 y 103]
--
-- PROPÓSITO: catálogo CRECIENTE de abreviaturas de código DCMX → cliente, para SUGERIR (nunca asignar) el cliente de una hoja de manufactura. Nace VACÍO: este UP no inserta clientes ni abreviaturas.
--
-- ALCANCE (UNA transacción; si algo falla no queda nada):
--   · CREA 1 tabla NUEVA: manufactura.cliente_abreviaturas
--       - una abreviatura (2–5 caracteres) puede asociarse a VARIOS clientes (hay prefijos compartidos por clientes distintos): NO hay unicidad global por abreviatura;
--       - solo se impide el DUPLICADO EXACTO vigente (misma abreviatura + mismo cliente + mismo alcance + mismo patrón);
--       - alcance: GENERAL (la abreviatura sola), CONTEXTO (un prefijo más largo validado, p. ej. DAID/DAIM) o CODIGO_COMPLETO (excepción por código completo);
--       - estado: CANDIDATA (hallazgo de extracción, sin confirmar), PROPUESTA (usuario GENERAL), CONFIRMADA (la usa el motor), RECHAZADA, INACTIVA;
--       - procedencia (origen), evidencia (documentos y códigos distintos + resumen + fuente), quién propuso y quién resolvió, con auditoría en audit.cambios.
--   · El cliente debe ser una empresa ACTIVA con rol CLIENTE ACTIVO en core.empresas (lo valida la base al crear y al confirmar).
--   · Solo un ADMIN crea candidatas/confirmadas y resuelve (confirmar, rechazar, inactivar); una cuenta GENERAL solo PROPONE y puede retirar su propia propuesta.
--   · CREA 2 funciones de apoyo (validación del cliente y motor de sugerencias SECURITY INVOKER, de solo lectura), 5 triggers, 3 políticas RLS y privilegios mínimos para daubert_hub_test_user.
--   · NO modifica ninguna tabla, función, trigger, política ni privilegio existente; NO toca core.alias_empresa, core.empresas, roles, ACL, daubert_global ni n8n.
--
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_test_user):
--   psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261106_104_manufactura_cliente_abreviaturas_test.up.sql
-- =====================================================================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF current_database() <> 'daubert_hub_test' THEN RAISE EXCEPTION 'ABORTO: solo daubert_hub_test (base actual: %).', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;
  IF to_regclass('manufactura.firmas') IS NULL OR to_regproc('manufactura.fn_actor') IS NULL OR to_regproc('manufactura.fn_actor_es_admin') IS NULL
     OR to_regproc('manufactura.fn_auditar_manufactura') IS NULL OR to_regproc('manufactura.fn_inmutable') IS NULL THEN
    RAISE EXCEPTION 'ABORTO: faltan las migraciones 101/102.';
  END IF;
  IF to_regclass('core.empresas') IS NULL OR to_regclass('core.empresa_roles') IS NULL THEN RAISE EXCEPTION 'ABORTO: faltan core.empresas / core.empresa_roles.'; END IF;
  IF to_regclass('manufactura.cliente_abreviaturas') IS NOT NULL THEN RAISE EXCEPTION 'ABORTO: la migración 104 ya está aplicada (no se reaplica).'; END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tabla
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE manufactura.cliente_abreviaturas (
  abreviatura_id           bigint GENERATED ALWAYS AS IDENTITY,
  public_id                uuid NOT NULL DEFAULT gen_random_uuid(),
  abreviatura              text NOT NULL,                       -- 2 a 5 caracteres A–Z/0–9, en mayúsculas (la base normaliza)
  cliente_empresa_id       bigint NOT NULL,
  alcance                  text NOT NULL DEFAULT 'GENERAL',
  codigo_patron            text,                                -- CONTEXTO: prefijo más largo que empieza con la abreviatura · CODIGO_COMPLETO: el código · GENERAL: NULL
  estado                   text NOT NULL DEFAULT 'PROPUESTA',
  origen                   text NOT NULL,
  documentos_evidencia     integer NOT NULL DEFAULT 0,          -- hojas únicas que respaldan la asociación
  codigos_evidencia        integer NOT NULL DEFAULT 0,          -- códigos DCMX DISTINTOS que la respaldan
  evidencia                text,
  fuente                   text,                                -- p. ej. nombre del informe de extracción (sin datos de clientes)
  propuesta_por_usuario_id bigint NOT NULL,
  propuesta_por_email      text NOT NULL,
  resuelta_por_usuario_id  bigint,
  resuelta_por_email       text,
  resuelta_en              timestamptz,
  motivo_resolucion        text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_manufactura_cliente_abreviaturas PRIMARY KEY (abreviatura_id),
  CONSTRAINT uq_manufactura_cliente_abreviaturas_public UNIQUE (public_id),
  CONSTRAINT fk_manufactura_cliente_abrev_cliente FOREIGN KEY (cliente_empresa_id) REFERENCES core.empresas (empresa_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_cliente_abrev_propuesta FOREIGN KEY (propuesta_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_manufactura_cliente_abrev_resuelta FOREIGN KEY (resuelta_por_usuario_id) REFERENCES security.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ck_manufactura_cliente_abrev_abreviatura CHECK (abreviatura ~ '^[A-Z][A-Z0-9]{1,4}$'),
  CONSTRAINT ck_manufactura_cliente_abrev_alcance CHECK (alcance IN ('GENERAL', 'CONTEXTO', 'CODIGO_COMPLETO')),
  CONSTRAINT ck_manufactura_cliente_abrev_patron CHECK (
       (alcance = 'GENERAL' AND codigo_patron IS NULL)
    OR (alcance = 'CONTEXTO' AND codigo_patron ~ '^[A-Z0-9]{3,12}$' AND char_length(codigo_patron) > char_length(abreviatura) AND left(codigo_patron, char_length(abreviatura)) = abreviatura)
    OR (alcance = 'CODIGO_COMPLETO' AND codigo_patron ~ '^[A-Z0-9][A-Z0-9._/-]{3,39}$' AND left(codigo_patron, char_length(abreviatura)) = abreviatura)),
  CONSTRAINT ck_manufactura_cliente_abrev_estado CHECK (estado IN ('CANDIDATA', 'PROPUESTA', 'CONFIRMADA', 'RECHAZADA', 'INACTIVA')),
  CONSTRAINT ck_manufactura_cliente_abrev_origen CHECK (origen IN ('EXTRACCION_HISTORICA', 'OCR_HISTORICO', 'MANUAL_ADMIN', 'PROPUESTA_USUARIO')),
  CONSTRAINT ck_manufactura_cliente_abrev_evidencia CHECK (documentos_evidencia >= 0 AND codigos_evidencia >= 0 AND codigos_evidencia <= documentos_evidencia
                                                          AND (evidencia IS NULL OR char_length(evidencia) <= 1000) AND (fuente IS NULL OR char_length(fuente) <= 200)),
  CONSTRAINT ck_manufactura_cliente_abrev_resolucion CHECK (
       (estado IN ('CANDIDATA', 'PROPUESTA') AND resuelta_por_usuario_id IS NULL AND resuelta_en IS NULL)
    OR (estado IN ('CONFIRMADA', 'RECHAZADA', 'INACTIVA') AND resuelta_por_usuario_id IS NOT NULL AND resuelta_por_email IS NOT NULL AND resuelta_en IS NOT NULL)),
  CONSTRAINT ck_manufactura_cliente_abrev_motivo CHECK ((motivo_resolucion IS NULL OR char_length(motivo_resolucion) <= 500) AND (estado <> 'RECHAZADA' OR char_length(btrim(coalesce(motivo_resolucion, ''))) >= 3))
);
-- Solo se impide el DUPLICADO EXACTO vigente. La misma abreviatura para clientes distintos, o varios patrones del mismo cliente, son legítimos.
CREATE UNIQUE INDEX uq_manufactura_cliente_abrev_vigente ON manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, alcance, (coalesce(codigo_patron, '')))
  WHERE estado IN ('CANDIDATA', 'PROPUESTA', 'CONFIRMADA');
CREATE INDEX ix_manufactura_cliente_abrev_busqueda ON manufactura.cliente_abreviaturas (abreviatura) WHERE estado = 'CONFIRMADA';
CREATE INDEX ix_manufactura_cliente_abrev_cliente ON manufactura.cliente_abreviaturas (cliente_empresa_id);
CREATE INDEX ix_manufactura_cliente_abrev_estado ON manufactura.cliente_abreviaturas (estado, created_at DESC);
COMMENT ON TABLE manufactura.cliente_abreviaturas IS 'Abreviaturas de código DCMX → cliente (core.empresas con rol CLIENTE). Sirve para SUGERIR el cliente de una hoja; nunca asigna. Una abreviatura puede asociarse a varios clientes. No se borra.';
COMMENT ON COLUMN manufactura.cliente_abreviaturas.alcance IS 'GENERAL = la abreviatura sola; CONTEXTO = prefijo más largo validado; CODIGO_COMPLETO = excepción por código completo (no identifica siempre a un único cliente).';
COMMENT ON COLUMN manufactura.cliente_abreviaturas.estado IS 'CANDIDATA = hallazgo de extracción sin confirmar; PROPUESTA = de un usuario GENERAL; CONFIRMADA = única que el motor trata como validada.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Funciones
-- ---------------------------------------------------------------------------------------------------------------------
-- ¿La empresa es un CLIENTE vigente? (empresa ACTIVA con rol CLIENTE ACTIVO). SECURITY INVOKER: usa los permisos de lectura de la sesión sobre core.
CREATE FUNCTION manufactura.fn_cliente_vigente(p_empresa_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, core
AS $fn$ SELECT EXISTS (SELECT 1 FROM core.empresas e JOIN core.empresa_roles r ON r.empresa_id = e.empresa_id
                        WHERE e.empresa_id = p_empresa_id AND e.estatus = 'ACTIVO' AND r.rol = 'CLIENTE' AND r.estatus = 'ACTIVO') $fn$;

CREATE FUNCTION manufactura.fn_cliente_abrev_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text; v_admin boolean;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  v_admin := manufactura.fn_actor_es_admin();
  NEW.abreviatura := upper(btrim(NEW.abreviatura));
  NEW.codigo_patron := NULLIF(upper(btrim(NEW.codigo_patron)), '');
  -- La procedencia de la propuesta la fija la sesión (no se puede declarar a nombre de otra persona) y la resolución nace vacía.
  NEW.propuesta_por_usuario_id := v_id; NEW.propuesta_por_email := v_email;
  NEW.resuelta_por_usuario_id := NULL; NEW.resuelta_por_email := NULL; NEW.resuelta_en := NULL; NEW.motivo_resolucion := NULL;
  NEW.created_at := now(); NEW.updated_at := now();
  IF NOT manufactura.fn_cliente_vigente(NEW.cliente_empresa_id) THEN
    RAISE EXCEPTION 'El cliente debe ser una empresa activa con rol CLIENTE activo.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT v_admin THEN
    IF NEW.estado <> 'PROPUESTA' OR NEW.origen <> 'PROPUESTA_USUARIO' THEN
      RAISE EXCEPTION 'Una cuenta GENERAL solo puede PROPONER abreviaturas (estado PROPUESTA, origen PROPUESTA_USUARIO); un ADMIN las confirma.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.documentos_evidencia := 0; NEW.codigos_evidencia := 0; NEW.fuente := NULL;
  ELSE
    IF NEW.estado NOT IN ('CANDIDATA', 'PROPUESTA', 'CONFIRMADA') THEN
      RAISE EXCEPTION 'Una abreviatura solo se crea como CANDIDATA, PROPUESTA o CONFIRMADA.' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.estado = 'CONFIRMADA' THEN NEW.resuelta_por_usuario_id := v_id; NEW.resuelta_por_email := v_email; NEW.resuelta_en := now(); END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_cliente_abrev_insert BEFORE INSERT ON manufactura.cliente_abreviaturas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_cliente_abrev_before_insert();

CREATE FUNCTION manufactura.fn_cliente_abrev_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, manufactura
AS $fn$
DECLARE v_id bigint; v_email text; v_admin boolean; v_permitida boolean;
BEGIN
  SELECT a.usuario_id, a.usuario_email INTO v_id, v_email FROM manufactura.fn_actor() a;
  v_admin := manufactura.fn_actor_es_admin();
  -- La identidad de la asociación no cambia (se crea otra): abreviatura, cliente, alcance, patrón, procedencia y fechas de origen.
  IF NEW.abreviatura_id IS DISTINCT FROM OLD.abreviatura_id OR NEW.public_id IS DISTINCT FROM OLD.public_id OR NEW.abreviatura IS DISTINCT FROM OLD.abreviatura
     OR NEW.cliente_empresa_id IS DISTINCT FROM OLD.cliente_empresa_id OR NEW.alcance IS DISTINCT FROM OLD.alcance OR NEW.codigo_patron IS DISTINCT FROM OLD.codigo_patron
     OR NEW.origen IS DISTINCT FROM OLD.origen OR NEW.propuesta_por_usuario_id IS DISTINCT FROM OLD.propuesta_por_usuario_id OR NEW.propuesta_por_email IS DISTINCT FROM OLD.propuesta_por_email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'La abreviatura, el cliente, el alcance, el patrón y la procedencia son inmutables: cree otra asociación.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    IF NOT v_admin AND (NEW.documentos_evidencia IS DISTINCT FROM OLD.documentos_evidencia OR NEW.codigos_evidencia IS DISTINCT FROM OLD.codigos_evidencia OR NEW.evidencia IS DISTINCT FROM OLD.evidencia
                        OR NEW.fuente IS DISTINCT FROM OLD.fuente OR NEW.motivo_resolucion IS DISTINCT FROM OLD.motivo_resolucion) THEN
      RAISE EXCEPTION 'Solo un ADMIN modifica la evidencia o el motivo.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.resuelta_por_usuario_id := OLD.resuelta_por_usuario_id; NEW.resuelta_por_email := OLD.resuelta_por_email; NEW.resuelta_en := OLD.resuelta_en;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- Cambio de estado: transiciones permitidas.
  v_permitida := (OLD.estado = 'CANDIDATA' AND NEW.estado IN ('PROPUESTA', 'CONFIRMADA', 'RECHAZADA'))
              OR (OLD.estado = 'PROPUESTA' AND NEW.estado IN ('CONFIRMADA', 'RECHAZADA', 'INACTIVA'))
              OR (OLD.estado = 'CONFIRMADA' AND NEW.estado = 'INACTIVA')
              OR (OLD.estado = 'INACTIVA' AND NEW.estado = 'CONFIRMADA');
  IF NOT v_permitida THEN
    RAISE EXCEPTION 'Transición no permitida: % → %.', OLD.estado, NEW.estado USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT v_admin THEN
    -- Una cuenta GENERAL solo puede retirar SU propia propuesta.
    IF NOT (OLD.estado = 'PROPUESTA' AND NEW.estado = 'INACTIVA' AND OLD.propuesta_por_usuario_id = v_id) THEN
      RAISE EXCEPTION 'Solo un ADMIN resuelve abreviaturas (una cuenta GENERAL solo puede retirar su propia propuesta).' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.estado = 'CONFIRMADA' AND NOT manufactura.fn_cliente_vigente(NEW.cliente_empresa_id) THEN
    RAISE EXCEPTION 'No se puede confirmar: el cliente ya no es una empresa activa con rol CLIENTE activo.' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.estado IN ('CONFIRMADA', 'RECHAZADA', 'INACTIVA') THEN
    NEW.resuelta_por_usuario_id := v_id; NEW.resuelta_por_email := v_email; NEW.resuelta_en := now();
  ELSE
    NEW.resuelta_por_usuario_id := NULL; NEW.resuelta_por_email := NULL; NEW.resuelta_en := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trg_manufactura_cliente_abrev_update BEFORE UPDATE ON manufactura.cliente_abreviaturas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_cliente_abrev_before_update();
CREATE TRIGGER trg_manufactura_cliente_abrev_no_delete BEFORE DELETE ON manufactura.cliente_abreviaturas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_inmutable();
CREATE TRIGGER trg_audit_manufactura_cliente_abrev AFTER INSERT OR UPDATE OR DELETE ON manufactura.cliente_abreviaturas FOR EACH ROW EXECUTE FUNCTION manufactura.fn_auditar_manufactura('abreviatura_id', 'omitir');

-- Motor de sugerencias (SOLO LECTURA, SECURITY INVOKER: respeta RLS y los permisos de la sesión).
-- Prioridad: 1 código completo CONFIRMADO · 2 contexto CONFIRMADO · 3 asociación general CONFIRMADA. Decide el PRIMER nivel con coincidencias, pero si ese nivel apunta a VARIOS clientes
-- (ambigüedad o contradicción) `requiere_eleccion` = true y se devuelven todas las alternativas. Las coincidencias de otros niveles se devuelven como información (decisivo = false).
-- Las abreviaturas NO CONFIRMADAS (candidatas/propuestas) solo se devuelven si se piden, con nivel 9: son informativas, nunca decisivas, y siempre requieren elección.
-- NUNCA deriva una abreviatura de los primeros caracteres del código: solo compara con las registradas. Una sugerencia exacta SIEMPRE requiere confirmación del usuario (la aplica la interfaz).
CREATE FUNCTION manufactura.fn_sugerir_cliente(p_codigo text, p_incluir_no_confirmadas boolean DEFAULT false)
RETURNS TABLE (
  nivel integer, nivel_nombre text, public_id uuid, abreviatura text, alcance text, codigo_patron text, estado text, cliente_empresa_id bigint, cliente_nombre text,
  documentos_evidencia integer, codigos_evidencia integer, decisivo boolean, requiere_eleccion boolean
)
LANGUAGE sql STABLE SET search_path = pg_catalog, manufactura, core
AS $fn$
  WITH c AS (SELECT upper(btrim(p_codigo)) AS cod),
  m AS (
    SELECT CASE WHEN a.estado = 'CONFIRMADA' THEN CASE a.alcance WHEN 'CODIGO_COMPLETO' THEN 1 WHEN 'CONTEXTO' THEN 2 ELSE 3 END ELSE 9 END AS nivel,
           a.public_id, a.abreviatura, a.alcance, a.codigo_patron, a.estado, a.cliente_empresa_id, e.nombre_comercial AS cliente_nombre, a.documentos_evidencia, a.codigos_evidencia
      FROM manufactura.cliente_abreviaturas a
      JOIN core.empresas e ON e.empresa_id = a.cliente_empresa_id
      CROSS JOIN c
     WHERE c.cod ~ '^[A-Z0-9][A-Z0-9._/-]{1,39}$'
       AND (a.estado = 'CONFIRMADA' OR (p_incluir_no_confirmadas AND a.estado IN ('CANDIDATA', 'PROPUESTA')))
       AND manufactura.fn_cliente_vigente(a.cliente_empresa_id)
       AND ((a.alcance = 'CODIGO_COMPLETO' AND c.cod = a.codigo_patron)
         OR (a.alcance = 'CONTEXTO' AND left(c.cod, char_length(a.codigo_patron)) = a.codigo_patron)
         OR (a.alcance = 'GENERAL' AND left(c.cod, char_length(a.abreviatura)) = a.abreviatura))
  ), d AS (SELECT min(nivel) FILTER (WHERE nivel < 9) AS nivel_decisivo FROM m),
  k AS (SELECT m.nivel, count(DISTINCT m.cliente_empresa_id) AS clientes FROM m GROUP BY m.nivel)
  SELECT m.nivel, CASE m.nivel WHEN 1 THEN 'CODIGO_COMPLETO' WHEN 2 THEN 'CONTEXTO' WHEN 3 THEN 'GENERAL' ELSE 'SIN_CONFIRMAR' END, m.public_id, m.abreviatura, m.alcance, m.codigo_patron, m.estado,
         m.cliente_empresa_id, m.cliente_nombre, m.documentos_evidencia, m.codigos_evidencia,
         COALESCE(m.nivel = d.nivel_decisivo, false) AS decisivo,
         CASE WHEN d.nivel_decisivo IS NULL THEN true WHEN m.nivel = d.nivel_decisivo THEN k.clientes > 1 ELSE false END AS requiere_eleccion
    FROM m CROSS JOIN d JOIN k ON k.nivel = m.nivel
   ORDER BY m.nivel, m.cliente_nombre, m.abreviatura, m.public_id;
$fn$;
COMMENT ON FUNCTION manufactura.fn_sugerir_cliente(text, boolean) IS 'Sugiere clientes para un código DCMX (solo lectura, SECURITY INVOKER). Prioridad: código completo > contexto > general (solo CONFIRMADAS). Varias alternativas en el nivel decisivo ⇒ requiere_eleccion. Nunca asigna ni deriva abreviaturas del código.';
REVOKE ALL ON FUNCTION manufactura.fn_sugerir_cliente(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION manufactura.fn_cliente_vigente(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION manufactura.fn_sugerir_cliente(text, boolean), manufactura.fn_cliente_vigente(bigint) TO daubert_hub_test_user;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. RLS y privilegios mínimos
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE manufactura.cliente_abreviaturas ENABLE ROW LEVEL SECURITY;
-- Todas las cuentas ven las CONFIRMADAS (las usa el motor); cada quien ve sus propuestas; un ADMIN ve todo.
CREATE POLICY pol_cliente_abrev_sel ON manufactura.cliente_abreviaturas FOR SELECT TO daubert_hub_test_user
  USING (manufactura.fn_actor_id() IS NOT NULL AND (estado = 'CONFIRMADA' OR propuesta_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin()));
CREATE POLICY pol_cliente_abrev_ins ON manufactura.cliente_abreviaturas FOR INSERT TO daubert_hub_test_user WITH CHECK (manufactura.fn_actor_id() IS NOT NULL);
CREATE POLICY pol_cliente_abrev_upd ON manufactura.cliente_abreviaturas FOR UPDATE TO daubert_hub_test_user
  USING (manufactura.fn_actor_es_admin() OR propuesta_por_usuario_id = manufactura.fn_actor_id()) WITH CHECK (true);

REVOKE ALL ON manufactura.cliente_abreviaturas FROM PUBLIC;
GRANT SELECT, INSERT ON manufactura.cliente_abreviaturas TO daubert_hub_test_user;
GRANT UPDATE (estado, motivo_resolucion, documentos_evidencia, codigos_evidencia, evidencia, fuente, resuelta_por_usuario_id, resuelta_por_email, resuelta_en, updated_at) ON manufactura.cliente_abreviaturas TO daubert_hub_test_user;
-- La app necesita LEER core.empresas / core.empresa_roles para validar al cliente: ya lo tiene en TEST (la API de clientes lo usa); no se concede nada nuevo sobre core.
DO $$
BEGIN
  IF NOT (has_table_privilege('daubert_hub_test_user', 'core.empresas', 'SELECT') AND has_table_privilege('daubert_hub_test_user', 'core.empresa_roles', 'SELECT')) THEN
    RAISE EXCEPTION 'ABORTO: daubert_hub_test_user debe poder LEER core.empresas y core.empresa_roles (esta migración no concede privilegios sobre core).';
  END IF;
END $$;

DO $$
DECLARE v_f record;
BEGIN
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura') <> 9 THEN RAISE EXCEPTION 'Debe haber exactamente 9 tablas en manufactura.'; END IF;
  IF (SELECT count(*) FROM manufactura.cliente_abreviaturas) <> 0 THEN RAISE EXCEPTION 'La tabla debe nacer vacía.'; END IF;
  IF has_table_privilege('daubert_hub_test_user', 'manufactura.cliente_abreviaturas', 'DELETE') OR has_column_privilege('daubert_hub_test_user', 'manufactura.cliente_abreviaturas', 'abreviatura', 'UPDATE')
     OR has_column_privilege('daubert_hub_test_user', 'manufactura.cliente_abreviaturas', 'cliente_empresa_id', 'UPDATE') THEN RAISE EXCEPTION 'Privilegios de tabla excesivos.'; END IF;
  FOR v_f IN SELECT p.proname, p.prosecdef FROM pg_proc p WHERE p.oid IN ('manufactura.fn_sugerir_cliente(text, boolean)'::regprocedure, 'manufactura.fn_cliente_vigente(bigint)'::regprocedure) LOOP
    IF v_f.prosecdef THEN RAISE EXCEPTION '% no debe ser SECURITY DEFINER.', v_f.proname; END IF;
  END LOOP;
END $$;

SELECT 'UP_OK manufactura 104 (cliente_abreviaturas: tabla nueva vacía; sin clientes ni abreviaturas insertados; sin cambios en objetos existentes)' AS resultado;
COMMIT;
