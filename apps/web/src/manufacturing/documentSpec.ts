import type { BindProductLookup } from '../services/bindProducts';
import type { FamilyConfig } from '../services/manufacturingFamilies';
import type { BorradorNuevo, DocumentoVista, IncidenciaReconocida } from '../services/manufacturingDocuments';
import type { Reconocimientos } from './incidencias';
import {
  ALL_FIELDS, confirmFamily, configOf, displayOrigin, selectFamily, setCustomColor, setFieldValue, toPreviewData, type FamilyCode, type SpecificationForm
} from './specificationForm';

// Traducción entre el formulario de la especificación y la copia que guarda el gestor documental. NO compone hojas ni interpreta BIND: solo empaqueta lo que el usuario ya ve y, al abrir
// un documento guardado, vuelve a colocar esos valores en el formulario existente (que sigue siendo el único lugar de edición).

export type CargaDocumento = Omit<BorradorNuevo, 'codigo' | 'variante'>;

const numeroONada = (valor: number | string | null | undefined): number | undefined => {
  if (valor === null || valor === undefined || valor === '') return undefined;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Lo que se guarda: los datos que se envían a la vista previa (mismo origen de verdad), los 5 campos de BIND permitidos, la procedencia de cada dato y los reconocimientos {id, huella}. */
export function construirCarga(form: SpecificationForm, config: FamilyConfig, lookup: BindProductLookup | null, reconocidas: Reconocimientos): CargaDocumento | null {
  if (!form.family) return null;
  const datos: Record<string, string> = { ...toPreviewData(form, config), ...(config.fuelles ? { fuelleTotal: form.fields.fuelleTotal.value } : {}) };
  const procedencia: Record<string, string> = {};
  for (const key of Object.keys(datos)) {
    if (key in form.fields) procedencia[key] = displayOrigin(form.fields[key as keyof typeof form.fields]);
  }
  const cliente = form.fields.cliente;
  const carga: CargaDocumento = {
    familia: form.family,
    datos,
    procedencia,
    incidenciasReconocidas: Object.entries(reconocidas).map(([id, huella]): IncidenciaReconocida => ({ id, huella }))
  };
  if (lookup) {
    const p = lookup.producto;
    const peso = numeroONada(p.Weight);
    carga.bind = { Code: p.Code, Title: p.Title, ...(p.Description ? { Description: p.Description } : {}), ...(peso !== undefined ? { Weight: peso } : {}), ...(p.CreationDate ? { CreationDate: p.CreationDate } : {}) };
  }
  if (cliente.source === 'CATALOGO' && cliente.ref) carga.cliente = { empresaId: cliente.ref };
  else if (cliente.value.trim() !== '') carga.cliente = { nombre: cliente.value.trim() };
  return carga;
}

/** Huella de lo que hay en pantalla, para saber si hay cambios sin guardar. */
export const claveDeCarga = (carga: CargaDocumento | null): string => (carga ? JSON.stringify({ f: carga.familia, d: carga.datos, c: carga.cliente ?? null, r: [...(carga.incidenciasReconocidas ?? [])].sort((a, b) => a.id.localeCompare(b.id)) }) : '');

/** Clave equivalente para un documento guardado (lo que devolvió el servidor), con la que se compara `claveDeCarga`. */
export function claveDeDocumento(doc: Pick<DocumentoVista, 'familia' | 'especificacion' | 'cliente'>): string {
  const cliente = doc.cliente ? (doc.cliente.empresaId ? { empresaId: doc.cliente.empresaId } : { nombre: doc.cliente.nombre }) : null;
  return JSON.stringify({ f: doc.familia, d: doc.especificacion.datos, c: cliente, r: [...(doc.especificacion.incidenciasReconocidas ?? [])].sort((a, b) => a.id.localeCompare(b.id)) });
}

export const reconocimientosDe = (doc: Pick<DocumentoVista, 'especificacion'>): Reconocimientos => Object.fromEntries((doc.especificacion.incidenciasReconocidas ?? []).map((r) => [r.id, r.huella]));

/**
 * Coloca los valores GUARDADOS sobre un formulario recién construido desde BIND (la búsqueda por código ya reconstruyó la interpretación y las reglas). Los valores guardados mandan; cada
 * campo que difiere queda como «editado por el usuario». La familia se confirma porque ya fue elegida al guardar.
 */
export function aplicarGuardado(form: SpecificationForm, doc: Pick<DocumentoVista, 'familia' | 'especificacion' | 'cliente'>, configs: FamilyConfig[]): SpecificationForm {
  let f = confirmFamily(selectFamily(form, doc.familia as FamilyCode, configs));
  const datos = doc.especificacion.datos;
  for (const key of ALL_FIELDS) {
    if (key === 'codigo' || key === 'cliente' || key === 'colorNombre' || key === 'colorHex') continue;
    const valor = datos[key];
    if (valor !== undefined && f.fields[key].value !== valor) f = setFieldValue(f, key, valor);
  }
  const config = configOf(configs, doc.familia as FamilyCode);
  if (config?.colorDibujo && (datos.colorNombre !== undefined || datos.colorHex !== undefined)
    && (f.fields.colorNombre.value !== (datos.colorNombre ?? '') || f.fields.colorHex.value !== (datos.colorHex ?? ''))) f = setCustomColor(f, datos.colorNombre ?? '', datos.colorHex ?? '');
  if (doc.cliente) f = doc.cliente.empresaId ? setFieldValue(f, 'cliente', doc.cliente.nombre, 'CATALOGO', doc.cliente.empresaId) : setFieldValue(f, 'cliente', doc.cliente.nombre, 'PROVISIONAL');
  return f;
}
