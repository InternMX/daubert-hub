import { describe, expect, it } from 'vitest';
import type { BindProductLookup } from '../services/bindProducts';
import { casoB, deepFreeze, schfpmg001 } from '../test/bindProductFixtures';
import {
  buildInitialForm, changedFields, colorText, confirmFamily, displayOrigin, FAMILY_LABELS, isEdited, localIsoDate, restoreField, selectFamily, setColorConcentracion, setColorPreset, setComposition,
  setFieldValue, toPreviewData, validateSpecification, type SpecificationForm
} from './specificationForm';

const HOY = '2026-10-16';

/** Formulario con todo lo obligatorio resuelto: cliente del catálogo y familia confirmada por el usuario. */
function completo(form: SpecificationForm, family: 'BOLSA_PLANA_1' | 'HOJA_PAQ' = 'BOLSA_PLANA_1'): SpecificationForm {
  let f = selectFamily(form, family);
  f = setFieldValue(f, 'cliente', 'Schneider Electric', 'CATALOGO', 'client-1');
  if (family === 'HOJA_PAQ') f = setFieldValue(f, 'modalidad', 'EXTENDIDA');
  return f;
}

const withSuggestion = (lookup: BindProductLookup, patch: Partial<BindProductLookup['sugerencias']>): BindProductLookup => ({ ...lookup, sugerencias: { ...lookup.sugerencias, ...patch } });

describe('buildInitialForm · SCHFPMG001', () => {
  const lookup = deepFreeze(schfpmg001());
  const form = buildInitialForm(lookup, HOY);

  it('precarga lo recuperado de BIND con su procedencia', () => {
    const v = (k: keyof typeof form.fields) => [form.fields[k].value, displayOrigin(form.fields[k])];
    expect(v('codigo')).toEqual(['SCHFPMG001', 'BIND']);
    expect(v('descripcion')).toEqual(['BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 'BIND']);
    expect(v('composicion')).toEqual(['PMG', 'BIND']);
    expect(v('presentacion')).toEqual(['PAQUETE', 'BIND']);
    expect(v('cantidad')).toEqual(['200', 'BIND']);
    expect(v('cantidadUnidad')).toEqual(['BOLSAS', 'BIND']);
    expect(v('ancho')).toEqual(['13', 'BIND']);
    expect(v('largo')).toEqual(['16', 'BIND']);
    expect(v('unidadDimensiones')).toEqual(['IN', 'BIND']);
    expect(v('calibre')).toEqual(['3 MIL', 'BIND']);
    expect(v('pesoLb')).toEqual(['0.0428', 'BIND']);
  });

  it('SCHFPMG001: sugiere Bolsa Plana 1 (provisional), PMG AL 3%, Daubert Azul al 2% y etiqueta desde el Title completo', () => {
    expect(form.family).toBe('BOLSA_PLANA_1');
    expect(form.familyOrigin).toBe('SUGERIDA');
    expect(form.familyNote).toMatch(/dos medidas/);
    expect(form.fields.resinaVci).toMatchObject({ value: 'PMG AL 3%' });
    expect(displayOrigin(form.fields.resinaVci)).toBe('SUGERIDO');
    expect(form.fields.colorPreset.value).toBe('DAUBERT_AZUL');
    expect(form.fields.colorHex.value).toBe('#538DD5');
    expect(form.fields.colorConcentracion.value).toBe('2');
    expect(form.fields.colorNombre.value).toBe('DAUBERT AZUL AL 2%');
    expect(form.fields.etiqueta.value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(displayOrigin(form.fields.etiqueta)).toBe('BIND');
  });

  it('la concentración del color es independiente de la resina VCI', () => {
    expect(form.fields.colorConcentracion.value).toBe('2');
    expect(form.fields.resinaVci.value).toBe('PMG AL 3%');
    const sinConc = setColorConcentracion(form, '');
    expect(sinConc.fields.colorNombre.value).toBe('DAUBERT AZUL');
    expect(sinConc.fields.resinaVci.value).toBe('PMG AL 3%');                   // la resina no cambia
    expect(setFieldValue(form, 'resinaVci', 'PMG AL 4%').fields.colorConcentracion.value).toBe('2');   // ni al revés
  });

  it('fecha: se sugiere la fecha local, es editable y no usa la CreationDate de BIND', () => {
    expect(form.fields.fechaEmision.value).toBe(HOY);
    expect(displayOrigin(form.fields.fechaEmision)).toBe('SUGERIDO');
    expect(form.fields.fechaEmision.value).not.toBe(lookup.producto.CreationDate?.slice(0, 10));
    const editada = setFieldValue(form, 'fechaEmision', '2026-11-02');
    expect(displayOrigin(editada.fields.fechaEmision)).toBe('USUARIO');
    // Cambiar cualquier otro campo no reemplaza la fecha ya modificada.
    expect(setFieldValue(setComposition(editada, 'CP5000'), 'ancho', '20').fields.fechaEmision.value).toBe('2026-11-02');
    expect(restoreField(editada, 'fechaEmision').fields.fechaEmision.value).toBe(HOY);
  });

  it('localIsoDate usa la fecha LOCAL y no la UTC', () => {
    expect(localIsoDate(new Date(2026, 9, 16, 23, 30))).toBe('2026-10-16');
    expect(localIsoDate(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });

  it('los campos que BIND no entrega quedan para captura manual (no se inventan)', () => {
    for (const k of ['cliente', 'colorHex'] as const) if (k === 'cliente') { expect(form.fields[k].value).toBe(''); expect(displayOrigin(form.fields[k])).toBe('SIN_DATO'); }
  });

  it('corregir un valor lo marca como editado, conserva el valor de BIND y puede restaurarse', () => {
    const edited = setFieldValue(form, 'ancho', '14');
    expect(displayOrigin(edited.fields.ancho)).toBe('USUARIO');
    expect(edited.fields.ancho.base).toEqual({ value: '13', origin: 'BIND' });
    expect(changedFields(edited)).toEqual(['ancho']);
    const restored = restoreField(edited, 'ancho');
    expect(restored.fields.ancho.value).toBe('13');
    expect(isEdited(restored.fields.ancho)).toBe(false);
    expect(form.fields.ancho.value).toBe('13');
    expect(lookup.producto.Title).toContain('13 x 16');
  });

  it('el cliente del catálogo guarda su identificador; el texto libre no', () => {
    const catalogo = setFieldValue(form, 'cliente', 'Acme', 'CATALOGO', 'c-9');
    expect(displayOrigin(catalogo.fields.cliente)).toBe('CATALOGO');
    expect(catalogo.fields.cliente.ref).toBe('c-9');
    const libre = setFieldValue(catalogo, 'cliente', 'Acme SA', 'PROVISIONAL');
    expect(displayOrigin(libre.fields.cliente)).toBe('PROVISIONAL');
    expect(libre.fields.cliente.ref).toBeUndefined();
  });
});

describe('nombre visible de la familia', () => {
  it('HOJA_PAQ se muestra como «Hojas»; los identificadores internos no cambian', () => {
    expect(FAMILY_LABELS).toEqual({ BOLSA_PLANA_1: 'Bolsa Plana 1', HOJA_PAQ: 'Hojas' });
    expect(selectFamily(buildInitialForm(schfpmg001(), HOY), 'HOJA_PAQ').family).toBe('HOJA_PAQ');
  });
});

describe('familia sugerida', () => {
  it('sin sugerencia (información insuficiente o contradictoria) la selección queda pendiente con su motivo', () => {
    const lookup = withSuggestion(schfpmg001(), { familia: { valor: null, motivo: 'Hay indicios de fuelle u otra familia especial: no se sugiere Bolsa Plana 1.', incompatibles: [{ familia: 'BOLSA_PLANA_1', motivo: 'El título indica fuelle.' }] } });
    const form = buildInitialForm(lookup, HOY);
    expect(form.family).toBeNull();
    expect(form.familyOrigin).toBeNull();
    expect(form.familyNote).toMatch(/fuelle/);
    expect(validateSpecification(form, lookup).previewable).toBe(false);
  });

  it('elegir o confirmar la familia la vuelve decisión del usuario; la sugerida es provisional', () => {
    const form = buildInitialForm(schfpmg001(), HOY);
    expect(form.familyOrigin).toBe('SUGERIDA');
    expect(confirmFamily(form).familyOrigin).toBe('USUARIO');
    expect(selectFamily(form, 'HOJA_PAQ').familyOrigin).toBe('USUARIO');
    expect(selectFamily(form, null).familyOrigin).toBeNull();
  });

  it('una familia contradicha por los datos de BIND genera una advertencia', () => {
    const lookup = schfpmg001();
    const result = validateSpecification(completo(buildInitialForm(lookup, HOY), 'HOJA_PAQ'), lookup);
    expect(result.warnings.join(' ')).toMatch(/Familia incompatible.*bolsa, no una hoja/);
  });
});

describe('calibre: valor literal de BIND', () => {
  const caso = (titulo: string, valorOriginal: string, unidadOriginal: string | null, textoLiteral: string): BindProductLookup => {
    const base = schfpmg001();
    return { ...base, interpretacion: { ...base.interpretacion, campos: { ...base.interpretacion.campos, calibre: { valor: { valorOriginal, unidadOriginal, textoLiteral }, origen: unidadOriginal ? 'EXTRAIDO' : 'PENDIENTE', fuente: titulo } } } };
  };

  it.each([
    ['CAL. 200', '200', null, '200'],
    ['CAL. 250', '250', null, '250'],
    ['CAL. 300', '300', null, '300'],
    ['CAL. 2 MIL', '2', 'MIL', '2 MIL'],
    ['CAL. 2.7', '2.7', null, '2.7'],
    ['CAL. 3 MIL', '3', 'MIL', '3 MIL']
  ])('%s se precarga y se envía a la vista previa como «%s»… sin convertir ni agregar unidad', (titulo, valor, unidad, esperado) => {
    const form = buildInitialForm(caso(titulo, valor, unidad, esperado), HOY);
    expect(form.fields.calibre.value).toBe(esperado);
    expect(displayOrigin(form.fields.calibre)).toBe('BIND');
    expect(toPreviewData(form).calibre).toBe(esperado);
    const lookup = caso(titulo, valor, unidad, esperado);
    expect(validateSpecification(completo(form), lookup).errors.calibre).toBeUndefined();
  });

  it('el caso B (CAL.200 sin unidad) conserva 200, no exige unidad y mantiene la nota de BIND', () => {
    const form = buildInitialForm(casoB(), HOY);
    expect(form.fields.calibre.value).toBe('200');
    expect(form.fields.calibre.base.note).toMatch(/sin MIL ni conversión/);
    expect(Object.keys(form.fields)).not.toContain('calibreUnidad');
  });

  it('permite corrección manual y conserva la procedencia', () => {
    const form = setFieldValue(buildInitialForm(casoB(), HOY), 'calibre', '2 MIL');
    expect(displayOrigin(form.fields.calibre)).toBe('USUARIO');
    expect(form.fields.calibre.base).toMatchObject({ value: '200', origin: 'BIND' });
    expect(restoreField(form, 'calibre').fields.calibre.value).toBe('200');
  });

  it('sin número o con cero no es válido; con unidad o sin ella sí', () => {
    const f = completo(buildInitialForm(schfpmg001(), HOY));
    for (const malo of ['', 'MIL', '0', '0 MIL']) expect(validateSpecification(setFieldValue(f, 'calibre', malo)).errors.calibre).toBeDefined();
    for (const bueno of ['200', '2.7', '2 MIL', '3 mil']) expect(validateSpecification(setFieldValue(f, 'calibre', bueno)).errors.calibre).toBeUndefined();
  });
});

describe('resina VCI sugerida', () => {
  it('PMG → PMG AL 3%; CP5000 → CP5000 AL 3%; Natural y otras no reciben formulación y quedan pendientes', () => {
    const form = buildInitialForm(schfpmg001(), HOY);
    const cp = setComposition(form, 'CP5000');
    expect(cp.fields.resinaVci.value).toBe('CP5000 AL 3%');
    expect(displayOrigin(cp.fields.resinaVci)).toBe('SUGERIDO');
    const nat = setComposition(form, 'NAT');
    expect(nat.fields.resinaVci.value).toBe('');
    expect(displayOrigin(nat.fields.resinaVci)).toBe('PENDIENTE');
    expect(nat.fields.resinaVci.base.note).toMatch(/Natural/);
  });

  it('una resina editada por el usuario no se reemplaza al cambiar la composición, y el 3 % no es obligatorio', () => {
    const editada = setFieldValue(buildInitialForm(schfpmg001(), HOY), 'resinaVci', 'PMG AL 4%');
    expect(displayOrigin(editada.fields.resinaVci)).toBe('USUARIO');
    expect(setComposition(editada, 'CP5000').fields.resinaVci.value).toBe('PMG AL 4%');
    expect(validateSpecification(completo(editada)).errors.resinaVci).toBeUndefined();
    expect(validateSpecification(completo(setFieldValue(editada, 'resinaVci', ''))).errors.resinaVci).toBeUndefined();   // opcional
  });
});

describe('color unificado', () => {
  const base = buildInitialForm(schfpmg001(), HOY);

  it('un único estado alimenta el texto del documento y el hexadecimal del dibujo', () => {
    const verde = setColorPreset(base, 'VERDE');
    expect(verde.fields.colorHex.value).toBe('#00B050');
    expect(verde.fields.colorNombre.value).toBe('VERDE');
    expect(verde.fields.colorConcentracion.value).toBe('');                    // el 2 % sugerido era del azul
    const azul = setColorPreset(verde, 'DAUBERT_AZUL');
    expect(azul.fields.colorHex.value).toBe('#538DD5');
    expect(azul.fields.colorNombre.value).toBe('DAUBERT AZUL');
    const data = toPreviewData(verde);
    expect(data).toMatchObject({ colorNombre: 'VERDE', colorHex: '#00B050' });
    expect(data).not.toHaveProperty('colorPreset');
  });

  it('un texto de color editado a mano se conserva al cambiar la concentración o el preset', () => {
    const manual = setFieldValue(base, 'colorNombre', 'DAUBERT AZUL AL 2% UNIFORME');
    expect(displayOrigin(manual.fields.colorNombre)).toBe('USUARIO');
    expect(setColorConcentracion(manual, '3').fields.colorNombre.value).toBe('DAUBERT AZUL AL 2% UNIFORME');
    expect(setColorPreset(manual, 'VERDE').fields.colorNombre.value).toBe('DAUBERT AZUL AL 2% UNIFORME');
    expect(setColorPreset(manual, 'VERDE').fields.colorHex.value).toBe('#00B050');   // el dibujo sí sigue al preset
  });

  it('Otro: exige nombre y #RRGGBB válidos; con ambos válidos la especificación puede completarse', () => {
    const f = completo(setColorPreset(base, 'OTRO'));
    expect(f.fields.colorNombre.value).toBe('');
    const sinNombre = validateSpecification(f);
    expect(sinNombre.complete).toBe(false);
    expect(sinNombre.errors.colorNombre).toBeDefined();
    for (const hex of ['', '538DD5', '#GGGGGG', '#12345']) expect(validateSpecification(setFieldValue(setFieldValue(f, 'colorNombre', 'ROJO'), 'colorHex', hex)).errors.colorHex).toBeDefined();
    const valido = validateSpecification(setFieldValue(setFieldValue(f, 'colorNombre', 'ROJO'), 'colorHex', '#C00000'));
    expect(valido.errors.colorNombre).toBeUndefined();
    expect(valido.errors.colorHex).toBeUndefined();
    expect(valido.complete).toBe(true);
  });

  it('sin color elegido no está completa; colorText arma «NOMBRE AL x%»', () => {
    expect(validateSpecification(setColorPreset(completo(base), '')).errors.colorPreset).toBeDefined();
    expect(colorText('DAUBERT_AZUL', '2')).toBe('DAUBERT AZUL AL 2%');
    expect(colorText('VERDE', '')).toBe('VERDE');
    expect(colorText('OTRO', '2')).toBe('');
  });

  it('la concentración fuera de rango o no numérica es un error', () => {
    for (const mala of ['abc', '0', '101', '-1']) expect(validateSpecification(setFieldValue(completo(base), 'colorConcentracion', mala)).errors.colorConcentracion).toBeDefined();
  });

  it('sin sugerencia de color (BIND indica otro color) el color queda pendiente', () => {
    const lookup = withSuggestion(schfpmg001(), { color: { preset: null, concentracionPct: null, detectado: 'AMARILLO', regla: null, nota: 'BIND indica color AMARILLO: elige «Otro».' } });
    const form = buildInitialForm(lookup, HOY);
    expect(form.fields.colorPreset.value).toBe('');
    expect(displayOrigin(form.fields.colorPreset)).toBe('PENDIENTE');
    expect(form.fields.colorHex.value).toBe('');
  });
});

describe('etiqueta', () => {
  it('se precarga con el Title completo (incluye números de ítem) y se edita sin depender de la descripción', () => {
    const lookup = withSuggestion(schfpmg001(), { etiqueta: { valor: 'A 15M3M6 - BOLSA VCI CP5000 90 x 70 x 118" PAQUETE C/10', regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND.' } });
    const form = buildInitialForm(lookup, HOY);
    expect(form.fields.etiqueta.value).toBe('A 15M3M6 - BOLSA VCI CP5000 90 x 70 x 118" PAQUETE C/10');
  });

  it('una etiqueta personalizada no se pierde al cambiar la descripción ni otros campos, y se restaura al Title de BIND', () => {
    let f = buildInitialForm(schfpmg001(), HOY);
    f = setFieldValue(f, 'etiqueta', 'MI ETIQUETA PERSONALIZADA');
    f = setFieldValue(f, 'descripcion', 'Descripción corregida');
    f = setComposition(setColorPreset(setFieldValue(f, 'ancho', '14'), 'VERDE'), 'CP5000');
    expect(f.fields.etiqueta.value).toBe('MI ETIQUETA PERSONALIZADA');
    expect(displayOrigin(f.fields.etiqueta)).toBe('USUARIO');
    expect(toPreviewData(f).etiqueta).toBe('MI ETIQUETA PERSONALIZADA');
    const restaurada = restoreField(f, 'etiqueta');
    expect(restaurada.fields.etiqueta.value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(restaurada.fields.descripcion.value).toBe('Descripción corregida');          // restaurar la etiqueta no toca la descripción
  });

  it('un título muy largo se conserva completo (sin truncar)', () => {
    const largo = `XE-H00024 - ${'BOLSA PMG '.repeat(40)}`.trim();
    const lookup = withSuggestion(schfpmg001(), { etiqueta: { valor: largo, regla: 'ETIQUETA_TITLE_BIND', nota: '' } });
    const form = buildInitialForm(lookup, HOY);
    expect(form.fields.etiqueta.value).toBe(largo);
    expect(toPreviewData(form).etiqueta).toBe(largo);
  });
});

describe('buildInitialForm · caso B (pendientes)', () => {
  const form = buildInitialForm(deepFreeze(casoB()), HOY);

  it('marca como pendientes la unidad de medidas y el peso, y conserva el calibre 200 sin convertirlo', () => {
    expect(displayOrigin(form.fields.unidadDimensiones)).toBe('PENDIENTE');
    expect(form.fields.unidadDimensiones.value).toBe('');
    expect(form.fields.calibre.value).toBe('200');
    expect(displayOrigin(form.fields.pesoLb)).toBe('PENDIENTE');
    expect(form.fields.pesoLb.value).toBe('');
  });
});

describe('validateSpecification · niveles de estado', () => {
  it('SCHFPMG001 con cliente del catálogo y familia confirmada queda completa Y confirmada', () => {
    const lookup = schfpmg001();
    const result = validateSpecification(completo(buildInitialForm(lookup, HOY)), lookup);
    expect(result.errors).toEqual({});
    expect(result).toMatchObject({ previewable: true, complete: true, confirmed: true });
  });

  it('cliente ausente: borrador previsualizable pero NUNCA completa, con un pendiente claro', () => {
    const form = buildInitialForm(schfpmg001(), HOY);          // familia sugerida, sin cliente
    const result = validateSpecification(form);
    expect(result.previewable).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.errors.cliente).toBeDefined();
    expect(result.pending.join(' ')).toMatch(/Cliente: selecciona un cliente del catálogo/);
  });

  it('cliente seleccionado del catálogo resuelve ese pendiente; el texto libre no', () => {
    const form = buildInitialForm(schfpmg001(), HOY);
    const libre = validateSpecification(setFieldValue(form, 'cliente', 'Schneider', 'PROVISIONAL'));
    expect(libre.errors.cliente).toMatch(/catálogo/);
    expect(libre.complete).toBe(false);
    const sinId = validateSpecification(setFieldValue(form, 'cliente', 'Schneider', 'CATALOGO'));      // sin referencia al registro
    expect(sinId.errors.cliente).toBeDefined();
    const catalogo = validateSpecification(setFieldValue(form, 'cliente', 'Schneider Electric', 'CATALOGO', 'client-1'));
    expect(catalogo.errors.cliente).toBeUndefined();
    expect(catalogo.complete).toBe(true);
    expect(catalogo.confirmed).toBe(false);                    // la familia sigue siendo solo una sugerencia
    expect(catalogo.pending.join(' ')).toMatch(/Familia: Bolsa Plana 1 es una sugerencia/);
  });

  it('sin familia no es previsualizable ni completa', () => {
    const lookup = withSuggestion(schfpmg001(), { familia: { valor: null, motivo: 'x', incompatibles: [] } });
    const result = validateSpecification(buildInitialForm(lookup, HOY));
    expect(result.previewable).toBe(false);
    expect(result.errors.familia).toMatch(/familia/i);
  });

  it('Hojas exige la modalidad; Bolsa Plana 1 no', () => {
    const base = setFieldValue(buildInitialForm(schfpmg001(), HOY), 'cliente', 'Acme', 'CATALOGO', 'c1');
    expect(validateSpecification(selectFamily(base, 'HOJA_PAQ')).errors.modalidad).toBeDefined();
    expect(validateSpecification(selectFamily(base, 'BOLSA_PLANA_1')).errors.modalidad).toBeUndefined();
    expect(validateSpecification(setFieldValue(selectFamily(base, 'HOJA_PAQ'), 'modalidad', 'DOBLADA')).complete).toBe(true);
  });

  it('el caso B no se completa hasta que el usuario confirma unidad y peso (el calibre 200 ya es válido)', () => {
    const lookup = casoB();
    let f = completo(buildInitialForm(lookup, HOY));
    expect(Object.keys(validateSpecification(f, lookup).errors).sort()).toEqual(['pesoLb', 'unidadDimensiones']);
    f = setFieldValue(setFieldValue(f, 'unidadDimensiones', 'IN'), 'pesoLb', '0.1');
    expect(validateSpecification(f, lookup).complete).toBe(true);
  });

  it.each([
    ['cantidad', '0'], ['cantidad', '1.5'], ['cantidad', 'abc'], ['ancho', '-3'], ['ancho', '0'], ['largo', 'x'], ['calibre', '0'], ['pesoLb', '0'], ['pesoLb', 'abc'], ['colorHex', '538DD5'], ['colorHex', '#GGGGGG'], ['fechaEmision', 'no-es-fecha']
  ] as const)('valor no válido en %s = %j', (key, value) => {
    const f = setFieldValue(completo(buildInitialForm(schfpmg001(), HOY)), key, value);
    const result = validateSpecification(f);
    expect(result.complete).toBe(false);
    expect(result.errors[key]).toBeDefined();
  });
});

describe('borrador: datos enviados a la vista previa', () => {
  it('reflejan las correcciones del usuario sin modificar el producto original de BIND', () => {
    const original = deepFreeze(schfpmg001());
    let f = buildInitialForm(original, HOY);
    f = setFieldValue(setFieldValue(setFieldValue(f, 'ancho', '14'), 'calibre', '2 MIL'), 'cliente', 'Schneider Electric', 'CATALOGO', 'c1');
    f = setColorPreset(f, 'VERDE');
    const data = toPreviewData(f);
    expect(data).toMatchObject({ ancho: '14', calibre: '2 MIL', cliente: 'Schneider Electric', colorNombre: 'VERDE', colorHex: '#00B050', resinaVci: 'PMG AL 3%', fechaEmision: HOY, etiqueta: original.producto.Title });
    expect(original.interpretacion.campos.ancho.valor).toBe(13);
    expect(original.producto.Title).toContain('CAL. 3 MIL');
  });
});
