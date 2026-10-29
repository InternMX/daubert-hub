import type { FamilyCode } from '../manufacturing-sheets/preview/family-registry';

// Gestor documental de las Hojas de Instrucción de Manufactura (TEST). Esta capa guarda, versiona y finaliza documentos; NO sabe componer hojas: para eso delega en
// `manufacturing-sheets` (SheetPreviewService / SheetPdfService) a través de un único puerto (`SheetEngine`). Nada de aquí es válido para producción.

export type EstadoRevision = 'BORRADOR' | 'FINALIZANDO' | 'FINALIZADA' | 'DESCARTADA';

/** Campos de BIND que pueden guardarse (los mismos 5 que admite la base; sin ID, costos ni credenciales). */
export interface BindGuardado {
  Code?: string;
  Title?: string;
  Description?: string;
  Weight?: number;
  CreationDate?: string;
}

export interface IncidenciaReconocida {
  id: string;
  huella: string;
}

/** Copia de la especificación técnica que se guarda en `manufactura.revisiones.especificacion` (jsonb). Solo claves de identificador: la base rechaza cualquier otra forma. */
export interface EspecificacionDocumento {
  datos: Record<string, string>;
  bind?: BindGuardado;
  procedencia?: Record<string, string>;
  colorPersonalizado?: { nombre?: string; hex?: string };
  incidenciasReconocidas?: IncidenciaReconocida[];
}

/** Quién actúa: SIEMPRE se construye en el backend a partir de la sesión autenticada (`request.user`); jamás de un cuerpo, parámetro o cabecera. */
export interface ActorDocumental {
  userId: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'GENERAL';
  requestId: string;
}

/** Fila de revisión tal como la devuelve la consulta común (ids bigint como texto). */
export interface RevisionRow {
  revision_id: string;
  public_id: string;
  documento_public_id: string;
  documento_creado_por: string;
  codigo_dcmx: string;
  variante: string | null;
  revision: number | null;
  revision_prevista: number | null;
  estado: EstadoRevision;
  version: number;
  familia: FamilyCode;
  especificacion: EspecificacionDocumento;
  especificacion_sha256: string;
  elaboro_nombre: string | null;
  elaboro_confirmado: boolean;
  autorizo_nombre: string | null;
  revisor_usuario_id: string | null;
  revisor_nombre: string | null;
  cliente_empresa_id: string | null;
  cliente_nombre: string | null;
  cliente_verificado: boolean;
  entorno_emision: 'PRUEBA';
  basada_en_revision_id: string | null;
  basada_en_revision: number | null;
  creado_por_usuario_id: string;
  creado_por_email: string;
  created_at: string;
  actualizado_por_email: string;
  updated_at: string;
  finalizando_token: string | null;
  finalizando_desde: string | null;
  finalizando_por_usuario_id: string | null;
  finalizado_por_email: string | null;
  finalizado_en: string | null;
  pdf_sha256: string | null;
  pdf_bytes: number | null;
  pdf_nombre: string | null;
}

export interface ConfirmacionRow {
  confirmacion_id: string;
  usuario_id: string;
  usuario_email: string;
  usuario_nombre: string;
  version: number;
  especificacion_sha256: string;
  es_autorrevision: boolean;
  como_revisor_asignado: boolean;
  created_at: string;
  vigente: boolean;
}

export interface UsuarioRevisorRow {
  id: string;
  displayName: string;
}
