import type { FirmaDeResponsable, FuncionResponsable, ResponsableEnvio, ResponsableVista } from '../services/manufacturingDocuments';

// Modelo de los responsables en pantalla (de uno a tres; el primero siempre «Generó») y su conversión desde/hacia lo guardado.

export interface ResponsableLocal { funcion: FuncionResponsable; nombre: string; firma: FirmaDeResponsable | null }

export const desdeVista = (r: readonly ResponsableVista[]): ResponsableLocal[] => (r.length > 0 ? r : [{ posicion: 1, funcion: 'GENERO' as const, nombre: '', conFirma: false, firma: null }])
  .map((x) => ({ funcion: x.funcion, nombre: x.nombre, firma: x.firma }));
export const haciaEnvio = (r: readonly ResponsableLocal[]): ResponsableEnvio[] => r.map((x, i) => ({ funcion: i === 0 ? 'GENERO' : x.funcion, nombre: x.nombre, ...(x.firma ? { firmaId: x.firma.id } : {}) }));
/** Clave de comparación (mismo criterio en pantalla y en lo guardado). */
export const claveResponsables = (r: ReadonlyArray<{ funcion: string; nombre: string; firmaId?: string | null }>): string => JSON.stringify(r.map((x, i) => [i === 0 ? 'GENERO' : x.funcion, x.nombre.trim(), x.firmaId ?? null]));

