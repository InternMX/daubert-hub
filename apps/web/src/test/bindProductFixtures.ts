import type { BindProductLookup, CampoInterpretado } from '../services/bindProducts';
import type { FamilyConfig } from '../services/manufacturingFamilies';
import familyConfigJson from './familyConfig.fixture.json';

/** Copia de la configuración del registro del backend (se mantiene sincronizada con una prueba de la API). */
export const familyConfigs = familyConfigJson as unknown as FamilyConfig[];

// Respuestas de ejemplo del endpoint GET /api/manufacturing-sheets/bind-products/by-code/:code (formato idéntico al que devuelve NestJS).
const ext = <T,>(valor: T, fuente: string): CampoInterpretado<T> => ({ valor, origen: 'EXTRAIDO', fuente });
const pend = <T,>(nota: string, valor: T | null = null): CampoInterpretado<T> => ({ valor, origen: 'PENDIENTE', fuente: null, nota });

const sugerenciasBase = (titulo: string, resina: string | null, familia: 'BOLSA_PLANA_1' | 'HOJA_PAQ' | null, motivo: string): BindProductLookup['sugerencias'] => ({
  familia: { valor: familia, motivo, incompatibles: familia === 'BOLSA_PLANA_1' ? [{ familia: 'HOJA_PAQ', motivo: 'BIND describe una bolsa, no una hoja.' }] : [] },
  resinaVci: resina === 'PMG' ? { valor: 'PMG AL 3%', regla: 'RESINA_VCI_PMG_3PCT', nota: 'Sugerida para composición PMG; el 3 % es la concentración histórica más frecuente, no una obligación.' } : { valor: null, regla: null, nota: 'Sin regla confirmada para esta composición.' },
  resinaVciPorComposicion: { PMG: 'PMG AL 3%', CP5000: 'CP5000 AL 3%' },
  color: { preset: 'DAUBERT_AZUL', concentracionPct: '2', detectado: null, regla: 'COLOR_POR_DEFECTO_VCI_AZUL_2', nota: 'BIND no indica color: se sugiere Daubert Azul con 2 % de concentración de color.' },
  etiqueta: { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' }
});

const FAMILIA_NO_CONFIRMADA = { codigo: 'FAMILIA_NO_CONFIRMADA', mensaje: 'La familia de manufactura no se confirma automáticamente: la sugerida es provisional y la confirma el usuario (una bolsa de dos dimensiones no es necesariamente Bolsa Plana 1).', campos: ['familia'] };

export function schfpmg001(): BindProductLookup {
  return {
    origen: 'BIND',
    producto: { ID: 'bbe2cc0c-3498-47cb-a556-d435eba5c0b4', Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', Description: null, Weight: 0.0428, CreationDate: '2025-03-10T15:20:00Z' },
    interpretacion: {
      campos: {
        codigoDcmx: ext('SCHFPMG001', 'Code'),
        tipo: ext('BOLSA', 'BOLSA'),
        resina: ext('PMG', 'PMG'),
        ancho: ext(13, '13 x 16"'),
        largo: ext(16, '13 x 16"'),
        fuelleTotal: pend('Sin fuelles en el título.'),
        fuelleDerecho: pend('Sin fuelles en el título.'),
        fuelleIzquierdo: pend('Sin fuelles en el título.'),
        unidadDimensiones: ext('IN', '13 x 16"'),
        calibre: ext({ valorOriginal: '3', unidadOriginal: 'MIL', textoLiteral: '3 MIL' }, 'CAL. 3 MIL'),
        presentacion: ext('PAQUETE', 'PAQUETE'),
        cantidad: ext({ cantidad: 200, unidad: 'BOLSAS' as const }, 'C/200 BOLSAS'),
        pesoLb: ext(0.0428, '0.0428')
      },
      familia: { valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: ['BOLSA_PLANA_1'] },
      pendientes: [],
      advertencias: [FAMILIA_NO_CONFIRMADA]
    },
    datosSugeridosPlantilla: { codigo: 'SCHFPMG001', comp_pmg: 'X' },
    familiaSugerida: ['BOLSA_PLANA_1'],
    sugerencias: sugerenciasBase('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 'PMG', 'BOLSA_PLANA_1', 'Bolsa con dos medidas (ancho × largo) y sin indicios de fuelle ni de otra familia especial.'),
    pendientes: [],
    advertencias: [FAMILIA_NO_CONFIRMADA],
    especificacionConfirmada: false
  };
}

/** Caso B: sin unidad de medidas, calibre 200 sin unidad ni escala y sin peso. */
export function casoB(): BindProductLookup {
  const base = schfpmg001();
  const advertencias = [
    { codigo: 'UNIDAD_AUSENTE', mensaje: 'El título no indica la unidad de las dimensiones (pulgadas o milímetros): pendiente de confirmación.', campos: ['unidadDimensiones'] },
    { codigo: 'CALIBRE_SIN_UNIDAD', mensaje: 'Calibre «CAL.200» sin unidad: se conserva el valor original y la unidad/escala queda pendiente (no se convierte).', campos: ['calibre'] },
    { codigo: 'PESO_AUSENTE', mensaje: 'BIND no entrega el peso del producto.', campos: ['pesoLb'] },
    FAMILIA_NO_CONFIRMADA
  ];
  return {
    ...base,
    producto: { ID: '11111111-2222-3333-4444-555555555555', Code: 'PRUEBA58X43', Title: 'Bolsa PMG 58 X 43 Cal.200 Paquete 100 bolsas', Description: null, Weight: null, CreationDate: null },
    interpretacion: {
      campos: {
        ...base.interpretacion.campos,
        codigoDcmx: ext('PRUEBA58X43', 'Code'),
        ancho: ext(58, '58 X 43'),
        largo: ext(43, '58 X 43'),
        unidadDimensiones: pend('Sin unidad explícita en el título.'),
        calibre: pend('Unidad o escala del calibre pendiente de confirmación; no se convierte.', { valorOriginal: '200', unidadOriginal: null, textoLiteral: '200' }),
        cantidad: ext({ cantidad: 100, unidad: 'BOLSAS' as const }, 'PAQUETE 100 BOLSAS'),
        pesoLb: pend('Sin peso en BIND.')
      },
      familia: { valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: ['BOLSA_PLANA_1'] },
      pendientes: ['unidadDimensiones', 'calibre', 'pesoLb'],
      advertencias
    },
    sugerencias: sugerenciasBase('Bolsa PMG 58 X 43 Cal.200 Paquete 100 bolsas', 'PMG', 'BOLSA_PLANA_1', 'Bolsa con dos medidas (ancho × largo) y sin indicios de fuelle ni de otra familia especial.'),
    pendientes: ['unidadDimensiones', 'calibre', 'pesoLb'],
    advertencias
  };
}

/** Congela recursivamente un objeto para comprobar que el frontend nunca modifica los datos originales de BIND. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const sug = <T,>(valor: T, fuente: string, nota: string): CampoInterpretado<T> => ({ valor, origen: 'SUGERIDO', fuente, nota });
const PATRON = 'Patrón Ancho × Fuelle total × Largo supuesto por las tres medidas de una bolsa: confírmalo.';

/** Bolsa con tres medidas «BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7» (sin unidad): el backend sugiere ancho 61, fuelle total 48 (24 + 24) y largo 70.9. */
export function bolsaFuelle(): BindProductLookup {
  const base = schfpmg001();
  const titulo = 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7';
  return {
    ...base,
    producto: { ID: '22222222-3333-4444-5555-666666666666', Code: 'FUELLE61', Title: titulo, Description: null, Weight: 1.285, CreationDate: null },
    interpretacion: {
      ...base.interpretacion,
      campos: {
        ...base.interpretacion.campos,
        codigoDcmx: ext('FUELLE61', 'Code'),
        ancho: sug(61, '61 X 48 X 70.9', PATRON), largo: sug(70.9, '61 X 48 X 70.9', PATRON), fuelleTotal: sug(48, '61 X 48 X 70.9', PATRON),
        fuelleDerecho: sug(24, '61 X 48 X 70.9', 'Fuelle total ÷ 2 (derivado; editable).'), fuelleIzquierdo: sug(24, '61 X 48 X 70.9', 'Fuelle total ÷ 2 (derivado; editable).'),
        unidadDimensiones: pend('Sin unidad explícita en el título.'),
        calibre: pend('Unidad o escala del calibre pendiente de confirmación; no se convierte.', { valorOriginal: '2.7', unidadOriginal: null, textoLiteral: '2.7' }),
        presentacion: pend('Sin presentación en el título.'),
        cantidad: pend('Sin cantidad en el título.'),
        pesoLb: ext(1.285, '1.285')
      }
    },
    sugerencias: {
      ...base.sugerencias,
      familia: { valor: 'BOLSA_FUELLE', motivo: 'Bolsa con tres medidas: se sugiere Ancho × Fuelle total × Largo; confirma que tenga fuelles.', incompatibles: [{ familia: 'HOJA_PAQ', motivo: 'BIND describe una bolsa, no una hoja.' }, { familia: 'BOLSA_PLANA_1', motivo: 'El título indica fuelle o tres dimensiones: no corresponde a una bolsa plana de dos medidas.' }] },
      etiqueta: { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' }
    },
    familiaSugerida: ['BOLSA_FUELLE'],
    pendientes: ['unidadDimensiones', 'calibre', 'presentacion', 'cantidad']
  };
}

/** Bolsa de material natural con fuelles: el backend sugiere Bolsa Natural pidiendo confirmar el tipo real. */
export function bolsaNatural(): BindProductLookup {
  const base = bolsaFuelle();
  return {
    ...base,
    producto: { ...base.producto, Code: 'NAT61', Title: 'BOLSA LDPE NAT 61 X 48 X 70.9 CAL. 3 MIL' },
    interpretacion: { ...base.interpretacion, campos: { ...base.interpretacion.campos, resina: ext('NAT', 'NAT'), calibre: ext({ valorOriginal: '3', unidadOriginal: 'MIL', textoLiteral: '3 MIL' }, 'CAL. 3 MIL') } },
    sugerencias: {
      ...base.sugerencias,
      familia: { valor: 'BOLSA_NATURAL', motivo: 'Bolsa de material natural con fuelle (o tres medidas). Confirma que sea realmente una bolsa natural.', incompatibles: base.sugerencias.familia.incompatibles },
      resinaVci: { valor: null, regla: null, nota: 'Composición Natural: no se asigna una formulación VCI automáticamente.' },
      color: { preset: null, concentracionPct: null, detectado: null, regla: null, nota: 'Sin sugerencia de color: la resina no es PMG ni CP5000 o no se pudo determinar.' },
      etiqueta: { valor: 'BOLSA LDPE NAT 61 X 48 X 70.9 CAL. 3 MIL', regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' }
    },
    familiaSugerida: ['BOLSA_NATURAL']
  };
}

/** Rollo continuo explícito de dos medidas (ancho × largo): sin unidad en el título; el ancho del rollo lo captura el usuario. */
export function rolloContinuo(): BindProductLookup {
  const base = schfpmg001();
  const titulo = 'ROLLO CONTINUO VCI PMG 58 x 4500" CAL. 3 MIL';
  return {
    ...base,
    producto: { ID: '33333333-4444-5555-6666-777777777777', Code: 'ROLLO58', Title: titulo, Description: null, Weight: 8.25, CreationDate: null },
    interpretacion: {
      ...base.interpretacion,
      campos: { ...base.interpretacion.campos, codigoDcmx: ext('ROLLO58', 'Code'), tipo: pend('El título no indica si es Bolsa u Hoja.'), ancho: ext(58, '58 x 4500"'), largo: ext(4500, '58 x 4500"'), presentacion: pend('Sin presentación en el título.'), cantidad: pend('Sin cantidad en el título.'), pesoLb: ext(8.25, '8.25') }
    },
    sugerencias: {
      ...base.sugerencias,
      familia: { valor: 'ROLLO_CONTINUO', motivo: 'El título indica rollo continuo.', incompatibles: [{ familia: 'BOLSA_PLANA_1', motivo: 'El título indica rollo continuo.' }] },
      etiqueta: { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' }
    },
    familiaSugerida: ['ROLLO_CONTINUO']
  };
}

/** Termoencogible explícito: las cuatro cotas técnicas no vienen en el título. */
export function termoencogible(): BindProductLookup {
  const base = rolloContinuo();
  const titulo = 'ROLLO VCI + UV TERMOENCOGIBLE 6 X 30 MTS CAL. 8 MIL';
  return {
    ...base,
    producto: { ...base.producto, Code: 'TERMO6', Title: titulo, Weight: 45.2 },
    interpretacion: { ...base.interpretacion, campos: { ...base.interpretacion.campos, codigoDcmx: ext('TERMO6', 'Code'), ancho: ext(6, '6 X 30'), largo: ext(30, '6 X 30'), pesoLb: ext(45.2, '45.2'), calibre: ext({ valorOriginal: '8', unidadOriginal: 'MIL', textoLiteral: '8 MIL' }, 'CAL. 8 MIL') } },
    sugerencias: {
      ...base.sugerencias,
      familia: { valor: 'TERMOENCOGIBLE', motivo: 'El título indica material termoencogible.', incompatibles: [{ familia: 'BOLSA_PLANA_1', motivo: 'El título indica termoencogible.' }] },
      etiqueta: { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' }
    },
    familiaSugerida: ['TERMOENCOGIBLE']
  };
}

/** COEX explícito con color azul en el título: tres medidas (fuelles derivados) y variante sugerida. */
export function coexAzul(): BindProductLookup {
  const base = bolsaFuelle();
  const titulo = 'BOLSA COEX VCI PMG AZUL 51.2 X 23.6 X 31.5" CAL. 2.5 MIL ROLLO C/150 BOLSAS';
  return {
    ...base,
    producto: { ID: '44444444-5555-6666-7777-888888888888', Code: 'COEXAZUL', Title: titulo, Description: null, Weight: 0.3929, CreationDate: null },
    interpretacion: {
      ...base.interpretacion,
      campos: {
        ...base.interpretacion.campos,
        codigoDcmx: ext('COEXAZUL', 'Code'),
        ancho: sug(51.2, '51.2 X 23.6 X 31.5"', PATRON), largo: sug(31.5, '51.2 X 23.6 X 31.5"', PATRON), fuelleTotal: sug(23.6, '51.2 X 23.6 X 31.5"', PATRON),
        fuelleDerecho: sug(11.8, '51.2 X 23.6 X 31.5"', 'Fuelle total ÷ 2 (derivado; editable).'), fuelleIzquierdo: sug(11.8, '51.2 X 23.6 X 31.5"', 'Fuelle total ÷ 2 (derivado; editable).'),
        unidadDimensiones: ext('IN', '31.5"'), calibre: ext({ valorOriginal: '2.5', unidadOriginal: 'MIL', textoLiteral: '2.5 MIL' }, 'CAL. 2.5 MIL'),
        presentacion: ext('ROLLO', 'ROLLO'), cantidad: ext({ cantidad: 150, unidad: 'BOLSAS' as const }, 'C/150 BOLSAS'), pesoLb: ext(0.3929, '0.3929')
      }
    },
    sugerencias: {
      ...base.sugerencias,
      familia: { valor: 'COEX', motivo: 'El título indica coextrusión.', incompatibles: [{ familia: 'BOLSA_PLANA_1', motivo: 'El título indica coextrusión.' }] },
      coexVariante: { valor: 'AZUL', nota: 'El título indica color azul: se sugiere COEX Azul. Confírmalo.' },
      etiqueta: { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' }
    },
    familiaSugerida: ['COEX']
  };
}

/** COEX sin color declarado: la variante queda pendiente (no se asume una). */
export function coexSinColor(): BindProductLookup {
  const base = coexAzul();
  return { ...base, sugerencias: { ...base.sugerencias, coexVariante: { valor: null, nota: 'BIND no declara el color: elige la variante COEX (Azul o Verde).' } } };
}

/** Title sin resina: la composición PMG se INFIERE del código (procedencia CODE) y el material film también. */
export function resinaInferidaDeCode(): BindProductLookup {
  const base = schfpmg001();
  const resina: CampoInterpretado<'PMG' | 'CP5000' | 'NAT' | 'ESD' | 'XOW'> = { valor: 'PMG', origen: 'SUGERIDO', fuente: 'Code IMPFPMG012 (PMG)', procedencia: 'CODE', nota: 'Inferida de la clave PMG del código; el título no indica la resina.' };
  return {
    ...base,
    producto: { ...base.producto, Code: 'IMPFPMG012', Title: 'BOLSA VCI 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS' },
    interpretacion: {
      ...base.interpretacion,
      campos: {
        ...base.interpretacion.campos, resina,
        material: { valor: 'FILM', origen: 'SUGERIDO', fuente: 'Code IMPFPMG012 (F)', procedencia: 'CODE', nota: 'Inferido de la letra F (Film) del código.' },
        claveMaterial: { valor: 'PMG', origen: 'SUGERIDO', fuente: 'Code IMPFPMG012', procedencia: 'CODE' }
      },
      advertencias: [...base.interpretacion.advertencias, { codigo: 'DATO_INFERIDO_DEL_CODIGO', mensaje: 'La composición (PMG) se infirió de la clave PMG del código porque el título no indica la resina. Confírmala.', campos: ['resina'] }]
    },
    advertencias: [...base.advertencias, { codigo: 'DATO_INFERIDO_DEL_CODIGO', mensaje: 'La composición (PMG) se infirió de la clave PMG del código porque el título no indica la resina. Confírmala.', campos: ['resina'] }]
  };
}

/** Title y Code corroboran PMG. */
export function resinaCorroborada(): BindProductLookup {
  const base = schfpmg001();
  return { ...base, interpretacion: { ...base.interpretacion, campos: { ...base.interpretacion.campos, resina: { valor: 'PMG', origen: 'EXTRAIDO', fuente: 'PMG', procedencia: 'TITLE_Y_CODE', nota: 'Corroborada por el código (PMG).' } } } };
}

/** Title PMG frente a Code CP: se conserva el Title y se marca la contradicción. */
export function resinaContradictoria(): BindProductLookup {
  const base = schfpmg001();
  return {
    ...base,
    interpretacion: {
      ...base.interpretacion,
      campos: { ...base.interpretacion.campos, resina: { valor: 'PMG', origen: 'EXTRAIDO', fuente: 'PMG', procedencia: 'CONTRADICCION', nota: 'El título indica PMG y el código indica CP: se conserva el título.' } },
      advertencias: [...base.interpretacion.advertencias, { codigo: 'CODIGO_RESINA_DISTINTA', mensaje: 'El código sugiere la resina CP5000, pero el título indica PMG: se conserva el título.', campos: ['resina'] }]
    },
    advertencias: [...base.advertencias, { codigo: 'CODIGO_RESINA_DISTINTA', mensaje: 'El código sugiere la resina CP5000, pero el título indica PMG: se conserva el título.', campos: ['resina'] }]
  };
}

/** Producto de papel (TARPPW3301): válido en BIND, sin plantilla de papel en el prototipo. */
export function productoPapel(): BindProductLookup {
  const base = schfpmg001();
  return {
    ...base,
    producto: { ...base.producto, Code: 'TARPPW3301', Title: 'PW33 40 x 50" PAQUETE C/100' },
    interpretacion: {
      ...base.interpretacion,
      campos: {
        ...base.interpretacion.campos,
        resina: pend('El título no indica una resina reconocida.'),
        material: { valor: 'PAPEL', origen: 'SUGERIDO', fuente: 'Code TARPPW3301 (P)', procedencia: 'CODE', nota: 'Inferido de la letra P (Paper) del código.' },
        claveMaterial: { valor: 'PW33', origen: 'EXTRAIDO', fuente: 'PW33', procedencia: 'TITLE_Y_CODE', nota: 'Corroborada por el código.' }
      },
      advertencias: [{ codigo: 'MATERIAL_PAPEL_SIN_PLANTILLA', mensaje: 'Material papel (clave PW33): no hay una plantilla de papel disponible en este prototipo. El producto es válido en BIND; la familia queda pendiente y no se asigna ninguna plantilla plástica.', campos: ['tipo', 'material'] }]
    },
    advertencias: [{ codigo: 'MATERIAL_PAPEL_SIN_PLANTILLA', mensaje: 'Material papel (clave PW33): no hay una plantilla de papel disponible en este prototipo. El producto es válido en BIND; la familia queda pendiente y no se asigna ninguna plantilla plástica.', campos: ['tipo', 'material'] }],
    sugerencias: { ...base.sugerencias, familia: { valor: null, motivo: 'Producto de papel (clave PW33, inferida del código): no hay una plantilla de papel disponible en este prototipo.', incompatibles: [] } },
    familiaSugerida: []
  };
}
