import { describe, expect, it } from 'vitest';
import type { BindProductLookup } from '../services/bindProducts';
import type { FieldKey } from '../services/manufacturingFamilies';
import { familyConfigs } from '../test/bindProductFixtures';
import lookups from '../test/bindLookups.fixture.json';
import { buildInitialForm, configOf, restoreField, selectFamily, setFieldValue, validateSpecification, type SpecificationForm } from './specificationForm';

// Prellenado desde BIND con respuestas REALES del backend (bindLookups.fixture.json, sincronizado con una prueba de la API). Mide cuántos datos obligatorios deja preparados el sistema, cuántos son
// sugerencias por revisar y cuántos quedan vacíos para captura manual. DANFPMGOC04 es el caso de regresión principal; las reglas son generales.
const lookup = (clave: keyof typeof lookups): BindProductLookup => lookups[clave] as unknown as BindProductLookup;
// Si el sistema no sugiere familia (medidas pendientes), el usuario la elige: aquí Bolsa Plana 1 para medir lo que quedaría por capturar.
const formulario = (clave: keyof typeof lookups): SpecificationForm => { const f = buildInitialForm(lookup(clave), familyConfigs, '2026-11-05'); return f.family === null ? selectFamily(f, 'BOLSA_PLANA_1', familyConfigs) : f; };
const validar = (f: SpecificationForm, clave: keyof typeof lookups) => validateSpecification(f, familyConfigs, lookup(clave));

interface Cobertura { familia: string; obligatorios: number; listos: number; sugeridos: number; vacios: FieldKey[] }
function cobertura(f: SpecificationForm): Cobertura {
  const config = configOf(familyConfigs, f.family);
  if (!config) throw new Error('sin familia');
  const requeridos = config.requeridos.filter((k) => !(k === 'composicion' && config.composicionFija));
  const vacios = requeridos.filter((k) => f.fields[k].value.trim() === '');
  const sugeridos = requeridos.filter((k) => f.fields[k].value.trim() !== '' && f.fields[k].base.origin === 'SUGERIDO').length;
  return { familia: config.nombre, obligatorios: requeridos.length, listos: requeridos.length - vacios.length - sugeridos, sugeridos, vacios };
}

describe('DANFPMGOC04: antes faltaban 9 datos obligatorios; ahora la hoja queda preparada', () => {
  const f = formulario('DANFPMGOC04');

  it('prellena presentación, cantidad, unidad de cantidad, ancho, largo, unidad, calibre y fuelles, con su fuente', () => {
    expect(f.family).toBe('BOLSA_FUELLE');
    const v = (k: FieldKey) => f.fields[k].value;
    expect([v('presentacion'), v('cantidad'), v('cantidadUnidad')]).toEqual(['PAQUETE', '200', 'BOLSAS']);
    expect([v('ancho'), v('fuelleTotal'), v('fuelleDerecho'), v('fuelleIzquierdo'), v('largo'), v('unidadDimensiones')]).toEqual(['27', '17', '8.5', '8.5', '26.4', 'IN']);
    expect(v('calibre')).toBe('200');                                                       // literal: jamás «2 MIL»
    expect(v('pesoLb')).toBe('0.155');
    expect(f.fields.presentacion.base.fuente).toBe('DESCRIPTION');
    expect(f.fields.ancho.base.fuente).toBe('TITLE_Y_DESCRIPTION');
    expect(f.fields.calibre.base.fuente).toBe('DESCRIPTION');
  });

  it('distingue lo sugerido (unidad de «/B», tres medidas como Ancho × Fuelle × Largo, mitades) de lo extraído, con su explicación', () => {
    expect(f.fields.cantidadUnidad.base).toMatchObject({ origin: 'SUGERIDO' });
    expect(f.fields.cantidadUnidad.base.note).toMatch(/«B» de «\/B» no está confirmada/);
    for (const k of ['ancho', 'largo', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo'] as const) expect(f.fields[k].base.origin).toBe('SUGERIDO');
    expect(f.fields.presentacion.base.origin).toBe('BIND');
    expect(f.fields.unidadDimensiones.base.origin).toBe('BIND');
  });

  it('cero datos obligatorios por capturar: la validación local ya no reporta faltantes (el servidor sigue validando)', () => {
    const c = cobertura(f);
    expect(c.vacios).toEqual([]);
    expect(validar(f, 'DANFPMGOC04').errors).toEqual({});
    expect(validar(f, 'DANFPMGOC04').technicalReady).toBe(true);
    expect(c.listos + c.sugeridos).toBe(c.obligatorios);
  });

  it('no sobrescribe lo que el usuario edita y «restaurar» vuelve al dato de BIND; un valor manual nunca se pierde al volver a validar', () => {
    const editado = setFieldValue(f, 'ancho', '30');
    expect(editado.fields.ancho.value).toBe('30');
    expect(validar(editado, 'DANFPMGOC04').errors).toEqual({});
    expect(restoreField(editado, 'ancho').fields.ancho.value).toBe('27');
  });
});

describe('otros productos y familias', () => {
  it('bolsa plana con datos solo en Description: queda lista sin faltantes', () => {
    const f = formulario('BOLSA_PLANA_SOLO_DESCRIPTION');
    expect(f.family).toBe('BOLSA_PLANA_1');
    expect([f.fields.presentacion.value, f.fields.cantidad.value, f.fields.cantidadUnidad.value, f.fields.ancho.value, f.fields.largo.value, f.fields.unidadDimensiones.value, f.fields.calibre.value]).toEqual(['PAQUETE', '100', 'BOLSAS', '20', '30', 'IN', '3 MIL']);
    expect(validar(f, 'BOLSA_PLANA_SOLO_DESCRIPTION').errors).toEqual({});
  });

  it('hojas: todo menos la modalidad (decisión que BIND no entrega) queda preparado', () => {
    const f = formulario('HOJAS_SOLO_DESCRIPTION');
    expect(f.family).toBe('HOJA_PAQ');
    expect(Object.keys(validar(f, 'HOJAS_SOLO_DESCRIPTION').errors)).toEqual(['modalidad']);
  });

  it('rollo continuo: ancho, largo y unidad solo con etiquetas; quedan por capturar la modalidad y el ancho del rollo (no existen en BIND) y no se aplican reglas de bolsa', () => {
    const f = formulario('ROLLO_CONTINUO_CON_ETIQUETAS');
    expect(f.family).toBe('ROLLO_CONTINUO');
    expect([f.fields.ancho.value, f.fields.largo.value, f.fields.unidadDimensiones.value]).toEqual(['40', '100', 'IN']);
    expect(f.fields.fuelleTotal.value).toBe('');
    expect(Object.keys(validar(f, 'ROLLO_CONTINUO_CON_ETIQUETAS').errors).sort()).toEqual(['anchoRollo', 'modalidad']);
  });

  it('Title y Description contradictorios: calibre, cantidad y medidas quedan VACÍOS (no se elige una fuente) y la contradicción viaja con el producto', () => {
    const f = formulario('CONTRADICCION_TITLE_DESCRIPTION');
    for (const k of ['calibre', 'cantidad', 'ancho', 'largo'] as const) expect(f.fields[k].value).toBe('');
    const codigos = lookup('CONTRADICCION_TITLE_DESCRIPTION').advertencias.map((a) => a.codigo);
    expect(codigos.filter((c) => c === 'TITULO_DESCRIPCION_DISTINTOS')).toHaveLength(3);
    expect(lookup('CONTRADICCION_TITLE_DESCRIPTION').advertencias.find((a) => a.codigo === 'TITULO_DESCRIPCION_DISTINTOS')?.nivel).toBe('CONTRADICCION');
    expect(Object.keys(validar(f, 'CONTRADICCION_TITLE_DESCRIPTION').errors)).toEqual(expect.arrayContaining(['calibre', 'cantidad', 'ancho', 'largo']));
  });

  it('dos sistemas de medidas sin Description que corrobore: siguen vacías (no se elige al azar), como antes', () => {
    const f = formulario('SIN_DESCRIPTION_CON_DOS_SISTEMAS');
    expect([f.fields.ancho.value, f.fields.largo.value, f.fields.unidadDimensiones.value]).toEqual(['', '', '']);
  });
});

describe('medición de captura manual (datos obligatorios de la familia sugerida)', () => {
  it('resumen por producto: listos / sugeridos por revisar / vacíos', () => {
    const filas = (Object.keys(lookups) as Array<keyof typeof lookups>).map((k) => ({ producto: k, ...cobertura(formulario(k)) }));
    const texto = filas.map((x) => `${x.producto}: ${x.familia} · obligatorios ${x.obligatorios} · listos ${x.listos} · sugeridos ${x.sugeridos} · vacíos ${x.vacios.length}${x.vacios.length ? ` (${x.vacios.join(', ')})` : ''}`).join('\n');
    console.info(`\nCOBERTURA\n${texto}`);
    const dan = filas.find((x) => x.producto === 'DANFPMGOC04');
    expect(dan?.vacios).toEqual([]);
    for (const x of filas) expect(x.listos + x.sugeridos + x.vacios.length).toBe(x.obligatorios);
  });
});

describe('revisión del borrador: por completar, sugeridos por revisar, contradicciones y errores reales', () => {
  it('DANFPMGOC04: nada por completar y los datos técnicos prellenados como sugerencia se cuentan para revisar', async () => {
    const { sugeridosPorRevisar } = await import('./specificationForm');
    const f = formulario('DANFPMGOC04');
    const config = configOf(familyConfigs, f.family);
    expect(sugeridosPorRevisar(f, config).sort()).toEqual(['ancho', 'cantidadUnidad', 'fuelleDerecho', 'fuelleIzquierdo', 'fuelleTotal', 'largo']);   // la cantidad (200) es explícita; solo su unidad se sugiere
    // Al editar un dato sugerido, deja de contar como «por revisar» (el usuario ya lo tocó).
    expect(sugeridosPorRevisar(setFieldValue(f, 'ancho', '28'), config)).not.toContain('ancho');
    expect(validar(f, 'DANFPMGOC04').incidencias.filter((i) => i.codigo === 'FALTANTE')).toEqual([]);
  });

  it('con datos faltantes, la revisión los llama «por completar» y los separa de los errores reales', async () => {
    const { resumir } = await import('./incidencias');
    const f = formulario('SIN_DESCRIPTION_CON_DOS_SISTEMAS');
    const lista = validar(f, 'SIN_DESCRIPTION_CON_DOS_SISTEMAS').incidencias;
    const cuenta = resumir(lista, (k) => f.fields[k].value, {});
    expect(cuenta.faltantes).toBeGreaterThanOrEqual(9);
    expect(cuenta.ERROR - cuenta.faltantes).toBe(0);                                             // ningún error real: solo datos por completar
  });
});

describe('modalidad explícita', () => {
  it('prellena la modalidad solo cuando BIND la declara con la palabra (sugerida, editable); sin palabra queda para captura', () => {
    const l = lookup('HOJAS_SOLO_DESCRIPTION');
    expect(buildInitialForm(l, familyConfigs, '2026-11-05').fields.modalidad.value).toBe('');
    const conModalidad = { ...l, sugerencias: { ...l.sugerencias, modalidad: { valor: 'DOBLADA' as const, nota: 'El texto de BIND dice «doblada».' } } };
    const f = buildInitialForm(conModalidad, familyConfigs, '2026-11-05');
    expect(f.fields.modalidad).toMatchObject({ value: 'DOBLADA', base: { origin: 'SUGERIDO' } });
    expect(validateSpecification(f, familyConfigs, conModalidad).errors).toEqual({});
  });
});
