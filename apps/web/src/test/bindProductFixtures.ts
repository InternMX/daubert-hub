import type { BindProductLookup, CampoInterpretado } from '../services/bindProducts';

// Respuestas de ejemplo del endpoint GET /api/manufacturing-sheets/bind-products/by-code/:code (formato idéntico al que devuelve NestJS).
const ext = <T,>(valor: T, fuente: string): CampoInterpretado<T> => ({ valor, origen: 'EXTRAIDO', fuente });
const pend = <T,>(nota: string, valor: T | null = null): CampoInterpretado<T> => ({ valor, origen: 'PENDIENTE', fuente: null, nota });

const FAMILIA_NO_CONFIRMADA = { codigo: 'FAMILIA_NO_CONFIRMADA', mensaje: 'La familia de manufactura no se determina automáticamente: la selecciona el usuario (una bolsa de dos dimensiones no es necesariamente Bolsa Plana 1).', campos: ['familia'] };

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
        unidadDimensiones: ext('IN', '13 x 16"'),
        calibre: ext({ valorOriginal: '3', unidadOriginal: 'MIL' }, 'CAL. 3 MIL'),
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
        calibre: pend('Unidad o escala del calibre pendiente de confirmación; no se convierte.', { valorOriginal: '200', unidadOriginal: null }),
        cantidad: ext({ cantidad: 100, unidad: 'BOLSAS' as const }, 'PAQUETE 100 BOLSAS'),
        pesoLb: pend('Sin peso en BIND.')
      },
      familia: { valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: ['BOLSA_PLANA_1'] },
      pendientes: ['unidadDimensiones', 'calibre', 'pesoLb'],
      advertencias
    },
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
