import { createContext, useContext } from 'react';
import type { ConfirmacionDocumento, DocumentoVista, MotivoNoLista, UsuarioRevisor } from '../services/manufacturingDocuments';
import type { CargaDocumento } from './documentSpec';

// Estado compartido del gestor documental dentro de la hoja: lo crea `DocumentoProvider` y lo consumen la barra de acciones, la sección de responsables y la lista de hojas del código.

export type Aviso = { tipo: 'success' | 'error' | 'info' | 'warning'; texto: string };

export interface Documento {
  doc: DocumentoVista | null; codigo: string | null; carga: CargaDocumento | null;
  variante: string; setVariante: (v: string) => void;
  ocupado: boolean; aviso: Aviso | null; motivos: MotivoNoLista[]; conflicto: boolean;
  revisores: UsuarioRevisor[]; revisorSel: string; setRevisorSel: (v: string) => void;
  elaboro: string; setElaboro: (v: string) => void; autorizo: string; setAutorizo: (v: string) => void;
  sucio: boolean; vigentes: ConfirmacionDocumento[]; obsoletas: number; elaboroCambiado: boolean;
  confirmando: 'finalizar' | 'descartar' | null; setConfirmando: (v: 'finalizar' | 'descartar' | null) => void;
  guardar: () => Promise<void>; recargar: () => Promise<void>; abrirPorId: (id: string) => Promise<void>; descargar: () => Promise<void>; descargarPorId: (id: string) => Promise<void>;
  nuevaRevisionDe: (documentoId: string) => Promise<void>; confirmarElaboro: () => Promise<void>; guardarAutorizo: () => Promise<void>; asignar: () => Promise<void>;
  registrar: () => Promise<void>; finalizar: () => Promise<void>; descartar: () => Promise<void>; cancelarFin: () => Promise<void>; reintentarFin: () => Promise<void>;
  /** Abre «Mis hojas»; con `porCodigo` muestra además el historial de ese código. */
  abrirHistorial: (porCodigo: boolean) => void;
  /** Deja el panel «sin guardar» (para preparar una hoja nueva). */
  cerrar: () => void;
}

export const Contexto = createContext<Documento | null>(null);

export function useDocumento(): Documento {
  const c = useContext(Contexto);
  if (!c) throw new Error('useDocumento requiere un DocumentoProvider.');
  return c;
}
