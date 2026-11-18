import type { ResumenDocumento } from '../services/manufacturingDocuments';

/** «REV01», «REV02 (en curso)» o «Borrador». */
export const etiquetaRevision = (r: Pick<ResumenDocumento, 'revision' | 'revisionPrevista' | 'estado'>): string => (r.revision ? `REV${String(r.revision).padStart(2, '0')}` : r.estado === 'FINALIZANDO' && r.revisionPrevista ? `REV${String(r.revisionPrevista).padStart(2, '0')} (en curso)` : 'Borrador');
