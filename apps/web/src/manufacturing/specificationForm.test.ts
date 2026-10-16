import { describe, expect, it } from 'vitest';
import { casoB, deepFreeze, schfpmg001 } from '../test/bindProductFixtures';
import { buildInitialForm, changedFields, displayOrigin, isEdited, restoreField, selectFamily, setFieldValue, validateSpecification, type SpecificationForm } from './specificationForm';

function completo(form: SpecificationForm, family: 'BOLSA_PLANA_1' | 'HOJA_PAQ' = 'BOLSA_PLANA_1'): SpecificationForm {
  let f = selectFamily(form, family);
  f = setFieldValue(f, 'colorHex', '#538DD5');
  if (family === 'HOJA_PAQ') f = setFieldValue(f, 'modalidad', 'EXTENDIDA');
  return f;
}

describe('buildInitialForm · SCHFPMG001', () => {
  const lookup = deepFreeze(schfpmg001());
  const form = buildInitialForm(lookup);

  it('precarga lo recuperado de BIND con su procedencia y deja la familia sin elegir', () => {
    expect(form.family).toBeNull();
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
    expect(v('calibreValor')).toEqual(['3', 'BIND']);
    expect(v('calibreUnidad')).toEqual(['MIL', 'BIND']);
    expect(v('pesoLb')).toEqual(['0.0428', 'BIND']);
  });

  it('los campos que BIND no entrega quedan para captura manual (no se inventan)', () => {
    for (const k of ['cliente', 'fechaEmision', 'resinaVci', 'colorNombre', 'colorHex', 'etiqueta'] as const) {
      expect(form.fields[k].value).toBe('');
      expect(displayOrigin(form.fields[k])).toBe('SIN_DATO');
    }
  });

  it('corregir un valor lo marca como editado, conserva el valor de BIND y puede restaurarse', () => {
    const edited = setFieldValue(form, 'ancho', '14');
    expect(displayOrigin(edited.fields.ancho)).toBe('USUARIO');
    expect(edited.fields.ancho.base).toEqual({ value: '13', origin: 'BIND' });
    expect(changedFields(selectFamily(edited, 'BOLSA_PLANA_1'))).toEqual(['ancho']);
    const restored = restoreField(edited, 'ancho');
    expect(restored.fields.ancho.value).toBe('13');
    expect(displayOrigin(restored.fields.ancho)).toBe('BIND');
    expect(isEdited(restored.fields.ancho)).toBe(false);
    expect(form.fields.ancho.value).toBe('13');       // el formulario original y la respuesta de BIND no cambian
    expect(lookup.producto.Title).toContain('13 x 16');
  });

  it('el cliente puede venir del catálogo o capturarse provisionalmente', () => {
    expect(displayOrigin(setFieldValue(form, 'cliente', 'Acme', 'CATALOGO').fields.cliente)).toBe('CATALOGO');
    expect(displayOrigin(setFieldValue(form, 'cliente', 'Nuevo cliente', 'PROVISIONAL').fields.cliente)).toBe('PROVISIONAL');
  });
});

describe('buildInitialForm · caso B (pendientes)', () => {
  const form = buildInitialForm(deepFreeze(casoB()));

  it('marca como pendientes la unidad de medidas, la unidad del calibre y el peso, sin convertir el calibre', () => {
    expect(displayOrigin(form.fields.unidadDimensiones)).toBe('PENDIENTE');
    expect(form.fields.unidadDimensiones.value).toBe('');
    expect(form.fields.calibreValor).toMatchObject({ value: '200' });
    expect(displayOrigin(form.fields.calibreValor)).toBe('PENDIENTE');
    expect(form.fields.calibreUnidad.value).toBe('');
    expect(displayOrigin(form.fields.pesoLb)).toBe('PENDIENTE');
    expect(form.fields.pesoLb.value).toBe('');
  });
});

describe('validateSpecification', () => {
  it('SCHFPMG001 con familia y color del dibujo queda completa', () => {
    const lookup = schfpmg001();
    const result = validateSpecification(completo(buildInitialForm(lookup)), lookup);
    expect(result.errors).toEqual({});
    expect(result.complete).toBe(true);
  });

  it('sin familia ni color no está completa', () => {
    const result = validateSpecification(buildInitialForm(schfpmg001()));
    expect(result.complete).toBe(false);
    expect(result.errors.familia).toMatch(/familia/i);
    expect(result.errors.colorHex).toBeDefined();
  });

  it('Hoja Paq exige la modalidad; Bolsa Plana 1 no', () => {
    const base = setFieldValue(buildInitialForm(schfpmg001()), 'colorHex', '#538DD5');
    expect(validateSpecification(selectFamily(base, 'HOJA_PAQ')).errors.modalidad).toBeDefined();
    expect(validateSpecification(selectFamily(base, 'BOLSA_PLANA_1')).errors.modalidad).toBeUndefined();
    expect(validateSpecification(setFieldValue(selectFamily(base, 'HOJA_PAQ'), 'modalidad', 'DOBLADA')).complete).toBe(true);
  });

  it('el caso B no se completa hasta que el usuario confirma unidad, calibre y peso', () => {
    const lookup = casoB();
    let f = completo(buildInitialForm(lookup));
    const faltan = validateSpecification(f, lookup).errors;
    expect(Object.keys(faltan).sort()).toEqual(['calibreUnidad', 'pesoLb', 'unidadDimensiones']);
    f = setFieldValue(setFieldValue(setFieldValue(f, 'unidadDimensiones', 'IN'), 'calibreUnidad', 'MIL'), 'pesoLb', '0.1');
    expect(validateSpecification(f, lookup).complete).toBe(true);
  });

  it.each([
    ['cantidad', '0'], ['cantidad', '1.5'], ['cantidad', 'abc'], ['ancho', '-3'], ['ancho', '0'], ['largo', 'x'], ['calibreValor', '0'], ['pesoLb', '0'], ['pesoLb', 'abc'], ['colorHex', '538DD5'], ['colorHex', '#GGGGGG'], ['fechaEmision', 'no-es-fecha']
  ] as const)('valor no válido en %s = %j', (key, value) => {
    const f = setFieldValue(completo(buildInitialForm(schfpmg001())), key, value);
    const result = validateSpecification(f);
    expect(result.complete).toBe(false);
    expect(result.errors[key]).toBeDefined();
  });

  it('advierte cuando la familia elegida contradice el tipo de producto de BIND', () => {
    const lookup = schfpmg001();
    const result = validateSpecification(completo(buildInitialForm(lookup), 'HOJA_PAQ'), lookup);
    expect(result.warnings.join(' ')).toMatch(/Bolsa/);
  });
});
