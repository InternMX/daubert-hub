import { describe, expect, it } from 'vitest';
import { adv, bolsaFuelle, casoB, coexAzul, familyConfigs, productoPapel, resinaContradictoria, rolloContinuo, schfpmg001 } from '../test/bindProductFixtures';
import type { BindProductLookup } from '../services/bindProducts';
import type { FamilyCode, FieldKey } from '../services/manufacturingFamilies';
import {
  anclaDe, bloquea, buildIncidencias, consolidar, crearIncidencia, estaReconocida, huella, incidenciasDeBind, resumir, reunirIncidencias, seccionDeCampo, type Incidencia
} from './incidencias';
import { buildInitialForm, configOf, selectFamily, setFieldValue, validateSpecification, type SpecificationForm } from './specificationForm';

const HOY = '2026-03-04';
const cfg = (code: FamilyCode) => configOf(familyConfigs, code)!;
const build = (lookup: BindProductLookup) => buildInitialForm(lookup, familyConfigs, HOY);
const validar = (form: SpecificationForm, lookup?: BindProductLookup) => validateSpecification(form, familyConfigs, lookup);
const valoresDe = (form: SpecificationForm) => (key: FieldKey) => form.fields[key].value;

const contradiccion = (over: Partial<Incidencia> = {}): Incidencia => crearIncidencia({ codigo: 'COLOR_AZUL', nivel: 'CONTRADICCION', campos: ['colorNombre'], seccion: 'color', mensaje: 'BIND menciona COLOR AZUL, pero la hoja usa VERDE.', origen: 'TITLE', ...over });

describe('identidad y consolidación', () => {
  it('el id es estable y describe la causa (código + campo)', () => {
    expect(crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'a' }).id).toBe('FALTANTE:ancho');
    expect(crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'otra redacción' }).id).toBe('FALTANTE:ancho');
  });

  it('una misma causa llegada por varias fuentes se cuenta una vez (formulario + backend + BIND), conservando la redacción de la primera y la mayor severidad', () => {
    const local = crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['unidadDimensiones'], seccion: 'medidas', mensaje: 'La unidad dimensional no está identificada.' });
    const backend = crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['unidadDimensiones'], seccion: 'datos', mensaje: 'Falta unidad de las medidas.', origen: 'PLANTILLA' });
    const lista = reunirIncidencias({ locales: [local], backend: [backend], bind: [] });
    expect(lista).toHaveLength(1);
    expect(lista[0]?.mensaje).toBe('La unidad dimensional no está identificada.');
  });

  it('dos problemas distintos del mismo campo no se fusionan', () => {
    const lista = consolidar([
      crearIncidencia({ codigo: 'VALOR_INVALIDO', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'inválido' }),
      crearIncidencia({ codigo: 'CAMPO_NO_APLICA', nivel: 'INFORMACION', campos: ['ancho'], seccion: 'familia', mensaje: 'no aplica' })
    ]);
    expect(lista).toHaveLength(2);
  });

  it('la corroboración Title/Code es procedencia (chip), no incidencia', () => {
    const lista = reunirIncidencias({ locales: [], bind: [], backend: [crearIncidencia({ codigo: 'CORROBORADO', id: 'CORROBORADO:composicion', nivel: 'INFORMACION', campos: ['composicion'], seccion: 'composicion', mensaje: 'Title y Code corroboran' })] });
    expect(lista).toEqual([]);
  });

  it('ordena por severidad: error, contradicción, pendiente, informativa', () => {
    const lista = consolidar([
      crearIncidencia({ codigo: 'I', nivel: 'INFORMACION', seccion: 'datos', mensaje: 'i' }), crearIncidencia({ codigo: 'E', nivel: 'ERROR', seccion: 'datos', mensaje: 'e' }),
      crearIncidencia({ codigo: 'P', nivel: 'PENDIENTE', seccion: 'datos', mensaje: 'p' }), crearIncidencia({ codigo: 'C', nivel: 'CONTRADICCION', seccion: 'datos', mensaje: 'c' })
    ]);
    expect(lista.map((i) => i.nivel)).toEqual(['ERROR', 'CONTRADICCION', 'PENDIENTE', 'INFORMACION']);
  });
});

describe('advertencias de BIND como incidencias', () => {
  const form = build(casoB());
  const valores = valoresDe(form);

  it('las que solo explican un dato faltante no se repiten (el campo ya lo dice) y la unidad pendiente se cuenta una sola vez', () => {
    const lookup = casoB();
    const delBind = incidenciasDeBind(lookup.advertencias, valores, cfg('BOLSA_PLANA_1'));
    expect(delBind.some((i) => i.codigo === 'UNIDAD_AUSENTE' || i.codigo === 'PESO_AUSENTE')).toBe(false);
    const f = selectFamily(form, 'BOLSA_PLANA_1', familyConfigs);
    const todas = reunirIncidencias({ locales: validar(f, lookup).incidencias, backend: [], bind: delBind });
    expect(todas.filter((i) => i.campos.includes('unidadDimensiones'))).toHaveLength(1);
    expect(todas.find((i) => i.campos.includes('unidadDimensiones'))).toMatchObject({ id: 'FALTANTE:unidadDimensiones', nivel: 'ERROR' });
  });

  it('el calibre literal sin unidad no genera ninguna incidencia (ni de conversión ni pendiente)', () => {
    const lookup = casoB();
    expect(lookup.advertencias.some((a) => a.codigo === 'CALIBRE_SIN_UNIDAD')).toBe(true);
    const todas = reunirIncidencias({ locales: validar(selectFamily(form, 'BOLSA_PLANA_1', familyConfigs), lookup).incidencias, backend: [], bind: incidenciasDeBind(lookup.advertencias, valores, cfg('BOLSA_PLANA_1')) });
    expect(todas.some((i) => i.campos.includes('calibre') || /calibre|conver/i.test(i.mensaje))).toBe(false);
  });

  it('las explicaciones de procedencia (inferido del código, tres medidas sugeridas) no son incidencias: ya las dicen el chip y la nota del campo', () => {
    const lista = incidenciasDeBind([adv('DATO_INFERIDO_DEL_CODIGO', 'x', ['resina']), adv('MEDIDAS_TRES_DIMENSIONES_SUGERIDAS', 'y', ['ancho', 'largo'])], () => '', cfg('BOLSA_FUELLE'));
    expect(lista).toEqual([]);
  });

  it('FAMILIA_NO_CONFIRMADA no se repite como texto: la cubren el chip y el botón de la familia', () => {
    expect(incidenciasDeBind(schfpmg001().advertencias, () => '', cfg('BOLSA_PLANA_1')).some((i) => i.id === 'FAMILIA_NO_CONFIRMADA')).toBe(false);
  });

  it('un aviso sobre campos que la familia elegida no tiene se descarta (cantidad en Rollo Continuo)', () => {
    const lookup = rolloContinuo();
    const lista = incidenciasDeBind([adv('CANTIDAD_AMBIGUA', 'ambigua', ['cantidad'])], () => '', cfg('ROLLO_CONTINUO'));
    expect(cfg('ROLLO_CONTINUO').campos.includes('cantidad')).toBe(false);
    expect(lista).toEqual([]);
    expect(lookup.producto.Code).toBeTruthy();
  });

  it('un pendiente desaparece cuando el usuario completa sus campos; una contradicción Title/Code no caduca al editar', () => {
    const pendiente = adv('CANTIDAD_AMBIGUA', 'ambigua', ['cantidad']);
    expect(incidenciasDeBind([pendiente], () => '', cfg('BOLSA_PLANA_1'))).toHaveLength(1);
    expect(incidenciasDeBind([pendiente], () => '100', cfg('BOLSA_PLANA_1'))).toHaveLength(0);
    const contra = resinaContradictoria().advertencias.filter((a) => a.codigo === 'CODIGO_RESINA_DISTINTA');
    expect(incidenciasDeBind(contra, () => 'PMG', cfg('BOLSA_PLANA_1'))).toHaveLength(1);
  });

  it('el papel se muestra en la sección de familia (no es un error de BIND)', () => {
    const lista = incidenciasDeBind(productoPapel().advertencias, () => '', null);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: 'MATERIAL_PAPEL_SIN_PLANTILLA', nivel: 'PENDIENTE', seccion: 'familia' });
  });
});

describe('reconocimiento expreso', () => {
  const valores = (v: Record<string, string>) => (k: string) => v[k] ?? '';
  const i = contradiccion();

  it('reconocer una incidencia la deja reconocida mientras no cambien los datos que la originaron', () => {
    const v = valores({ colorNombre: 'VERDE' });
    const rec = { [i.id]: huella(i, v as never) };
    expect(estaReconocida(i, v as never, rec)).toBe(true);
    expect(estaReconocida(i, v as never, {})).toBe(false);
  });

  it('el reconocimiento caduca si cambia el valor de un campo afectado o la redacción (valores comparados)', () => {
    const rec = { [i.id]: huella(i, valores({ colorNombre: 'VERDE' }) as never) };
    expect(estaReconocida(i, valores({ colorNombre: 'ROJO' }) as never, rec)).toBe(false);
    expect(estaReconocida({ ...i, mensaje: 'BIND menciona COLOR AZUL, pero la hoja usa ROJO.' }, valores({ colorNombre: 'VERDE' }) as never, rec)).toBe(false);
  });

  it('un reconocimiento no oculta un problema nuevo (otro id)', () => {
    const otra = contradiccion({ id: 'COLOR_VERDE:colorNombre', codigo: 'COLOR_VERDE' });
    const v = valores({ colorNombre: 'VERDE' });
    const rec = { [i.id]: huella(i, v as never) };
    expect(estaReconocida(otra, v as never, rec)).toBe(false);
  });

  it('los errores y los datos faltantes no se pueden reconocer (aunque exista un reconocimiento con su id)', () => {
    const error = crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'Falta el ancho.' });
    expect(error.reconocible).toBe(false);
    const v = valores({});
    expect(estaReconocida(error, v as never, { [error.id]: huella(error, v as never) })).toBe(false);
  });

  it('bloquea la confirmación: errores y contradicciones sin reconocer; no bloquean los pendientes ni las informativas', () => {
    const v = valores({ colorNombre: 'VERDE' }) as never;
    const err = crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'x' });
    const pend = crearIncidencia({ codigo: 'P', nivel: 'PENDIENTE', seccion: 'datos', mensaje: 'x' });
    const info = crearIncidencia({ codigo: 'I', nivel: 'INFORMACION', seccion: 'datos', mensaje: 'x' });
    expect([err, i, pend, info].map((x) => bloquea(x, v, {}))).toEqual([true, true, false, false]);
    expect(bloquea(i, v, { [i.id]: huella(i, v) })).toBe(false);
  });
});

describe('resumen y ubicación', () => {
  const v = (() => '') as never;
  const lista = [
    crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'a' }),
    crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['largo'], seccion: 'medidas', mensaje: 'b' }),
    crearIncidencia({ codigo: 'C', nivel: 'CONTRADICCION', campos: ['colorNombre'], seccion: 'color', mensaje: 'c' }),
    crearIncidencia({ codigo: 'P', nivel: 'PENDIENTE', seccion: 'familia', mensaje: 'd' }),
    crearIncidencia({ codigo: 'I', nivel: 'INFORMACION', seccion: 'datos', mensaje: 'e' })
  ];

  it('el resumen coincide con las incidencias reales y excluye las reconocidas', () => {
    expect(resumir(lista, v, {})).toEqual({ ERROR: 2, CONTRADICCION: 1, PENDIENTE: 1, INFORMACION: 1, total: 5, reconocidas: 0, faltantes: 2 });
    const c = lista[2] as Incidencia;
    expect(resumir(lista, v, { [c.id]: huella(c, v) })).toMatchObject({ CONTRADICCION: 0, total: 4, reconocidas: 1 });
  });

  it('un solo campo visible se ancla al campo; varios campos, ninguno o un campo que la familia no muestra, a la sección', () => {
    const visible = (k: string) => k !== 'largo';
    expect(anclaDe(lista[0] as Incidencia, visible as never)).toEqual({ tipo: 'campo', campo: 'ancho' });
    expect(anclaDe(lista[1] as Incidencia, visible as never)).toEqual({ tipo: 'seccion', seccion: 'medidas' });
    expect(anclaDe(lista[3] as Incidencia, visible as never)).toEqual({ tipo: 'seccion', seccion: 'familia' });
    const suma = crearIncidencia({ codigo: 'COEX_SUMA_PESOS', nivel: 'CONTRADICCION', campos: ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior'], seccion: 'capas', mensaje: 'suma' });
    expect(anclaDe(suma, (() => true) as never)).toEqual({ tipo: 'seccion', seccion: 'capas' });
    expect(seccionDeCampo('lbVciInterior')).toBe('capas');
  });
});

describe('desaparecen al corregir el dato', () => {
  it('completar la unidad elimina la incidencia FALTANTE (y vuelve al borrarla)', () => {
    const lookup = casoB();
    const f = selectFamily(build(lookup), 'BOLSA_PLANA_1', familyConfigs);
    expect(validar(f, lookup).incidencias.some((i) => i.id === 'FALTANTE:unidadDimensiones')).toBe(true);
    const corregida = setFieldValue(f, 'unidadDimensiones', 'IN');
    expect(validar(corregida, lookup).incidencias.some((i) => i.id === 'FALTANTE:unidadDimensiones')).toBe(false);
    expect(validar(setFieldValue(corregida, 'unidadDimensiones', ''), lookup).incidencias.some((i) => i.id === 'FALTANTE:unidadDimensiones')).toBe(true);
  });

  it('un valor no válido pasa de VALOR_INVALIDO a ninguna al corregirlo, y no se confunde con el dato faltante', () => {
    const f = selectFamily(build(schfpmg001()), 'BOLSA_PLANA_1', familyConfigs);
    const mal = validar(setFieldValue(f, 'ancho', 'abc'));
    expect(mal.incidencias.filter((i) => i.campos.includes('ancho')).map((i) => i.id)).toEqual(['VALOR_INVALIDO:ancho']);
    expect(validar(setFieldValue(f, 'ancho', '14')).incidencias.some((i) => i.campos.includes('ancho'))).toBe(false);
  });

  it('confirmar la familia elimina el pendiente FAMILIA_NO_CONFIRMADA; el cliente informativo no bloquea la validación técnica', () => {
    const lookup = schfpmg001();
    const f = build(lookup);
    expect(validar(f, lookup).incidencias.some((i) => i.id === 'FAMILIA_NO_CONFIRMADA')).toBe(true);
    const confirmada = selectFamily(f, 'BOLSA_PLANA_1', familyConfigs);
    const v = validar(confirmada, lookup);
    expect(v.incidencias.some((i) => i.id === 'FAMILIA_NO_CONFIRMADA')).toBe(false);
    expect(v.incidencias.find((i) => i.codigo === 'CLIENTE_SIN_IDENTIFICAR')?.nivel).toBe('INFORMACION');
  });
});

describe('las siete familias conservan sus validaciones', () => {
  it.each(familyConfigs.map((c) => [c.codigo] as const))('%s: cada dato obligatorio vacío es UNA incidencia FALTANTE de nivel error con su campo (la configuración del backend manda)', (codigo) => {
    const config = cfg(codigo);
    const vacio = selectFamily(build(coexAzul()), codigo, familyConfigs);
    let limpio = vacio;
    for (const key of config.requeridos) if (key !== 'composicion' || !config.composicionFija) limpio = setFieldValue(limpio, key, '');
    const r = validar(limpio);
    const obligatorios = config.requeridos.filter((k) => k !== 'composicion' || !config.composicionFija);
    const faltantes = r.incidencias.filter((i) => i.codigo === 'FALTANTE').map((i) => i.campos[0]);
    for (const k of obligatorios) expect(faltantes, `${codigo}/${k}`).toContain(k);
    expect(r.technicalReady).toBe(false);
    expect(new Set(r.incidencias.map((i) => i.id)).size).toBe(r.incidencias.length);
    expect(r.incidencias.filter((i) => i.nivel === 'ERROR').every((i) => !i.reconocible)).toBe(true);
  });

  it('Bolsa Fuelle: datos completos → sin incidencias bloqueantes', () => {
    const lookup = bolsaFuelle();
    let f = selectFamily(build(lookup), 'BOLSA_FUELLE', familyConfigs);
    f = setFieldValue(setFieldValue(setFieldValue(f, 'unidadDimensiones', 'IN'), 'presentacion', 'ROLLO'), 'cantidad', '100');
    f = setFieldValue(f, 'cantidadUnidad', 'BOLSAS');
    const r = validar(f, lookup);
    expect(r.technicalReady).toBe(true);
    expect(r.incidencias.filter((i) => i.nivel === 'ERROR' || i.nivel === 'CONTRADICCION')).toEqual([]);
  });
});

it('buildIncidencias reúne las tres fuentes en una sola lista', () => {
  const lookup = casoB();
  const f = selectFamily(build(lookup), 'BOLSA_PLANA_1', familyConfigs);
  const lista = buildIncidencias({ locales: validar(f, lookup).incidencias, backend: [], advertencias: lookup.advertencias, valores: (k) => f.fields[k].value, config: cfg('BOLSA_PLANA_1') });
  expect(new Set(lista.map((i) => i.id)).size).toBe(lista.length);
});
