// Single source of truth for what the Audit screen may read from audit.cambios.
//
// audit.cambios stores full row copies as JSONB. Nothing is exposed unless its
// (schema, table) is declared here AND the column is on that entity's field
// allowlist, so a table or column added to the audit triggers later stays
// invisible until someone deliberately lists it. Entries mirror the audited
// sources, including the new TEST-only payment file registry/assignment tables.
//
// Extension point for specialized sources: operacion.ajustes_series is NOT here
// on purpose — it is its own canonical ledger (no audit.cambios trigger). When
// it is added, it must be a separate source adapter that reads that table, so
// the same event is never read from two places.
//
// ops.automation_trigger_requests / ops.automation_review_acknowledgements are
// read here ONLY through their audit.cambios copy; their own tables are not
// read by this module, so each event appears exactly once. If they later get a
// specialized adapter, remove them from this catalog in the same change.

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export const AUDIT_ACTIONS: readonly AuditAction[] = ['CREATE', 'UPDATE', 'DELETE'];

export const OPERATION_BY_ACTION: Record<AuditAction, 'INSERT' | 'UPDATE' | 'DELETE'> = { CREATE: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE' };
export const ACTION_BY_OPERATION: Record<string, AuditAction | undefined> = { INSERT: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' };

export type AuditModuleKey = 'COMPANIES' | 'CONTACTS' | 'USERS' | 'AUTOMATIONS';

export const AUDIT_MODULE_LABELS: Record<AuditModuleKey, string> = {
  COMPANIES: 'Empresas',
  CONTACTS: 'Contactos',
  USERS: 'Usuarios',
  AUTOMATIONS: 'Automatizaciones'
};

export interface AuditFieldDefinition {
  key: string;
  label: string;
}

export interface AuditEntityDefinition {
  key: string;
  schema: string;
  table: string;
  label: string;
  module: AuditModuleKey;
  // Allowlisted column used to name the affected record in lists (null = none).
  recordLabelField: string | null;
  fields: AuditFieldDefinition[];
}

const f = (key: string, label: string): AuditFieldDefinition => ({ key, label });

export const AUDIT_ENTITIES: readonly AuditEntityDefinition[] = [
  {
    key: 'COMPANY', schema: 'core', table: 'empresas', label: 'Empresa', module: 'COMPANIES', recordLabelField: 'nombre_comercial',
    fields: [f('nombre_comercial', 'Nombre comercial'), f('razon_social', 'Razón social'), f('tipo_empresa', 'Tipo de empresa'), f('estatus', 'Estatus'), f('ruta_dropbox', 'Ruta de Dropbox'), f('observaciones', 'Observaciones')]
  },
  {
    key: 'COMPANY_ROLE', schema: 'core', table: 'empresa_roles', label: 'Rol de empresa', module: 'COMPANIES', recordLabelField: 'rol',
    fields: [f('rol', 'Rol'), f('estatus', 'Estatus'), f('observaciones', 'Observaciones')]
  },
  {
    key: 'COMPANY_FISCAL', schema: 'core', table: 'empresas_fiscales', label: 'Datos fiscales', module: 'COMPANIES', recordLabelField: 'razon_social',
    fields: [f('razon_social', 'Razón social'), f('rfc', 'RFC'), f('es_vigente', 'Vigente'), f('fecha_inicio', 'Fecha de inicio'), f('fecha_fin', 'Fecha de fin'), f('observaciones', 'Observaciones')]
  },
  {
    key: 'COMPANY_ALIAS', schema: 'core', table: 'alias_empresa', label: 'Alias de empresa', module: 'COMPANIES', recordLabelField: 'alias',
    fields: [f('alias', 'Alias'), f('tipo_alias', 'Tipo de alias'), f('estatus', 'Estatus'), f('observaciones', 'Observaciones')]
  },
  {
    key: 'COMPANY_ADDRESS', schema: 'core', table: 'direcciones', label: 'Dirección', module: 'COMPANIES', recordLabelField: 'direccion_completa',
    fields: [f('tipo_direccion', 'Tipo de dirección'), f('calle', 'Calle'), f('numero_exterior', 'Número exterior'), f('numero_interior', 'Número interior'), f('colonia', 'Colonia'), f('codigo_postal', 'Código postal'), f('municipio', 'Municipio'), f('estado', 'Estado'), f('pais', 'País'), f('direccion_completa', 'Dirección completa'), f('referencias', 'Referencias'), f('es_principal', 'Principal'), f('estatus', 'Estatus'), f('fecha_inicio', 'Fecha de inicio'), f('fecha_fin', 'Fecha de fin')]
  },
  {
    key: 'CONTACT', schema: 'core', table: 'contactos', label: 'Contacto', module: 'CONTACTS', recordLabelField: 'nombre',
    fields: [f('nombre', 'Nombre'), f('tipo_contacto', 'Tipo de contacto'), f('area', 'Área'), f('cargo', 'Cargo'), f('es_contacto_principal', 'Contacto principal'), f('estatus', 'Estatus'), f('observaciones', 'Observaciones')]
  },
  {
    key: 'CONTACT_METHOD', schema: 'core', table: 'medios_contacto', label: 'Medio de contacto', module: 'CONTACTS', recordLabelField: 'valor',
    fields: [f('tipo_medio', 'Tipo de medio'), f('valor', 'Valor'), f('es_principal', 'Principal'), f('recibe_notificacion_pago', 'Recibe notificación de pago'), f('tipo_destinatario_pago', 'Tipo de destinatario de pago'), f('estatus', 'Estatus'), f('observaciones', 'Observaciones')]
  },
  {
    // password_hash is stripped by audit.fn_registrar_cambio_security_users and is
    // deliberately NOT allowlisted here either (defense in depth).
    key: 'USER', schema: 'security', table: 'users', label: 'Usuario', module: 'USERS', recordLabelField: 'email',
    fields: [f('display_name', 'Nombre'), f('email', 'Correo'), f('role', 'Rol'), f('status', 'Estado'), f('must_change_password', 'Debe cambiar contraseña'), f('password_changed', 'Contraseña modificada')]
  },
  {
    key: 'PAYMENT_FILE', schema: 'core', table: 'archivos_notificacion_pago', label: 'Archivo de notificación de pago', module: 'AUTOMATIONS', recordLabelField: 'nombre_archivo',
    fields: [f('correo_id', 'Correo'), f('nombre_archivo', 'Archivo'), f('estado_identidad', 'Identidad'), f('estado_operativo', 'Estado operativo'), f('created_by', 'Registrado por'), f('updated_by', 'Actualizado por')]
  },
  {
    key: 'PAYMENT_FILE_ASSIGNMENT', schema: 'core', table: 'asignaciones_archivo_notificacion_pago', label: 'Asignación puntual de archivo', module: 'AUTOMATIONS', recordLabelField: null,
    fields: [f('archivo_id', 'Archivo'), f('empresa_id', 'Empresa'), f('estatus', 'Estatus'), f('version', 'Versión'), f('created_by', 'Creado por'), f('updated_by', 'Actualizado por')]
  },
  {
    key: 'AUTOMATION_TRIGGER_REQUEST', schema: 'ops', table: 'automation_trigger_requests', label: 'Disparo manual de automatización', module: 'AUTOMATIONS', recordLabelField: 'automation_code',
    fields: [f('automation_code', 'Automatización'), f('action_type', 'Acción'), f('outcome', 'Resultado'), f('target_reference', 'Referencia'), f('requested_by_email', 'Solicitado por')]
  },
  {
    key: 'AUTOMATION_REVIEW_ACK', schema: 'ops', table: 'automation_review_acknowledgements', label: 'Acuse de revisión', module: 'AUTOMATIONS', recordLabelField: 'automation_code',
    fields: [f('automation_code', 'Automatización'), f('source_type', 'Tipo de fuente'), f('source_reference', 'Referencia de la fuente'), f('source_occurred_at', 'Fecha del evento'), f('reviewed_by_email', 'Revisado por')]
  }
];

export const AUDIT_ENTITY_KEYS: readonly string[] = AUDIT_ENTITIES.map((entity) => entity.key);

const entityByKey = new Map(AUDIT_ENTITIES.map((entity) => [entity.key, entity]));
const entityByTable = new Map(AUDIT_ENTITIES.map((entity) => [`${entity.schema}.${entity.table}`, entity]));

export function findEntityByKey(key: string): AuditEntityDefinition | undefined {
  return entityByKey.get(key);
}

export function findEntityByTable(schema: string, table: string): AuditEntityDefinition | undefined {
  return entityByTable.get(`${schema}.${table}`);
}

// Belt and braces on top of the allowlist: a column whose name looks like a
// credential is never presented, even if someone adds it to a field list by
// mistake. Two boolean flags are not secrets and are explicitly exempt:
// `password_changed` (emitted by the users trigger) and `must_change_password`.
const SENSITIVE_FIELD_PATTERN = /pass(word)?|token|secret|hash|api[_-]?key|cookie|session|credential/i;
const NON_SECRET_FLAGS = new Set(['password_changed', 'must_change_password']);

export function isSensitiveFieldName(name: string): boolean {
  return !NON_SECRET_FLAGS.has(name) && SENSITIVE_FIELD_PATTERN.test(name);
}
