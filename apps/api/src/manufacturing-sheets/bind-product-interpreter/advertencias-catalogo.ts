import type { FieldKey } from '../preview/family-registry';
import { idIncidencia, type NivelIncidencia } from '../preview/incidencias';
import type { Advertencia, AdvertenciaBase, CodigoAdvertencia } from './bind-product.types';

// Clasificación de las advertencias de los parsers (Title, Code y conciliación) con el modelo único de incidencias. Una sola tabla decide la severidad, la identidad (id)
// y si la advertencia solo EXPLICA un dato faltante (en cuyo caso el dato faltante ya la representa). Los parsers no conocen la severidad ni la interfaz.

interface Regla {
  nivel: NivelIncidencia;
  /** Identidad fija cuando la misma causa también la reporta la coherencia técnica o el formulario; si falta, se usa código + campos. */
  id?: string;
  explicaFaltante?: boolean;
  /** Sección cuando la advertencia no se refiere a un campo (por omisión, el panel de BIND). */
  seccion?: 'familia';
}

const REGLAS: Record<CodigoAdvertencia, Regla> = {
  TITULO_NO_INTERPRETABLE: { nivel: 'PENDIENTE' },
  TIPO_AMBIGUO: { nivel: 'PENDIENTE' },
  PRODUCTO_DE_PAPEL: { nivel: 'INFORMACION', seccion: 'familia' },
  RESINAS_CONTRADICTORIAS: { nivel: 'PENDIENTE' },
  RESINA_SIN_CASILLA: { nivel: 'PENDIENTE', id: 'RESINA_SIN_CASILLA:composicion' },
  MEDIDAS_INCOMPLETAS: { nivel: 'PENDIENTE', explicaFaltante: true },
  MEDIDAS_NO_ESTANDAR: { nivel: 'PENDIENTE' },
  MEDIDAS_MULTIPLES: { nivel: 'PENDIENTE' },
  MEDIDAS_TRES_DIMENSIONES_SUGERIDAS: { nivel: 'INFORMACION' },
  DATO_INFERIDO_DEL_CODIGO: { nivel: 'INFORMACION' },
  MATERIAL_PAPEL_SIN_PLANTILLA: { nivel: 'PENDIENTE', id: 'MATERIAL_PAPEL_SIN_PLANTILLA', seccion: 'familia' },
  UNIDAD_AUSENTE: { nivel: 'PENDIENTE', explicaFaltante: true },
  UNIDAD_CONTRADICTORIA: { nivel: 'CONTRADICCION' },
  UNIDAD_NO_SOPORTADA: { nivel: 'PENDIENTE' },
  CALIBRE_AUSENTE: { nivel: 'PENDIENTE', explicaFaltante: true },
  CALIBRE_AMBIGUO: { nivel: 'PENDIENTE' },
  // El calibre se conserva literal: que BIND no indique unidad NUNCA es una advertencia de conversión.
  CALIBRE_SIN_UNIDAD: { nivel: 'INFORMACION' },
  PRESENTACION_AUSENTE: { nivel: 'PENDIENTE', explicaFaltante: true },
  PRESENTACION_AMBIGUA: { nivel: 'PENDIENTE' },
  CANTIDAD_AUSENTE: { nivel: 'PENDIENTE', explicaFaltante: true },
  CANTIDAD_AMBIGUA: { nivel: 'PENDIENTE' },
  PESO_AUSENTE: { nivel: 'PENDIENTE', explicaFaltante: true },
  PESO_CERO: { nivel: 'PENDIENTE', explicaFaltante: true },
  PESO_INVALIDO: { nivel: 'PENDIENTE', explicaFaltante: true },
  CODIGO_NO_INTERPRETABLE: { nivel: 'INFORMACION' },
  // Title y Code contradicen la misma causa que también reporta la coherencia técnica (ids compartidos).
  CODIGO_RESINA_DISTINTA: { nivel: 'CONTRADICCION', id: 'TITLE_CODE:composicion' },
  CODIGO_MATERIAL_DISTINTO: { nivel: 'CONTRADICCION', id: 'TITLE_CODE:material' },
  FAMILIA_NO_CONFIRMADA: { nivel: 'PENDIENTE', id: 'FAMILIA_NO_CONFIRMADA', seccion: 'familia' }
};

// Nombres internos del interpretador → campos del formulario. Los demás (tipo, material, familia…) no tienen campo.
const CAMPO_FORMULARIO: Record<string, FieldKey> = {
  resina: 'composicion', codigoDcmx: 'codigo', unidadDimensiones: 'unidadDimensiones', ancho: 'ancho', largo: 'largo', calibre: 'calibre', presentacion: 'presentacion', cantidad: 'cantidad', pesoLb: 'pesoLb'
};

/** Clasifica las advertencias de los parsers y retira las redundantes (producto de papel cuando ya se informa el material de papel sin plantilla). Función pura. */
export function clasificarAdvertencias(advertencias: readonly AdvertenciaBase[]): Advertencia[] {
  const hayPlantillaPapel = advertencias.some((a) => a.codigo === 'MATERIAL_PAPEL_SIN_PLANTILLA');
  const vistas = new Set<string>();
  const resultado: Advertencia[] = [];
  for (const a of advertencias) {
    if (a.codigo === 'PRODUCTO_DE_PAPEL' && hayPlantillaPapel) continue;           // misma causa: el papel no tiene plantilla; el material lo explica mejor
    const regla = REGLAS[a.codigo];
    const camposFormulario = a.campos.map((c) => CAMPO_FORMULARIO[c]).filter((c): c is FieldKey => c !== undefined);
    const id = regla.id ?? idIncidencia(a.codigo, camposFormulario.length > 0 ? camposFormulario : a.campos);
    if (vistas.has(id)) continue;
    vistas.add(id);
    resultado.push({ ...a, id, nivel: regla.nivel, seccion: regla.seccion ?? 'bind', camposFormulario, explicaFaltante: regla.explicaFaltante === true });
  }
  return resultado;
}
