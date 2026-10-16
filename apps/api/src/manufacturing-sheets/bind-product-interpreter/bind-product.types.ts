/**
 * Tipos del interpretador de productos de BIND ERP para las Hojas de Instrucción de Manufactura.
 *
 * El interpretador es una función pura (sin red, sin base de datos): recibe los campos permitidos de un producto de BIND y devuelve datos estructurados que
 * distinguen valores EXTRAÍDOS directamente del título, valores SUGERIDOS (derivados, p. ej. del código o del tipo) y valores PENDIENTES de confirmación.
 * La familia de manufactura nunca se confirma aquí: la selecciona el usuario.
 */

/** Campos de BIND que el interpretador acepta. No se leen costos, inventarios ni precios: cualquier otro campo se ignora. */
export interface BindProductInput {
  /** Identificador único del producto en BIND. */
  ID: string | number;
  /** Código DCMX. */
  Code: string;
  /** Descripción comercial: de aquí se interpretan los datos técnicos. */
  Title: string;
  /** Información adicional (opcional). Se conserva, no se interpreta en esta fase. */
  Description?: string | null;
  /** Peso en libras, conforme a la convención de Daubert México. */
  Weight?: number | string | null;
  /** Fecha de alta en BIND. NO es la fecha de emisión de la hoja. */
  CreationDate?: string | Date | null;
}

export type Origen = 'EXTRAIDO' | 'SUGERIDO' | 'PENDIENTE';

export interface Campo<T> {
  /** Valor interpretado; null si no se pudo determinar. Un campo PENDIENTE puede conservar una lectura literal que requiere confirmación. */
  valor: T | null;
  origen: Origen;
  /** Fragmento del título (o del código) del que proviene; null si no hay. */
  fuente: string | null;
  nota?: string;
}

export type TipoProducto = 'BOLSA' | 'HOJA' | 'PAPEL';
export type Resina = 'PMG' | 'CP5000' | 'NAT' | 'ESD' | 'XOW';
export type UnidadDimension = 'IN' | 'MM' | 'CM';
export type Presentacion = 'ROLLO' | 'PAQUETE';

/** Calibre tal como aparece: el valor y la unidad originales, sin convertir (p. ej. «CAL. 200» no se transforma en «2 MIL»). */
export interface CalibreOriginal {
  valorOriginal: string;
  unidadOriginal: string | null;
  /** Texto del calibre exactamente como lo escribió BIND, sin el prefijo «CAL.» (p. ej. «200», «2 MIL», «2.7», «3 mil»). Es lo que se imprime en la hoja. */
  textoLiteral: string;
}

export interface CantidadPiezas {
  cantidad: number;
  unidad: 'BOLSAS' | 'HOJAS' | null;
}

export type CodigoAdvertencia =
  | 'TITULO_NO_INTERPRETABLE'
  | 'TIPO_AMBIGUO'
  | 'PRODUCTO_DE_PAPEL'
  | 'RESINAS_CONTRADICTORIAS'
  | 'RESINA_SIN_CASILLA'
  | 'MEDIDAS_INCOMPLETAS'
  | 'MEDIDAS_NO_ESTANDAR'
  | 'MEDIDAS_MULTIPLES'
  | 'MEDIDAS_TRES_DIMENSIONES_SUGERIDAS'
  | 'UNIDAD_AUSENTE'
  | 'UNIDAD_CONTRADICTORIA'
  | 'UNIDAD_NO_SOPORTADA'
  | 'CALIBRE_AUSENTE'
  | 'CALIBRE_AMBIGUO'
  | 'CALIBRE_SIN_UNIDAD'
  | 'PRESENTACION_AUSENTE'
  | 'PRESENTACION_AMBIGUA'
  | 'CANTIDAD_AUSENTE'
  | 'CANTIDAD_AMBIGUA'
  | 'PESO_AUSENTE'
  | 'PESO_CERO'
  | 'PESO_INVALIDO'
  | 'CODIGO_NO_INTERPRETABLE'
  | 'CODIGO_RESINA_DISTINTA'
  | 'CODIGO_MATERIAL_DISTINTO'
  | 'FAMILIA_NO_CONFIRMADA';

export interface Advertencia {
  codigo: CodigoAdvertencia;
  mensaje: string;
  campos: string[];
}

/** Interpretación AUXILIAR de Code: prefijo variable de cliente + F/P + resina + consecutivo (+ segmentos adicionales). No sobrescribe lo identificado en Title. */
export interface CodigoInterpretado {
  interpretable: boolean;
  prefijoCliente: string | null;
  /** F = Film, P = Paper. */
  material: 'FILM' | 'PAPER' | null;
  resina: Resina | null;
  consecutivo: string | null;
  segmentosAdicionales: string[];
}

export type FamiliaPosible = 'BOLSA_PLANA_1' | 'HOJA_PAQ' | 'BOLSA_FUELLE' | 'BOLSA_NATURAL' | 'ROLLO_CONTINUO' | 'TERMOENCOGIBLE' | 'COEX';

/** La familia permanece SIN CONFIRMAR hasta que el usuario la seleccione. Las posibles son solo una pista no vinculante de las familias de esta fase. */
export interface FamiliaManufactura {
  valor: null;
  estado: 'PENDIENTE_CONFIRMACION';
  posiblesEstaFase: FamiliaPosible[];
}

export interface ResultadoInterpretacion {
  producto: {
    id: string;
    code: string;
    title: string;
    informacionAdicional: string | null;
    /** Fecha de alta en BIND (ISO 8601). No es la fecha de emisión de la hoja. */
    fechaAltaBind: string | null;
  };
  campos: {
    codigoDcmx: Campo<string>;
    tipo: Campo<TipoProducto>;
    resina: Campo<Resina>;
    ancho: Campo<number>;
    largo: Campo<number>;
    /** Fuelle total y sus mitades (derecho e izquierdo): solo se sugieren con el patrón Ancho × Fuelle total × Largo de una bolsa; editables. */
    fuelleTotal: Campo<number>;
    fuelleDerecho: Campo<number>;
    fuelleIzquierdo: Campo<number>;
    unidadDimensiones: Campo<UnidadDimension>;
    calibre: Campo<CalibreOriginal>;
    presentacion: Campo<Presentacion>;
    cantidad: Campo<CantidadPiezas>;
    pesoLb: Campo<number>;
  };
  codigo: CodigoInterpretado;
  familia: FamiliaManufactura;
  /** Nombres de los campos que requieren confirmación del usuario. */
  pendientes: string[];
  advertencias: Advertencia[];
}
