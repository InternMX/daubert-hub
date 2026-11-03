import type { BindProductLookup, CampoInterpretado, InterpretacionBind } from '../services/bindProducts';
import type { FamilyConfig } from '../services/manufacturingFamilies';
import type { BorradorNuevo, DocumentoVista, IncidenciaReconocida } from '../services/manufacturingDocuments';
import type { Reconocimientos } from './incidencias';
import {
  ALL_FIELDS, buildInitialForm, confirmFamily, configOf, displayOrigin, selectFamily, setCustomColor, setFieldValue, toPreviewData, type BaseOrigin, type FamilyCode, type FieldKey, type SpecificationForm
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
  // La concentración del color (independiente de la resina VCI) se guarda en el snapshot para recuperarla tal cual; no viaja a la vista previa (la hoja imprime el texto del color).
  // Un valor vacío equivale a «sin dato»: no se guarda (y un documento anterior sin este campo no se completa).
  if (config.campos.includes('colorConcentracion') && form.fields.colorConcentracion.value.trim() !== '') datos.colorConcentracion = form.fields.colorConcentracion.value.trim();
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

// La concentración vacía equivale a un documento que no la tiene (documentos anteriores): no cuenta como cambio.
const sinVacios = (datos: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(datos).filter(([k, v]) => !(k === 'colorConcentracion' && v === '')));

/** Huella de lo que hay en pantalla, para saber si hay cambios sin guardar. */
export const claveDeCarga = (carga: CargaDocumento | null): string => (carga ? JSON.stringify({ f: carga.familia, d: sinVacios(carga.datos), c: carga.cliente ?? null, r: [...(carga.incidenciasReconocidas ?? [])].sort((a, b) => a.id.localeCompare(b.id)) }) : '');

/** Clave equivalente para un documento guardado (lo que devolvió el servidor), con la que se compara `claveDeCarga`. */
export function claveDeDocumento(doc: Pick<DocumentoVista, 'familia' | 'especificacion' | 'cliente'>): string {
  const cliente = doc.cliente ? (doc.cliente.empresaId ? { empresaId: doc.cliente.empresaId } : { nombre: doc.cliente.nombre }) : null;
  return JSON.stringify({ f: doc.familia, d: sinVacios(doc.especificacion.datos), c: cliente, r: [...(doc.especificacion.incidenciasReconocidas ?? [])].sort((a, b) => a.id.localeCompare(b.id)) });
}

export const reconocimientosDe = (doc: Pick<DocumentoVista, 'especificacion'>): Reconocimientos => Object.fromEntries((doc.especificacion.incidenciasReconocidas ?? []).map((r) => [r.id, r.huella]));

const ORIGENES_BASE: ReadonlySet<string> = new Set<BaseOrigin>(['BIND', 'SUGERIDO', 'CALCULADO', 'PENDIENTE', 'SIN_DATO']);

type Campo = SpecificationForm['fields'][FieldKey];
const comoSistema = (c: Campo, valor: string, origen: BaseOrigin): Campo => ({ ...c, value: valor, manual: false, confirmed: false, source: undefined, ref: undefined, base: { ...c.base, value: valor, origin: origen } });
const comoUsuario = (c: Campo, valor: string): Campo => ({ ...c, value: valor, source: undefined, ref: undefined, manual: true, confirmed: false });

/**
 * Color guardado. El selector («preset») no se guarda: se deduce del HEX guardado cuando coincide con un color del catálogo de la familia (Daubert Azul, Natural…); entonces la selección y la
 * procedencia de cada campo se reproducen tal como estaban (de sistema o del usuario). Solo un HEX ajeno al catálogo es un color personalizado («Otro») con su nombre y HEX guardados.
 */
function restaurarColor(form: SpecificationForm, config: FamilyConfig, datos: Record<string, string>, procedencia: Record<string, string>): SpecificationForm {
  const hex = datos.colorHex ?? form.fields.colorHex.value;
  const nombre = datos.colorNombre ?? form.fields.colorNombre.value;
  const def = hex === '' ? undefined : config.colores.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
  if (!def) {
    return form.fields.colorNombre.value !== nombre || form.fields.colorHex.value !== hex ? setCustomColor(form, nombre, hex) : form;
  }
  const f = form.fields;
  const origenDe = (key: 'colorHex' | 'colorNombre'): BaseOrigin | undefined => (procedencia[key] !== undefined && ORIGENES_BASE.has(procedencia[key] as string) ? procedencia[key] as BaseOrigin : undefined);
  const poner = (key: 'colorHex' | 'colorNombre', valor: string): Campo => { const o = origenDe(key); return o ? comoSistema(f[key], valor, o) : comoUsuario(f[key], valor); };
  const origenHex = origenDe('colorHex');
  return {
    ...form,
    fields: {
      ...f,
      colorPreset: origenHex ? comoSistema(f.colorPreset, def.id, origenHex) : comoUsuario(f.colorPreset, def.id),
      colorHex: poner('colorHex', hex),
      colorNombre: poner('colorNombre', nombre)
    }
  };
}

/**
 * Coloca los valores GUARDADOS sobre un formulario base. Los valores guardados mandan y NUNCA se reemplazan por sugerencias: cada campo recupera su procedencia guardada (BIND, sugerido,
 * calculado… se restauran como valor de origen; USUARIO o sin dato guardado queda «editado por el usuario»). La familia se confirma porque ya fue elegida al guardar.
 */
export function aplicarGuardado(form: SpecificationForm, doc: Pick<DocumentoVista, 'familia' | 'especificacion' | 'cliente'>, configs: FamilyConfig[]): SpecificationForm {
  let f = confirmFamily(selectFamily(form, doc.familia as FamilyCode, configs));
  const datos = doc.especificacion.datos;
  const procedencia = doc.especificacion.procedencia ?? {};
  for (const key of ALL_FIELDS) {
    if (key === 'codigo' || key === 'cliente' || key === 'colorNombre' || key === 'colorHex') continue;
    const valor = datos[key];
    if (valor === undefined) continue;
    const origen = procedencia[key];
    if (origen !== undefined && ORIGENES_BASE.has(origen)) {
      // Valor de origen (no editado): se restaura tal cual, sin pasar por las reglas de sugerencia que podrían recalcularlo.
      if (f.fields[key].value !== valor || f.fields[key].base.origin !== origen) f = { ...f, fields: { ...f.fields, [key]: { ...f.fields[key], value: valor, manual: false, confirmed: false, source: undefined, base: { ...f.fields[key].base, value: valor, origin: origen as BaseOrigin } } } };
    } else if (f.fields[key].value !== valor) f = setFieldValue(f, key, valor);
  }
  const config = configOf(configs, doc.familia as FamilyCode);
  if (config?.colorDibujo && (datos.colorNombre !== undefined || datos.colorHex !== undefined)) f = restaurarColor(f, config, datos, procedencia);
  if (doc.cliente) f = doc.cliente.empresaId ? setFieldValue(f, 'cliente', doc.cliente.nombre, 'CATALOGO', doc.cliente.empresaId) : setFieldValue(f, 'cliente', doc.cliente.nombre, 'PROVISIONAL');
  return f;
}

const vacio = <T,>(): CampoInterpretado<T> => ({ valor: null, origen: 'PENDIENTE', fuente: null });

/**
 * Copia de BIND tomada del PROPIO documento guardado (Code, Title, Description, Weight, CreationDate): permite abrir un borrador sin llamar a BIND. No contiene interpretación ni sugerencias
 * (eso solo lo calcula el backend a partir de una consulta a BIND): todo el contenido técnico viene de los datos guardados.
 */
export function lookupDesdeGuardado(doc: Pick<DocumentoVista, 'codigo' | 'especificacion'>): BindProductLookup {
  const b = doc.especificacion.bind ?? {};
  const campos: InterpretacionBind['campos'] = {
    codigoDcmx: vacio(), tipo: vacio(), resina: vacio(), ancho: vacio(), largo: vacio(), fuelleTotal: vacio(), fuelleDerecho: vacio(), fuelleIzquierdo: vacio(),
    unidadDimensiones: vacio(), calibre: vacio(), presentacion: vacio(), cantidad: vacio(), pesoLb: vacio()
  };
  return {
    origen: 'BIND',
    producto: { ID: '', Code: b.Code ?? doc.codigo, Title: b.Title ?? '', Description: b.Description ?? null, Weight: b.Weight ?? null, CreationDate: b.CreationDate ?? null },
    interpretacion: { campos, familia: { valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: [] }, pendientes: [], advertencias: [] },
    datosSugeridosPlantilla: {},
    familiaSugerida: [],
    sugerencias: {
      familia: { valor: null, motivo: '', incompatibles: [] }, resinaVci: { valor: null, regla: null, nota: '' }, resinaVciPorComposicion: {},
      color: { preset: null, concentracionPct: null, detectado: null, regla: null, nota: '' }, etiqueta: { valor: null, regla: null, nota: '' }
    },
    pendientes: [],
    advertencias: [],
    especificacionConfirmada: false
  };
}

/** Abre un documento guardado SIN consultar BIND: formulario del motor de especificaciones sobre la copia guardada, con los valores guardados encima. */
export function abrirSinBind(doc: DocumentoVista, configs: FamilyConfig[]): { lookup: BindProductLookup; form: SpecificationForm; reconocidas: Reconocimientos } {
  const lookup = lookupDesdeGuardado(doc);
  return { lookup, form: aplicarGuardado(buildInitialForm(lookup, configs), doc, configs), reconocidas: reconocimientosDe(doc) };
}
