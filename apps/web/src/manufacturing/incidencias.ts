import type { AdvertenciaBind } from '../services/bindProducts';
import type { FamilyConfig, FieldKey } from '../services/manufacturingFamilies';
import type { Incidencia, NivelIncidencia, SeccionIncidencia } from '../services/sheetPreview';

// Consolidación de las incidencias de Hojas de Manufactura en el navegador. NO es un motor de validación: el backend es la autoridad de la coherencia técnica y define el modelo
// (id estable por causa, severidad, campos, sección). Aquí solo se reúnen las incidencias de las fuentes ya existentes (validación local de campos obligatorios, advertencias de
// BIND y coherencia técnica del backend), se cuentan UNA vez por causa (mismo id) y se deciden su ubicación (campo, sección o BIND) y su reconocimiento.

export type { Incidencia, NivelIncidencia, SeccionIncidencia };

export const ORDEN_NIVEL: Record<NivelIncidencia, number> = { ERROR: 0, CONTRADICCION: 1, PENDIENTE: 2, INFORMACION: 3 };
export const NIVEL_ETIQUETA: Record<NivelIncidencia, { singular: string; plural: string }> = {
  ERROR: { singular: 'error', plural: 'errores' },
  CONTRADICCION: { singular: 'contradicción', plural: 'contradicciones' },
  PENDIENTE: { singular: 'pendiente', plural: 'pendientes' },
  INFORMACION: { singular: 'informativa', plural: 'informativas' }
};

/** Título de la tarjeta de cada sección (para localizarla desde el resumen). */
export const SECCION_ETIQUETA: Record<SeccionIncidencia, string> = {
  familia: 'Familia de manufactura', bind: 'Producto en BIND', datos: 'Datos generales', color: 'Color', capas: 'Capas COEX', composicion: 'Composición y presentación', medidas: 'Medidas y peso', 'vista-previa': 'Vista previa de la hoja'
};

export const idIncidencia = (codigo: string, campos: readonly string[] = []): string => (campos.length === 0 ? codigo : `${codigo}:${[...campos].sort().join('+')}`);

interface Datos { codigo: string; nivel: NivelIncidencia; campos?: FieldKey[]; seccion: SeccionIncidencia; mensaje: string; resumen?: string; origen?: Incidencia['origen']; afectaVistaPrevia?: boolean; reconocible?: boolean; id?: string }

export function crearIncidencia(d: Datos): Incidencia {
  const campos = d.campos ?? [];
  return { id: d.id ?? idIncidencia(d.codigo, campos), codigo: d.codigo, nivel: d.nivel, campos, seccion: d.seccion, mensaje: d.mensaje, ...(d.resumen ? { resumen: d.resumen } : {}), origen: d.origen ?? 'FORMULARIO', afectaVistaPrevia: d.afectaVistaPrevia ?? false, reconocible: d.reconocible ?? d.nivel === 'CONTRADICCION' };
}

/** Une incidencias de la misma causa (mismo id): conserva la mayor severidad, la primera redacción y la unión de campos. No compara textos. Misma regla que la API. */
export function consolidar(lista: readonly Incidencia[]): Incidencia[] {
  const porId = new Map<string, Incidencia>();
  for (const actual of lista) {
    const previa = porId.get(actual.id);
    if (!previa) { porId.set(actual.id, actual); continue; }
    porId.set(actual.id, {
      ...previa,
      nivel: ORDEN_NIVEL[actual.nivel] < ORDEN_NIVEL[previa.nivel] ? actual.nivel : previa.nivel,
      campos: [...new Set([...previa.campos, ...actual.campos])],
      afectaVistaPrevia: previa.afectaVistaPrevia || actual.afectaVistaPrevia,
      reconocible: previa.reconocible && actual.reconocible
    });
  }
  return [...porId.values()].sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
}

// Sección de la pantalla a la que pertenece cada campo (para ubicar una incidencia cuando su campo no está visible o afecta a varios).
const SECCION_DE_CAMPO: Partial<Record<FieldKey, SeccionIncidencia>> = {
  coexVariante: 'color', colorPreset: 'color', colorNombre: 'color', colorHex: 'color', colorConcentracion: 'color',
  pesoCapaInterior: 'capas', pesoCapaIntermedia: 'capas', pesoCapaExterior: 'capas', lbVciInterior: 'capas', lbVciIntermedia: 'capas', lbVciExterior: 'capas',
  composicion: 'composicion', presentacion: 'composicion', cantidad: 'composicion', cantidadUnidad: 'composicion', modalidad: 'composicion',
  ancho: 'medidas', largo: 'medidas', anchoRollo: 'medidas', anchoDoblado: 'medidas', medidaPliegue: 'medidas', largoPresentacionFinal: 'medidas', anchoPresentacionFinal: 'medidas',
  fuelleTotal: 'medidas', fuelleDerecho: 'medidas', fuelleIzquierdo: 'medidas', unidadDimensiones: 'medidas', calibre: 'medidas', pesoLb: 'medidas'
};
export const seccionDeCampo = (key: FieldKey): SeccionIncidencia => SECCION_DE_CAMPO[key] ?? 'datos';

/** Advertencias de BIND que solo EXPLICAN la procedencia de un valor ya mostrado con su chip («Inferido de Code», «Sugerido…») y su nota en el campo: no son incidencias. */
const EXPLICA_PROCEDENCIA = new Set(['DATO_INFERIDO_DEL_CODIGO', 'MEDIDAS_TRES_DIMENSIONES_SUGERIDAS', 'MEDIDAS_EN_VARIOS_SISTEMAS', 'CALIBRE_SIN_UNIDAD']);

const ORIGEN_DE_BIND = (codigo: string): Incidencia['origen'] => (codigo.startsWith('CODIGO_') ? 'CODE' : 'TITLE');

/**
 * Advertencias de BIND (parsers de Title/Code) como incidencias. Se descartan las que ya no aportan nada:
 * - las que solo EXPLICAN un dato faltante (el dato faltante ya las representa, con el mismo campo);
 * - las que se refieren a campos que la familia elegida no tiene;
 * - las pendientes cuyos campos el usuario ya completó.
 * Las contradicciones Title/Code no caducan al editar: describen el producto de BIND y se reconocen expresamente.
 * FAMILIA_NO_CONFIRMADA se cubre con la propia selección de familia (chip y botón) y las explicaciones de procedencia con el chip y la nota del campo: no se repiten aquí.
 */
export function incidenciasDeBind(advertencias: readonly AdvertenciaBind[], valores: (key: FieldKey) => string, config: FamilyConfig | null): Incidencia[] {
  const visible = (key: FieldKey): boolean => config === null || config.campos.includes(key);
  const resultado: Incidencia[] = [];
  for (const a of advertencias) {
    if (a.codigo === 'FAMILIA_NO_CONFIRMADA' || EXPLICA_PROCEDENCIA.has(a.codigo)) continue;
    const campos = a.camposFormulario;
    if (a.explicaFaltante) continue;                                              // solo explica un dato vacío: el dato faltante (misma causa) y la nota del campo ya lo dicen
    if (a.nivel === 'PENDIENTE' && campos.length > 0 && campos.every((k) => valores(k).trim() !== '')) continue;
    if (campos.length > 0 && campos.every((k) => !visible(k)) && a.nivel !== 'CONTRADICCION') continue;
    resultado.push(crearIncidencia({ id: a.id, codigo: a.codigo, nivel: a.nivel, campos, seccion: campos.length > 0 ? seccionDeCampo(campos[0] as FieldKey) : a.seccion, mensaje: a.mensaje, origen: ORIGEN_DE_BIND(a.codigo) }));
  }
  return resultado;
}

/** Lista única para la pantalla: incidencias del formulario + coherencia del backend (solo la respuesta VIGENTE) + advertencias de BIND relevantes para la familia elegida. */
export function buildIncidencias(d: { locales: readonly Incidencia[]; backend: readonly Incidencia[]; advertencias: readonly AdvertenciaBind[]; valores: (key: FieldKey) => string; config: FamilyConfig | null }): Incidencia[] {
  return reunirIncidencias({ locales: d.locales, backend: d.backend, bind: incidenciasDeBind(d.advertencias, d.valores, d.config) });
}

/** Reúne las fuentes (en orden de prioridad de redacción: formulario, backend, BIND) y deja UNA incidencia por causa. La corroboración Title/Code es procedencia (chip), no incidencia. */
export function reunirIncidencias(fuentes: { locales: readonly Incidencia[]; backend: readonly Incidencia[]; bind: readonly Incidencia[] }): Incidencia[] {
  return consolidar([...fuentes.locales, ...fuentes.backend, ...fuentes.bind].filter((i) => i.codigo !== 'CORROBORADO'));
}

// ---------------------------------------------------------------- reconocimiento
/** Huella de los datos que originaron la incidencia: su causa, su redacción (que incluye los valores comparados) y el valor actual de cada campo afectado. */
export function huella(i: Incidencia, valores: (key: FieldKey) => string): string {
  return JSON.stringify([i.id, i.mensaje, i.campos.map((k) => valores(k))]);
}

export type Reconocimientos = Record<string, string>;

/** ¿El usuario reconoció expresamente ESTA incidencia con estos datos? Si cambian los datos que la originaron, la huella ya no coincide y vuelve a mostrarse. */
export const estaReconocida = (i: Incidencia, valores: (key: FieldKey) => string, reconocidas: Reconocimientos): boolean => i.reconocible && reconocidas[i.id] === huella(i, valores);

/** Impiden confirmar la revisión: los errores y las contradicciones no reconocidas. Los pendientes y las informativas no bloquean. */
export const bloquea = (i: Incidencia, valores: (key: FieldKey) => string, reconocidas: Reconocimientos): boolean => i.nivel === 'ERROR' || (i.nivel === 'CONTRADICCION' && !estaReconocida(i, valores, reconocidas));

/** `faltantes`: datos obligatorios por completar (subconjunto de ERROR que sigue bloqueando la finalización); los errores REALES son `ERROR - faltantes`. */
export function resumir(lista: readonly Incidencia[], valores: (key: FieldKey) => string, reconocidas: Reconocimientos): Record<NivelIncidencia, number> & { total: number; reconocidas: number; faltantes: number } {
  const cuenta = { ERROR: 0, CONTRADICCION: 0, PENDIENTE: 0, INFORMACION: 0, total: 0, reconocidas: 0, faltantes: 0 };
  for (const i of lista) {
    if (estaReconocida(i, valores, reconocidas)) { cuenta.reconocidas += 1; continue; }
    cuenta[i.nivel] += 1;
    if (i.codigo === 'FALTANTE') cuenta.faltantes += 1;
    cuenta.total += 1;
  }
  return cuenta;
}

// ---------------------------------------------------------------- ubicación
export type Ancla = { tipo: 'campo'; campo: FieldKey } | { tipo: 'seccion'; seccion: SeccionIncidencia };

/** Un solo campo visible → se muestra en el campo; varios campos o ninguno → en la sección. */
export function anclaDe(i: Incidencia, visible: (key: FieldKey) => boolean): Ancla {
  const [unico] = i.campos;
  return i.campos.length === 1 && unico !== undefined && visible(unico) ? { tipo: 'campo', campo: unico } : { tipo: 'seccion', seccion: i.seccion };
}
