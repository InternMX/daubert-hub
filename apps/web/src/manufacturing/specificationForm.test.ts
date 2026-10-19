import { describe, expect, it } from 'vitest';
import type { BindProductLookup } from '../services/bindProducts';
import { bolsaFuelle, bolsaNatural, casoB, coexAzul, coexSinColor, deepFreeze, familyConfigs, rolloContinuo, schfpmg001, termoencogible } from '../test/bindProductFixtures';
import {
  buildInitialForm, changedFields, colorText, configOf, confirmFamily, setCoexVariante, displayOrigin, incompatibleValues, isEdited, localIsoDate, restoreField, selectFamily, setColorConcentracion, setColorPreset,
  setComposition, setFieldValue, setFuelleTotal, computeVciPounds, suggestLayerWeights, confirmLayerWeights, toPreviewData, validateSpecification, type FamilyCode, type SpecificationForm
} from './specificationForm';

const HOY = '2026-10-16';
const cfg = (code: FamilyCode) => configOf(familyConfigs, code)!;
const build = (lookup: BindProductLookup) => buildInitialForm(lookup, familyConfigs, HOY);
const validar = (form: SpecificationForm, lookup?: BindProductLookup) => validateSpecification(form, familyConfigs, lookup);

/** Formulario técnicamente completo para la familia indicada (el cliente es opcional en la demostración). */
function listo(form: SpecificationForm, family: FamilyCode = 'BOLSA_PLANA_1'): SpecificationForm {
  let f = selectFamily(form, family, familyConfigs);
  if (family === 'HOJA_PAQ') f = setFieldValue(f, 'modalidad', 'EXTENDIDA');
  return f;
}
const conCliente = (f: SpecificationForm): SpecificationForm => setFieldValue(f, 'cliente', 'Schneider Electric', 'CATALOGO', 'client-1');
const withSuggestion = (lookup: BindProductLookup, patch: Partial<BindProductLookup['sugerencias']>): BindProductLookup => ({ ...lookup, sugerencias: { ...lookup.sugerencias, ...patch } });

describe('buildInitialForm · SCHFPMG001', () => {
  const lookup = deepFreeze(schfpmg001());
  const form = build(lookup);

  it('precarga lo recuperado de BIND con su procedencia', () => {
    const v = (k: keyof typeof form.fields) => [form.fields[k].value, displayOrigin(form.fields[k])];
    expect(v('codigo')).toEqual(['SCHFPMG001', 'BIND']);
    expect(v('descripcion')).toEqual(['BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 'BIND']);
    expect(v('composicion')).toEqual(['PMG', 'BIND']);
    expect(v('presentacion')).toEqual(['PAQUETE', 'BIND']);
    expect(v('cantidad')).toEqual(['200', 'BIND']);
    expect(v('ancho')).toEqual(['13', 'BIND']);
    expect(v('largo')).toEqual(['16', 'BIND']);
    expect(v('unidadDimensiones')).toEqual(['IN', 'BIND']);
    expect(v('calibre')).toEqual(['3 MIL', 'BIND']);
    expect(v('pesoLb')).toEqual(['0.0428', 'BIND']);
    expect(v('fuelleDerecho')).toEqual(['', 'SIN_DATO']);       // un producto sin fuelles no genera pendientes de fuelle
  });

  it('SCHFPMG001: sugiere Bolsa Plana 1 (provisional), PMG AL 3%, Daubert Azul al 2% y etiqueta desde el Title completo', () => {
    expect(form.family).toBe('BOLSA_PLANA_1');
    expect(form.familyOrigin).toBe('SUGERIDA');
    expect(form.familyNote).toMatch(/dos medidas/);
    expect(form.fields.resinaVci).toMatchObject({ value: 'PMG AL 3%' });
    expect(form.fields.colorPreset.value).toBe('DAUBERT_AZUL');
    expect(form.fields.colorHex.value).toBe('#538DD5');
    expect(form.fields.colorConcentracion.value).toBe('2');
    expect(form.fields.colorNombre.value).toBe('DAUBERT AZUL AL 2%');
    expect(form.fields.etiqueta.value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(displayOrigin(form.fields.etiqueta)).toBe('BIND');
  });

  it('la concentración del color es independiente de la resina VCI', () => {
    const sinConc = setColorConcentracion(form, '', cfg('BOLSA_PLANA_1'));
    expect(sinConc.fields.colorNombre.value).toBe('DAUBERT AZUL');
    expect(sinConc.fields.resinaVci.value).toBe('PMG AL 3%');
    expect(setFieldValue(form, 'resinaVci', 'PMG AL 4%').fields.colorConcentracion.value).toBe('2');
  });

  it('fecha: se sugiere la fecha local, es editable y no usa la CreationDate de BIND; cambiar otros campos no la reemplaza', () => {
    expect(form.fields.fechaEmision.value).toBe(HOY);
    expect(displayOrigin(form.fields.fechaEmision)).toBe('SUGERIDO');
    const editada = setFieldValue(form, 'fechaEmision', '2026-11-02');
    expect(displayOrigin(editada.fields.fechaEmision)).toBe('USUARIO');
    expect(selectFamily(setComposition(editada, 'CP5000'), 'HOJA_PAQ', familyConfigs).fields.fechaEmision.value).toBe('2026-11-02');
    expect(restoreField(editada, 'fechaEmision').fields.fechaEmision.value).toBe(HOY);
    expect(localIsoDate(new Date(2026, 9, 16, 23, 30))).toBe('2026-10-16');
  });

  it('corregir un valor lo marca como editado, conserva el valor de BIND y puede restaurarse', () => {
    const edited = setFieldValue(form, 'ancho', '14');
    expect(displayOrigin(edited.fields.ancho)).toBe('USUARIO');
    expect(edited.fields.ancho.base).toEqual({ value: '13', origin: 'BIND' });
    expect(changedFields(edited, cfg('BOLSA_PLANA_1'))).toEqual(['ancho']);
    expect(restoreField(edited, 'ancho').fields.ancho.value).toBe('13');
    expect(lookup.producto.Title).toContain('13 x 16');
  });

  it('el cliente del catálogo guarda su identificador; el texto libre no', () => {
    const catalogo = setFieldValue(form, 'cliente', 'Acme', 'CATALOGO', 'c-9');
    expect(catalogo.fields.cliente.ref).toBe('c-9');
    const libre = setFieldValue(catalogo, 'cliente', 'Acme SA', 'PROVISIONAL');
    expect(displayOrigin(libre.fields.cliente)).toBe('PROVISIONAL');
    expect(libre.fields.cliente.ref).toBeUndefined();
  });
});

describe('niveles de validación: borrador · datos técnicos · emisión futura', () => {
  it('cliente vacío: borrador previsualizable Y datos técnicos suficientes; no apto para emisión; el pendiente es claro', () => {
    const lookup = schfpmg001();
    const r = validar(build(lookup), lookup);
    expect(r.errors).toEqual({});
    expect(r).toMatchObject({ previewable: true, technicalReady: true, clientIdentified: false, emissionReady: false });
    expect(r.emissionPending.join(' ')).toMatch(/Cliente sin identificar: se permite en la demostración/);
    expect(r.pending.join(' ')).not.toMatch(/Cliente/);          // el cliente ya no es un pendiente técnico
    expect(r.errors).not.toHaveProperty('cliente');
  });

  it('la regla de cliente obligatorio NO se elimina: sin cliente del catálogo nunca es apto para emisión, aunque la familia esté confirmada', () => {
    const f = confirmFamily(build(schfpmg001()));
    expect(validar(f)).toMatchObject({ technicalReady: true, emissionReady: false });
    const libre = validar(setFieldValue(f, 'cliente', 'Schneider', 'PROVISIONAL'));
    expect(libre.emissionReady).toBe(false);
    expect(libre.emissionPending.join(' ')).toMatch(/texto libre/);
    expect(validar(setFieldValue(f, 'cliente', 'Schneider', 'CATALOGO')).emissionReady).toBe(false);       // sin referencia al registro
  });

  it('cliente del catálogo + familia confirmada + datos técnicos → apto para emisión futura (aún sin guardar)', () => {
    const r = validar(conCliente(confirmFamily(build(schfpmg001()))));
    expect(r).toMatchObject({ previewable: true, technicalReady: true, clientIdentified: true, emissionReady: true });
    expect(r.emissionPending).toEqual([]);
  });

  it('con cliente pero la familia solo sugerida: técnicos listos, no apto para emisión', () => {
    const r = validar(conCliente(build(schfpmg001())));
    expect(r).toMatchObject({ technicalReady: true, clientIdentified: true, emissionReady: false });
    expect(r.pending.join(' ')).toMatch(/Familia: Bolsa Plana 1 es una sugerencia/);
  });

  it('sin familia no es previsualizable ni técnicamente suficiente', () => {
    const lookup = withSuggestion(schfpmg001(), { familia: { valor: null, motivo: 'x', incompatibles: [] } });
    const f = build(lookup);
    expect(f.family).toBeNull();
    const r = validar(f);
    expect(r).toMatchObject({ previewable: false, technicalReady: false });
    expect(r.errors.familia).toMatch(/familia/i);
  });

  it.each([
    ['cantidad', '0'], ['cantidad', '1.5'], ['ancho', '-3'], ['largo', 'x'], ['calibre', '0'], ['pesoLb', 'abc'], ['colorHex', '538DD5'], ['fechaEmision', 'no-es-fecha']
  ] as const)('valor no válido en %s = %j: no hay datos técnicos suficientes', (key, value) => {
    const r = validar(setFieldValue(build(schfpmg001()), key, value));
    expect(r.technicalReady).toBe(false);
    expect(r.errors[key]).toBeDefined();
  });
});

describe('Bolsa Fuelle · tres medidas y fuelles derivados', () => {
  const lookup = deepFreeze(bolsaFuelle());
  const form = build(lookup);

  it('BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7 → Bolsa Fuelle sugerida con ancho 61, fuelle total 48 (24 + 24) y largo 70.9, cada uno con su procedencia', () => {
    expect(form.family).toBe('BOLSA_FUELLE');
    const v = (k: keyof typeof form.fields) => [form.fields[k].value, displayOrigin(form.fields[k])];
    expect(v('ancho')).toEqual(['61', 'SUGERIDO']);
    expect(v('fuelleTotal')).toEqual(['48', 'SUGERIDO']);
    expect(v('fuelleDerecho')).toEqual(['24', 'SUGERIDO']);
    expect(v('fuelleIzquierdo')).toEqual(['24', 'SUGERIDO']);
    expect(v('largo')).toEqual(['70.9', 'SUGERIDO']);
    expect(form.fields.fuelleDerecho.base.note).toMatch(/÷ 2/);
  });

  it('la unidad dimensional queda pendiente (el título no la dice) y el calibre 2.7 se conserva literal', () => {
    expect(displayOrigin(form.fields.unidadDimensiones)).toBe('PENDIENTE');
    expect(form.fields.unidadDimensiones.value).toBe('');
    expect(form.fields.calibre.value).toBe('2.7');
    expect(validar(form).errors.unidadDimensiones).toBeDefined();
  });

  it('los fuelles derivados son editables; cambiar el fuelle total recalcula solo los que no se editaron', () => {
    const f1 = setFieldValue(form, 'fuelleDerecho', '25');
    expect(displayOrigin(f1.fields.fuelleDerecho)).toBe('USUARIO');
    const f2 = setFuelleTotal(f1, '50');
    expect(f2.fields.fuelleDerecho.value).toBe('25');         // editado a mano: no se toca
    expect(f2.fields.fuelleIzquierdo.value).toBe('25');       // derivado: se recalcula (50 ÷ 2)
    expect(displayOrigin(f2.fields.fuelleIzquierdo)).toBe('SUGERIDO');
    expect(setFuelleTotal(form, '47').fields.fuelleDerecho.value).toBe('23.5');
    expect(setFuelleTotal(form, 'abc').fields.fuelleDerecho.value).toBe('24');            // un valor no numérico no destruye lo derivado
  });

  it('Bolsa Fuelle exige ambos fuelles y los envía a la vista previa; el fuelle total es auxiliar y no viaja', () => {
    const faltan = validar(setFieldValue(setFieldValue(form, 'fuelleDerecho', ''), 'fuelleIzquierdo', ''));
    expect(faltan.errors.fuelleDerecho).toBeDefined();
    expect(faltan.errors.fuelleIzquierdo).toBeDefined();
    const data = toPreviewData(form, cfg('BOLSA_FUELLE'));
    expect(data).toMatchObject({ ancho: '61', largo: '70.9', fuelleDerecho: '24', fuelleIzquierdo: '24', calibre: '2.7' });
    expect(data).not.toHaveProperty('fuelleTotal');
  });
});

describe('Bolsa Natural · composición fija y colores', () => {
  const form = build(bolsaNatural());

  it('Natural con fuelle → Bolsa Natural sugerida (pidiendo confirmar el tipo real) y sin formulación VCI automática', () => {
    expect(form.family).toBe('BOLSA_NATURAL');
    expect(form.familyNote).toMatch(/realmente una bolsa natural/);
    expect(form.fields.resinaVci.value).toBe('');                 // no se asigna una formulación VCI
    expect(displayOrigin(form.fields.resinaVci)).toBe('PENDIENTE');
  });

  it('sin color declarado por BIND se sugiere el color natural de la familia (no azul), tanto al sugerirla como al elegirla', () => {
    expect(form.fields.colorPreset.value).toBe('NATURAL');
    const f = selectFamily(build(withSuggestion(bolsaNatural(), { familia: { valor: null, motivo: 'x', incompatibles: [] } })), 'BOLSA_NATURAL', familyConfigs);
    expect(f.fields.colorPreset.value).toBe('NATURAL');
    expect(f.fields.colorHex.value).toBe('#FFF2CC');
    expect(f.fields.colorNombre.value).toBe('NATURAL');
    expect(displayOrigin(f.fields.colorPreset)).toBe('SUGERIDO');
  });

  it('la composición es fija: no se pide ni se valida, y se envía Natural aunque el formulario traiga otra', () => {
    const f = setComposition(selectFamily(form, 'BOLSA_NATURAL', familyConfigs), 'CP5000');
    expect(toPreviewData(f, cfg('BOLSA_NATURAL')).composicion).toBe('NAT');
    expect(validar(f).errors.composicion).toBeUndefined();
    expect(incompatibleValues(f, cfg('BOLSA_NATURAL')).join(' ')).toMatch(/composición fija/);
  });
});

describe('cambio de familia sin contaminación de datos', () => {
  it('los valores editados compatibles se conservan; los incompatibles no se envían ni se borran, y se avisan', () => {
    let f = build(bolsaFuelle());                          // Bolsa Fuelle sugerida
    f = setFieldValue(setFieldValue(f, 'calibre', '300'), 'descripcion', 'Descripción del usuario');
    f = setFieldValue(f, 'fuelleDerecho', '26');
    f = selectFamily(f, 'BOLSA_PLANA_1', familyConfigs);
    // compatibles: se conservan
    expect(f.fields.calibre.value).toBe('300');
    expect(f.fields.descripcion.value).toBe('Descripción del usuario');
    // incompatibles: no se envían…
    const datos = toPreviewData(f, cfg('BOLSA_PLANA_1'));
    expect(datos).not.toHaveProperty('fuelleDerecho');
    expect(datos).not.toHaveProperty('fuelleIzquierdo');
    expect(datos).toMatchObject({ calibre: '300', descripcion: 'Descripción del usuario' });
    // … pero tampoco se borran, y el usuario es informado
    expect(f.fields.fuelleDerecho.value).toBe('26');
    expect(incompatibleValues(f, cfg('BOLSA_PLANA_1')).join(' ')).toMatch(/Fuelle derecho \(26\) no aplica a Bolsa Plana 1/);
    // al volver, el dato sigue ahí
    expect(selectFamily(f, 'BOLSA_FUELLE', familyConfigs).fields.fuelleDerecho.value).toBe('26');
  });

  it('una modalidad capturada en Hojas no se arrastra a una familia sin modalidad', () => {
    let f = selectFamily(build(schfpmg001()), 'HOJA_PAQ', familyConfigs);
    f = setFieldValue(f, 'modalidad', 'DOBLADA');
    expect(toPreviewData(f, cfg('HOJA_PAQ')).modalidad).toBe('DOBLADA');
    const plana = selectFamily(f, 'BOLSA_PLANA_1', familyConfigs);
    expect(toPreviewData(plana, cfg('BOLSA_PLANA_1'))).not.toHaveProperty('modalidad');
    expect(plana.fields.modalidad.value).toBe('DOBLADA');
  });

  it('un color que la nueva familia no ofrece se avisa y bloquea los datos técnicos hasta elegir otro', () => {
    const natural = selectFamily(build(bolsaNatural()), 'BOLSA_NATURAL', familyConfigs);          // preset NATURAL
    const plana = selectFamily(natural, 'BOLSA_PLANA_1', familyConfigs);
    expect(plana.fields.colorPreset.value).toBe('NATURAL');        // no se borra
    const r = validar(plana);
    expect(r.errors.colorPreset).toMatch(/Elige un color disponible/);
    expect(r.warnings.join(' ')).toMatch(/NATURAL.*no está disponible/);
    expect(validar(setColorPreset(plana, 'DAUBERT_AZUL', cfg('BOLSA_PLANA_1'))).errors.colorPreset).toBeUndefined();
  });

  it('una composición CP5000 pasa a Bolsa Fuelle (la admite) pero al elegir una familia fija se ignora con aviso', () => {
    const f = setComposition(build(schfpmg001()), 'CP5000');
    expect(toPreviewData(selectFamily(f, 'BOLSA_FUELLE', familyConfigs), cfg('BOLSA_FUELLE')).composicion).toBe('CP5000');
    expect(toPreviewData(selectFamily(f, 'BOLSA_NATURAL', familyConfigs), cfg('BOLSA_NATURAL')).composicion).toBe('NAT');
  });
});

describe('calibre: valor literal de BIND', () => {
  const caso = (valorOriginal: string, unidadOriginal: string | null, textoLiteral: string): BindProductLookup => {
    const base = schfpmg001();
    return { ...base, interpretacion: { ...base.interpretacion, campos: { ...base.interpretacion.campos, calibre: { valor: { valorOriginal, unidadOriginal, textoLiteral }, origen: unidadOriginal ? 'EXTRAIDO' : 'PENDIENTE', fuente: 'CAL' } } } };
  };

  it.each([['200', null, '200'], ['250', null, '250'], ['300', null, '300'], ['2', 'MIL', '2 MIL'], ['2.7', null, '2.7'], ['3', 'MIL', '3 MIL']])(
    'CAL %s%s se precarga y se envía como «%s» sin convertir ni agregar unidad', (valor, unidad, esperado) => {
      const form = build(caso(valor, unidad, esperado));
      expect(form.fields.calibre.value).toBe(esperado);
      expect(displayOrigin(form.fields.calibre)).toBe('BIND');
      expect(toPreviewData(form, cfg('BOLSA_PLANA_1')).calibre).toBe(esperado);
      expect(validar(form).errors.calibre).toBeUndefined();
    });

  it('el caso B (CAL.200 sin unidad) conserva 200 y permite corrección manual con procedencia', () => {
    const form = build(casoB());
    expect(form.fields.calibre.value).toBe('200');
    expect(form.fields.calibre.base.note).toMatch(/sin MIL ni conversión/);
    const corregido = setFieldValue(form, 'calibre', '2 MIL');
    expect(displayOrigin(corregido.fields.calibre)).toBe('USUARIO');
    expect(restoreField(corregido, 'calibre').fields.calibre.value).toBe('200');
  });

  it('sin número o con cero no es válido; con unidad o sin ella sí', () => {
    const f = build(schfpmg001());
    for (const malo of ['', 'MIL', '0', '0 MIL']) expect(validar(setFieldValue(f, 'calibre', malo)).errors.calibre).toBeDefined();
    for (const bueno of ['200', '2.7', '2 MIL', '3 mil']) expect(validar(setFieldValue(f, 'calibre', bueno)).errors.calibre).toBeUndefined();
  });
});

describe('resina VCI sugerida', () => {
  it('PMG → PMG AL 3%; CP5000 → CP5000 AL 3%; Natural y otras no reciben formulación y quedan pendientes', () => {
    const form = build(schfpmg001());
    expect(setComposition(form, 'CP5000').fields.resinaVci.value).toBe('CP5000 AL 3%');
    const nat = setComposition(form, 'NAT');
    expect(nat.fields.resinaVci.value).toBe('');
    expect(displayOrigin(nat.fields.resinaVci)).toBe('PENDIENTE');
  });

  it('una resina editada por el usuario no se reemplaza, y el 3 % no es obligatorio', () => {
    const editada = setFieldValue(build(schfpmg001()), 'resinaVci', 'PMG AL 4%');
    expect(setComposition(editada, 'CP5000').fields.resinaVci.value).toBe('PMG AL 4%');
    expect(validar(setFieldValue(editada, 'resinaVci', '')).errors).not.toHaveProperty('resinaVci');
  });
});

describe('color unificado', () => {
  const base = build(schfpmg001());
  const plana = cfg('BOLSA_PLANA_1');

  it('un único estado alimenta el texto del documento y el hexadecimal del dibujo', () => {
    const verde = setColorPreset(base, 'VERDE', plana);
    expect(verde.fields.colorHex.value).toBe('#00B050');
    expect(verde.fields.colorNombre.value).toBe('VERDE');
    expect(verde.fields.colorConcentracion.value).toBe('');
    expect(setColorPreset(verde, 'DAUBERT_AZUL', plana).fields.colorHex.value).toBe('#538DD5');
    const data = toPreviewData(verde, plana);
    expect(data).toMatchObject({ colorNombre: 'VERDE', colorHex: '#00B050' });
    expect(data).not.toHaveProperty('colorPreset');
  });

  it('un texto de color editado a mano se conserva al cambiar la concentración o el preset', () => {
    const manual = setFieldValue(base, 'colorNombre', 'DAUBERT AZUL AL 2% UNIFORME');
    expect(setColorConcentracion(manual, '3', plana).fields.colorNombre.value).toBe('DAUBERT AZUL AL 2% UNIFORME');
    expect(setColorPreset(manual, 'VERDE', plana).fields.colorHex.value).toBe('#00B050');
  });

  it('Otro: exige nombre y #RRGGBB válidos', () => {
    const f = setColorPreset(base, 'OTRO', plana);
    expect(f.fields.colorNombre.value).toBe('');
    expect(validar(f).errors.colorNombre).toBeDefined();
    for (const hex of ['', '538DD5', '#GGGGGG', '#12345']) expect(validar(setFieldValue(setFieldValue(f, 'colorNombre', 'ROJO'), 'colorHex', hex)).errors.colorHex).toBeDefined();
    const valido = validar(setFieldValue(setFieldValue(f, 'colorNombre', 'ROJO'), 'colorHex', '#C00000'));
    expect(valido.errors.colorHex).toBeUndefined();
    expect(valido.technicalReady).toBe(true);
  });

  it('colorText arma «NOMBRE AL x%»; sin sugerencia de color (BIND indica otro) queda pendiente', () => {
    expect(colorText('DAUBERT_AZUL', '2', plana.colores)).toBe('DAUBERT AZUL AL 2%');
    expect(colorText('OTRO', '2', plana.colores)).toBe('');
    const lookup = withSuggestion(schfpmg001(), { color: { preset: null, concentracionPct: null, detectado: 'AMARILLO', regla: null, nota: 'BIND indica color AMARILLO.' } });
    const f = build(lookup);
    expect(f.fields.colorPreset.value).toBe('');
    expect(displayOrigin(f.fields.colorPreset)).toBe('PENDIENTE');
  });
});

describe('etiqueta', () => {
  it('se precarga con el Title completo y una etiqueta personalizada no se pierde al cambiar otros campos; se restaura al Title de BIND', () => {
    let f = build(schfpmg001());
    f = setFieldValue(f, 'etiqueta', 'MI ETIQUETA');
    f = setFieldValue(f, 'descripcion', 'Descripción corregida');
    f = selectFamily(setComposition(setColorPreset(setFieldValue(f, 'ancho', '14'), 'VERDE', cfg('BOLSA_PLANA_1')), 'CP5000'), 'HOJA_PAQ', familyConfigs);
    expect(f.fields.etiqueta.value).toBe('MI ETIQUETA');
    expect(toPreviewData(f, cfg('HOJA_PAQ')).etiqueta).toBe('MI ETIQUETA');
    const restaurada = restoreField(f, 'etiqueta');
    expect(restaurada.fields.etiqueta.value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(restaurada.fields.descripcion.value).toBe('Descripción corregida');
  });

  it('un título muy largo se conserva completo (sin truncar)', () => {
    const largo = `XE-H00024 - ${'BOLSA PMG '.repeat(40)}`.trim();
    const form = build(withSuggestion(schfpmg001(), { etiqueta: { valor: largo, regla: 'ETIQUETA_TITLE_BIND', nota: '' } }));
    expect(toPreviewData(form, cfg('BOLSA_PLANA_1')).etiqueta).toBe(largo);
  });
});

describe('Hojas', () => {
  it('exige la modalidad, admite Doblada y Extendida y advierte la familia incompatible con una bolsa', () => {
    const lookup = schfpmg001();
    const base = selectFamily(build(lookup), 'HOJA_PAQ', familyConfigs);
    expect(validar(base).errors.modalidad).toBeDefined();
    for (const m of ['DOBLADA', 'EXTENDIDA']) expect(validar(setFieldValue(base, 'modalidad', m)).errors.modalidad).toBeUndefined();
    expect(validar(listo(build(lookup), 'HOJA_PAQ'), lookup).warnings.join(' ')).toMatch(/Familia incompatible.*bolsa, no una hoja/);
  });
});

describe('borrador: datos enviados a la vista previa', () => {
  it('reflejan las correcciones del usuario sin modificar el producto original de BIND', () => {
    const original = deepFreeze(schfpmg001());
    let f = build(original);
    f = setFieldValue(setFieldValue(setFieldValue(f, 'ancho', '14'), 'calibre', '2 MIL'), 'cliente', 'Schneider Electric', 'CATALOGO', 'c1');
    f = setColorPreset(f, 'VERDE', cfg('BOLSA_PLANA_1'));
    expect(toPreviewData(f, cfg('BOLSA_PLANA_1'))).toMatchObject({ ancho: '14', calibre: '2 MIL', cliente: 'Schneider Electric', colorNombre: 'VERDE', colorHex: '#00B050', resinaVci: 'PMG AL 3%', fechaEmision: HOY, etiqueta: original.producto.Title });
    expect(original.interpretacion.campos.ancho.valor).toBe(13);
    expect(isEdited(f.fields.ancho)).toBe(true);
  });
});

describe('Rollo Continuo y Termoencogible · modalidades y cotas técnicas', () => {
  it('Rollo Continuo explícito: dos medidas, sin cantidad; el ancho del rollo es obligatorio, independiente y no se calcula', () => {
    const f = build(rolloContinuo());
    expect(f.family).toBe('ROLLO_CONTINUO');
    expect(f.fields.ancho.value).toBe('58');
    expect(f.fields.anchoRollo.value).toBe('');
    expect(displayOrigin(f.fields.anchoRollo)).toBe('SIN_DATO');
    const r = validar(f);
    expect(r.errors.anchoRollo).toBeDefined();
    expect(r.errors.cantidad).toBeUndefined();                      // el rollo continuo no tiene cantidad por rollo o paquete
    expect(r.errors.cantidadUnidad).toBeUndefined();
    expect(toPreviewData(setFieldValue(f, 'anchoRollo', '30'), cfg('ROLLO_CONTINUO'))).toMatchObject({ ancho: '58', anchoRollo: '30' });
    expect(toPreviewData(f, cfg('ROLLO_CONTINUO'))).not.toHaveProperty('cantidad');
  });

  it('Extendida NO está autorizada en Rollo Continuo ni en Termoencogible: no es una opción válida; Doblada sí', () => {
    for (const [lookup, code] of [[rolloContinuo(), 'ROLLO_CONTINUO'], [termoencogible(), 'TERMOENCOGIBLE']] as const) {
      const f = build(lookup);
      const config = cfg(code);
      expect(config.modalidades.find((m) => m.valor === 'EXTENDIDA')).toMatchObject({ habilitada: false });
      const extendida = setFieldValue(f, 'modalidad', 'EXTENDIDA');
      expect(validar(extendida).errors.modalidad).toMatch(/Extendida no está autorizada/);
      expect(validar(setFieldValue(f, 'modalidad', 'DOBLADA')).errors.modalidad).toBeUndefined();
      expect(toPreviewData(extendida, config).modalidad).toBe('EXTENDIDA');       // se envía tal cual: el backend es quien bloquea el documento
    }
  });

  it('Termoencogible: sin color de dibujo, color como texto y cuatro cotas técnicas obligatorias', () => {
    const f = build(termoencogible());
    expect(f.family).toBe('TERMOENCOGIBLE');
    const config = cfg('TERMOENCOGIBLE');
    expect(config.colorDibujo).toBe(false);
    const faltan = validar(f).errors;
    for (const k of ['anchoDoblado', 'medidaPliegue', 'largoPresentacionFinal', 'anchoPresentacionFinal', 'modalidad'] as const) expect(faltan[k], k).toBeDefined();
    expect(faltan.colorHex).toBeUndefined();
    expect(faltan.colorPreset).toBeUndefined();
    expect(toPreviewData(f, config)).not.toHaveProperty('colorHex');
    let g = f;
    for (const [k, v] of [['anchoDoblado', '1.60'], ['medidaPliegue', '0.70'], ['largoPresentacionFinal', '30'], ['anchoPresentacionFinal', '1.60'], ['modalidad', 'DOBLADA'], ['unidadDimensiones', 'M'], ['presentacion', 'ROLLO']] as const) g = setFieldValue(g, k, v);
    expect(validar(g).technicalReady).toBe(true);
    expect(validar(setFieldValue(g, 'medidaPliegue', '0')).errors.medidaPliegue).toBeDefined();
  });

  it('cambiar de Termoencogible a Rollo Continuo conserva las cotas capturadas pero no las envía', () => {
    let f = build(termoencogible());
    f = setFieldValue(setFieldValue(f, 'anchoDoblado', '1.60'), 'anchoRollo', '30');
    const rollo = selectFamily(f, 'ROLLO_CONTINUO', familyConfigs);
    expect(toPreviewData(rollo, cfg('ROLLO_CONTINUO'))).toMatchObject({ anchoRollo: '30' });
    expect(toPreviewData(rollo, cfg('ROLLO_CONTINUO'))).not.toHaveProperty('anchoDoblado');
    expect(rollo.fields.anchoDoblado.value).toBe('1.60');
    expect(incompatibleValues(rollo, cfg('ROLLO_CONTINUO')).join(' ')).toMatch(/Ancho doblado \(1\.60\) no aplica a Rollo Continuo/);
  });
});

describe('COEX · una familia con variante Azul/Verde y tres capas', () => {
  const config = cfg('COEX');

  it('COEX explícito: una sola familia, variante sugerida solo si el título declara el color, composición fija PMG y sin Resina VCI general', () => {
    const f = build(coexAzul());
    expect(f.family).toBe('COEX');
    expect(config.variantes.map((v) => v.valor)).toEqual(['AZUL', 'VERDE']);
    expect(familyConfigs.filter((c) => c.codigo.startsWith('COEX'))).toHaveLength(1);
    expect(f.fields.coexVariante).toMatchObject({ value: 'AZUL' });
    expect(displayOrigin(f.fields.coexVariante)).toBe('SUGERIDO');
    expect(config.campos).not.toContain('resinaVci');
    expect(config.composicionFija).toBe('PMG');
    expect(toPreviewData(f, config)).not.toHaveProperty('resinaVci');
    const sin = build(coexSinColor());
    expect(sin.fields.coexVariante.value).toBe('');
    expect(displayOrigin(sin.fields.coexVariante)).toBe('PENDIENTE');
    expect(validar(sin).errors.coexVariante).toBeDefined();
  });

  it('las capas tienen formulación fija; su peso y sus libras de VCI se sugieren (la exterior da 0.000000)', () => {
    const f = build(coexAzul());
    expect(config.capas?.map((c) => [c.id, c.resina])).toEqual([['interior', 'VCI PMG al 4%'], ['intermedia', 'VCI PMG al 2%'], ['exterior', 'SIN VCI']]);
    for (const k of ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior'] as const) {
      expect(f.fields[k].value).toBe('0.13097');
      expect(displayOrigin(f.fields[k])).toBe('CALCULADO');
      expect(validar(f).errors[k]).toBeUndefined();
    }
    for (const [k, v] of [['lbVciInterior', '0.005239'], ['lbVciIntermedia', '0.002619'], ['lbVciExterior', '0.000000']] as const) {
      expect(f.fields[k].value, k).toBe(v);
      expect(displayOrigin(f.fields[k]), k).toBe('CALCULADO');
      expect(validar(f).errors[k], k).toBeUndefined();
    }
    let g = f;
    for (const [k, v] of [['pesoCapaInterior', '0.13097'], ['pesoCapaIntermedia', '0.13097'], ['pesoCapaExterior', '0.13097'], ['lbVciInterior', '0.005239'], ['lbVciIntermedia', '0.002619']] as const) g = setFieldValue(g, k, v);
    expect(validar(g).technicalReady).toBe(true);
    expect(validar(setFieldValue(g, 'pesoCapaInterior', '0')).errors.pesoCapaInterior).toBeDefined();
    expect(validar(setFieldValue(g, 'lbVciIntermedia', 'x')).errors.lbVciIntermedia).toBeDefined();
    expect(toPreviewData(g, config)).toMatchObject({ coexVariante: 'AZUL', pesoCapaInterior: '0.13097', lbVciExterior: '0.000000', fuelleDerecho: '11.8', composicion: 'PMG' });
  });

  it('cambiar la variante actualiza el texto del color si no se editó a mano; solo existen las variantes aprobadas', () => {
    const f = build(coexAzul());
    const verde = setCoexVariante(f, 'VERDE', config);
    expect(verde.fields.coexVariante.value).toBe('VERDE');
    expect(verde.fields.colorNombre.value).toBe('VERDE');
    const manual = setFieldValue(f, 'colorNombre', 'AZUL ESPECIAL');
    expect(setCoexVariante(manual, 'VERDE', config).fields.colorNombre.value).toBe('AZUL ESPECIAL');
    expect(validar(setFieldValue(f, 'coexVariante', 'ROJO')).errors.coexVariante).toMatch(/no existen otras variantes aprobadas/);
  });

  it('al pasar de una familia con color Daubert Azul o Verde a COEX se sugiere la variante equivalente; un color personalizado no crea una tercera', () => {
    const azul = selectFamily(build(bolsaFuelle()), 'COEX', familyConfigs);
    expect(azul.fields.coexVariante).toMatchObject({ value: 'AZUL' });
    const verde = selectFamily(setColorPreset(build(bolsaFuelle()), 'VERDE', cfg('BOLSA_FUELLE')), 'COEX', familyConfigs);
    expect(verde.fields.coexVariante.value).toBe('VERDE');
    const otro = selectFamily(setFieldValue(setColorPreset(build(bolsaFuelle()), 'OTRO', cfg('BOLSA_FUELLE')), 'colorHex', '#C00000'), 'COEX', familyConfigs);
    expect(otro.fields.coexVariante.value).toBe('');
    expect(validar(otro).errors.coexVariante).toBeDefined();
  });
});

describe('Pesos COEX sugeridos y protegidos', () => {
  const keys = ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior'] as const;
  it.each([['0.3929', '0.13097'], ['0.7540', '0.25133'], ['3', '1.00000'], ['0,7540', '0.25133']])('total %s → %s por capa, solo Azul/Verde', (total, expected) => {
    for (const variant of ['AZUL', 'VERDE']) {
      const f = setFieldValue(setCoexVariante(build(coexAzul()), variant, cfg('COEX')), 'pesoLb', total);
      for (const k of keys) expect(f.fields[k]).toMatchObject({ value: expected, base: { origin: 'CALCULADO' } });
      expect(f.fields.lbVciInterior.value).toBe(computeVciPounds(expected, 4));
    }
  });
  it.each(['', '0', '-1', 'abc', 'Infinity', '1e3'])('total %s no deriva ni conserva sugerencias obsoletas', (total) => {
    const f = setFieldValue(build(coexAzul()), 'pesoLb', total);
    for (const k of keys) expect(f.fields[k].value).toBe('');
  });
  it('Weight ausente/cero/inválido no inventa capas al iniciar', () => {
    for (const weight of [null, 0, 'inválido']) {
      const lookup = coexAzul();
      lookup.producto.Weight = weight;
      lookup.interpretacion.campos.pesoLb = { valor: null, origen: 'PENDIENTE', fuente: null };
      const f = build(lookup);
      for (const k of keys) expect(f.fields[k].value).toBe('');
    }
  });
  it('no deriva sin variante autorizada ni en otra familia', () => {
    const noVariant = build(coexSinColor());
    expect(noVariant.fields.pesoCapaInterior.value).toBe('');
    expect(setCoexVariante(noVariant, 'AZUL', cfg('COEX')).fields.pesoCapaInterior.value).toBe('0.13097');
    const other = setFieldValue(selectFamily(build(coexAzul()), 'BOLSA_FUELLE', familyConfigs), 'pesoLb', '0.7540');
    expect(other.fields.pesoCapaInterior.value).toBe('0.13097'); // conservado, no se recalcula ni envía
    expect(toPreviewData(other, cfg('BOLSA_FUELLE'))).not.toHaveProperty('pesoCapaInterior');
  });
  it('edición manual, incluso igual al valor inicial, sobrevive a un cambio del total', () => {
    const f = setFieldValue(build(coexAzul()), 'pesoCapaInterior', '0.13097');
    const changed = setFieldValue(f, 'pesoLb', '0.7540');
    expect(displayOrigin(changed.fields.pesoCapaInterior)).toBe('USUARIO');
    expect(changed.fields.pesoCapaInterior.value).toBe('0.13097');
    expect(changed.fields.pesoCapaIntermedia.value).toBe('0.25133');
    expect(validar(changed).warnings.join(' ')).toMatch(/manuales o confirmados/);
    const restored = restoreField(changed, 'pesoCapaInterior');
    expect(restored.fields.pesoCapaInterior.value).toBe('0.25133');
    expect(displayOrigin(restored.fields.pesoCapaInterior)).toBe('CALCULADO');
  });
  it('pesos confirmados no se recalculan; reemplazo explícito conserva todas las libras de VCI', () => {
    let f = confirmLayerWeights(build(coexAzul()));
    f = setFieldValue(setFieldValue(f, 'lbVciInterior', '0.123456'), 'pesoLb', '0.7540');
    for (const k of keys) expect(f.fields[k].value).toBe('0.13097');
    const replaced = suggestLayerWeights(f, true);
    for (const k of keys) expect(replaced.fields[k]).toMatchObject({ value: '0.25133', base: { origin: 'CALCULADO' } });
    expect(replaced.fields.lbVciInterior.value).toBe('0.123456');
    expect(replaced.fields.lbVciExterior.value).toBe('0.000000');
  });
});

describe('Producto editable desde el registro central', () => {
  it.each([
    ['BOLSA_PLANA_1', 'Bolsa PLANA'], ['HOJA_PAQ', 'Bolsa PLANA'], ['BOLSA_FUELLE', 'Bolsa con Fuelle'], ['BOLSA_NATURAL', 'Bolsa con Fuelle'],
    ['ROLLO_CONTINUO', 'ROLLO VCI'], ['TERMOENCOGIBLE', 'ROLLO VCI + UV TERMOENCOGIBLE'], ['COEX', 'Bolsa con Fuelle - 20% de material reciclado']
  ] as const)('%s sugiere %s sin tocar Title/Description', (family, expected) => {
    const lookup = deepFreeze(schfpmg001());
    const f = selectFamily(build(lookup), family, familyConfigs);
    expect(f.fields.producto.value).toBe(expected);
    expect(displayOrigin(f.fields.producto)).toBe('SUGERIDO');
    expect(f.fields.descripcion.value).toBe(lookup.producto.Title);
    expect(lookup.producto.Description).toBeNull();
  });
  it('COEX explica que 20% es del machote; personalización (también igual al sugerido) no se pierde', () => {
    const f = build(coexAzul());
    expect(f.fields.producto.base.note).toMatch(/no es una característica universal/);
    const personalizado = setFieldValue(f, 'producto', 'Denominación particular');
    expect(selectFamily(personalizado, 'HOJA_PAQ', familyConfigs).fields.producto.value).toBe('Denominación particular');
    const manualIgual = setFieldValue(f, 'producto', f.fields.producto.value);
    expect(selectFamily(manualIgual, 'HOJA_PAQ', familyConfigs).fields.producto.value).toBe(f.fields.producto.value);
  });
  it('denominación específica de BIND se conserva al elegir familia incompatible', () => {
    const lookup = withSuggestion(schfpmg001(), { productoEspecifico: 'ROLLO VCI + UV TERMOENCOGIBLE' });
    const f = selectFamily(build(lookup), 'BOLSA_PLANA_1', familyConfigs);
    expect(f.fields.producto.value).toBe('ROLLO VCI + UV TERMOENCOGIBLE');
    expect(displayOrigin(f.fields.producto)).toBe('BIND');
  });
});

describe('Libras de VCI por capa COEX (peso de capa × % VCI ÷ 100)', () => {
  const pesos = ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior'] as const;
  const coexCon = (total: string, variant = 'AZUL') => setFieldValue(setCoexVariante(build(coexAzul()), variant, cfg('COEX')), 'pesoLb', total);

  it.each([
    ['AZUL', '0.3929', '0.13097', '0.005239', '0.002619'],
    ['VERDE', '0.7540', '0.25133', '0.010053', '0.005027']
  ])('ejemplo obligatorio COEX %s con total %s', (variant, total, peso, interior, intermedia) => {
    const f = coexCon(total, variant);
    for (const k of pesos) expect(f.fields[k].value).toBe(peso);
    expect(f.fields.lbVciInterior).toMatchObject({ value: interior, base: { origin: 'CALCULADO' } });
    expect(f.fields.lbVciIntermedia).toMatchObject({ value: intermedia, base: { origin: 'CALCULADO' } });
    expect(f.fields.lbVciExterior.value).toBe('0.000000');
    expect(validar(f).warnings.join(' ')).not.toMatch(/cálculo esperado/);
  });

  describe('precisión', () => {
    it.each([
      ['0.13097', 4, '0.005239'], ['0.13097', 2, '0.002619'], ['0.25133', 4, '0.010053'], ['0.25133', 2, '0.005027'], ['0.13097', 0, '0.000000'],
      ['0.1', 3, '0.003000'], ['0.29', 3, '0.008700'], ['1.00000', 4, '0.040000'], ['0,25133', 4, '0.010053'],
      ['0.00001', 4, '0.000000'], ['0.00001', 50, '0.000005'], ['0.00001', 60, '0.000006']    // half-up exacto sobre decimales
    ])('%s lb × %s%% = %s lb', (peso, pct, esperado) => expect(computeVciPounds(peso, pct)).toBe(esperado));
    it('redondea el peso a cinco decimales ANTES de calcular el VCI', () => {
      expect(computeVciPounds('0.130965', 4)).toBe('0.005239');       // 0.130965 → 0.13097
      expect(computeVciPounds('0.130964', 4)).toBe('0.005238');       // 0.130964 → 0.13096
      expect(computeVciPounds('0.1309649999', 4)).toBe('0.005238');
    });
    it('no arrastra errores de representación binaria', () => {
      // En coma flotante 1.005 × 100 = 100.49999999999999 y 0.07 × 100 = 7.000000000000001.
      expect(computeVciPounds('1.005', 50)).toBe('0.502500');
      expect(computeVciPounds('0.07', 50)).toBe('0.035000');
      expect(computeVciPounds('0.15', 3)).toBe('0.004500');
    });
  });

  describe('valores ausentes o inválidos', () => {
    it.each(['', ' ', '0', '0.000001', '-1', 'abc', '1e3', 'Infinity', 'NaN', '1..2'])('el peso «%s» no genera VCI', (peso) => expect(computeVciPounds(peso, 4)).toBeNull());
    it('sin peso total no hay peso por capa ni VCI, y un cálculo anterior se retira', () => {
      const f = coexCon('0.3929');
      expect(f.fields.lbVciInterior.value).toBe('0.005239');
      for (const total of ['', '0', 'abc']) {
        const g = setFieldValue(f, 'pesoLb', total);
        for (const k of ['lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'] as const) expect(g.fields[k].value, `${total}/${k}`).toBe('');
      }
    });
    it('no calcula sin variante autorizada ni cuando el peso de la capa es inválido', () => {
      const sinVariante = build(coexSinColor());
      for (const k of ['lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'] as const) expect(sinVariante.fields[k].value).toBe('');
      const roto = setFieldValue(coexCon('0.3929'), 'pesoCapaInterior', 'abc');
      expect(roto.fields.lbVciInterior.value).toBe('');
      expect(roto.fields.lbVciIntermedia.value).toBe('0.002619');
    });
  });

  describe('recálculo', () => {
    it('cambiar el peso total actualiza pesos y libras de VCI', () => {
      const f = setFieldValue(coexCon('0.3929'), 'pesoLb', '0.7540');
      expect(f.fields.lbVciInterior.value).toBe('0.010053');
      expect(f.fields.lbVciIntermedia.value).toBe('0.005027');
    });
    it('cambiar manualmente el peso de una capa recalcula solo las libras de esa capa', () => {
      const f = setFieldValue(coexCon('0.3929'), 'pesoCapaInterior', '0.2');
      expect(f.fields.lbVciInterior).toMatchObject({ value: '0.008000', base: { origin: 'CALCULADO' } });
      expect(f.fields.lbVciIntermedia.value).toBe('0.002619');
    });
    it('el VCI se calcula del peso que se muestra, redondeado a cinco decimales', () => {
      const f = setFieldValue(coexCon('0.3929'), 'pesoCapaInterior', '0.130969');
      expect(f.fields.pesoCapaInterior.value).toBe('0.130969');
      expect(f.fields.lbVciInterior.value).toBe('0.005239');
    });
    it('cambiar la variante conserva el cálculo (misma formulación en Azul y Verde)', () => {
      const f = setCoexVariante(coexCon('0.7540'), 'VERDE', cfg('COEX'));
      expect(f.fields.lbVciInterior.value).toBe('0.010053');
    });
  });

  describe('edición manual', () => {
    it('conserva el valor del usuario ante cambios del peso, avisa si no coincide y se puede restaurar', () => {
      let f = setFieldValue(coexCon('0.3929'), 'lbVciInterior', '0.006');
      expect(displayOrigin(f.fields.lbVciInterior)).toBe('USUARIO');
      expect(validar(f).warnings.join(' ')).toMatch(/Libras de VCI de la capa interior \(0\.006\) ya no coincide con el cálculo esperado \(0\.005239 lb/);
      f = setFieldValue(f, 'pesoLb', '0.7540');
      expect(f.fields.lbVciInterior.value).toBe('0.006');
      expect(f.fields.lbVciIntermedia.value).toBe('0.005027');                  // las demás capas siguen automáticas
      expect(validar(f).warnings.join(' ')).toMatch(/\(0\.006\).*\(0\.010053 lb/);
      const restaurado = restoreField(f, 'lbVciInterior');
      expect(restaurado.fields.lbVciInterior).toMatchObject({ value: '0.010053', base: { origin: 'CALCULADO' } });
      expect(displayOrigin(restaurado.fields.lbVciInterior)).toBe('CALCULADO');
      expect(validar(restaurado).warnings.join(' ')).not.toMatch(/cálculo esperado/);
    });
    it('un valor manual equivalente al cálculo no genera aviso (0.0052390 = 0.005239) y 0 manual en la exterior tampoco', () => {
      const f = setFieldValue(setFieldValue(coexCon('0.3929'), 'lbVciInterior', '0.0052390'), 'lbVciExterior', '0');
      expect(validar(f).warnings.join(' ')).not.toMatch(/cálculo esperado/);
    });
    it('un valor manual en la capa exterior distinto de cero avisa', () => {
      const f = setFieldValue(coexCon('0.3929'), 'lbVciExterior', '0.1');
      expect(validar(f).warnings.join(' ')).toMatch(/capa exterior \(0\.1\).*\(0\.000000 lb/);
    });
    it('el valor vacío escrito por el usuario no se sobrescribe al recalcular', () => {
      const f = setFieldValue(setFieldValue(coexCon('0.3929'), 'lbVciInterior', ''), 'pesoLb', '0.7540');
      expect(f.fields.lbVciInterior.value).toBe('');
      expect(validar(f).errors.lbVciInterior).toBeDefined();
    });
  });

  it('las libras calculadas viajan a la vista previa con seis decimales', () => {
    expect(toPreviewData(coexCon('0.3929'), cfg('COEX'))).toMatchObject({ lbVciInterior: '0.005239', lbVciIntermedia: '0.002619', lbVciExterior: '0.000000' });
  });
});
