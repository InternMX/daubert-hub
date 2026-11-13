import { createContext, useContext } from 'react';
import type { ConfirmacionDocumento, DocumentoVista, MotivoNoLista, UsuarioRevisor } from '../services/manufacturingDocuments';
import type { CargaDocumento } from './documentSpec';

// Estado compartido del gestor documental dentro de la hoja: lo crea `DocumentoProvider` y lo consumen la barra de acciones, la sección de responsables y la lista de hojas del código.

/** Estado visible del guardado automático. `pendiente`: hay cambios que aún no se enviaron; `guardado` solo tras la confirmación del servidor. */
export type EstadoGuardado = 'inactivo' | 'pendiente' | 'guardando' | 'guardado' | 'error' | 'conflicto' | 'existe';

export type Aviso = { tipo: 'success' | 'error' | 'info' | 'warning'; texto: string };

export interface Documento {
  doc: DocumentoVista | null; codigo: string | null; carga: CargaDocumento | null;
  variante: string; setVariante: (v: string) => void;
  ocupado: boolean; aviso: Aviso | null; motivos: MotivoNoLista[]; conflicto: boolean;
  revisores: UsuarioRevisor[]; revisorSel: string; setRevisorSel: (v: string) => void;
  elaboro: string; setElaboro: (v: string) => void; autorizo: string; setAutorizo: (v: string) => void;
  sucio: boolean; vigentes: ConfirmacionDocumento[]; obsoletas: number; elaboroCambiado: boolean;
  confirmando: 'finalizar' | 'descartar' | null; setConfirmando: (v: 'finalizar' | 'descartar' | null) => void;
  /** Finalización en curso (guardando lo pendiente, generando el PDF): evita clics repetidos y alimenta «Finalizando…». */
  finalizando: boolean;
  /** Resultado de un intento de finalizar que falló: texto comprensible + requisitos que informó el servidor (se muestra en la sección «Finalizar hoja»). */
  errorFin: { texto: string; motivos: MotivoNoLista[] } | null;
  /** Error al DESCARGAR o ver el PDF almacenado (distinto de un error de finalización). */
  errorDescarga: string | null;
  /** Abre en otra pestaña el PDF ALMACENADO de la revisión finalizada (no se vuelve a generar). */
  verFinalizada: () => Promise<void>;
  guardar: () => Promise<void>; recargar: () => Promise<void>; abrirPorId: (id: string) => Promise<void>; descargar: () => Promise<void>; descargarPorId: (id: string) => Promise<void>;
  nuevaRevisionDe: (documentoId: string) => Promise<void>; confirmarElaboro: () => Promise<void>; guardarAutorizo: () => Promise<void>; asignar: () => Promise<void>;
  registrar: () => Promise<void>; finalizar: () => Promise<void>; descartar: () => Promise<void>; cancelarFin: () => Promise<void>; reintentarFin: () => Promise<void>;
  /** Guardado automático activo (la hoja se guarda sola; no hay botón «Guardar»). */
  autoguardar: boolean;
  guardado: EstadoGuardado;
  guardadoEn: Date | null;
  /** Guarda ya (sin esperar el retardo): «Reintentar» / «Guardar ahora». */
  guardarAhora: () => Promise<void>;
  /** Documento ajeno en CONSULTA (borrador o finalización en curso de otra cuenta, o de la propia mientras no se edita como administrador): solo lectura, sin autoguardado ni acciones de escritura. */
  soloConsulta: boolean;
  /** Un ADMIN puede pasar un borrador ajeno de consulta a edición con una acción explícita; GENERAL nunca. */
  puedeEditarComoAdmin: boolean;
  editarComoAdmin: () => void;
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
