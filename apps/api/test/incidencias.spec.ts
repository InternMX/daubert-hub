import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { pgPool } = vi.hoisted(() => ({ pgPool: vi.fn() }));
vi.mock('pg', () => ({ Pool: pgPool, default: { Pool: pgPool } }));

import { clasificarAdvertencias } from '../src/manufacturing-sheets/bind-product-interpreter/advertencias-catalogo';
import { interpretarProductoBind } from '../src/manufacturing-sheets/bind-product-interpreter/bind-product-interpreter';
import type { AdvertenciaBase, CodigoAdvertencia } from '../src/manufacturing-sheets/bind-product-interpreter/bind-product.types';
import { FAMILIAS, FAMILY_CODES, type FamilyCode } from '../src/manufacturing-sheets/preview/family-registry';
import { consolidarIncidencias, idIncidencia, incidencia } from '../src/manufacturing-sheets/preview/incidencias';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { revisarCoherencia } from '../src/manufacturing-sheets/preview/technical-coherence';

// Modelo único de incidencias: identidad estable por CAUSA (no por texto), una incidencia por causa y ningún motor de validación fuera del backend.
describe('modelo único de incidencias', () => {
  it('el id describe la causa (código + campos ordenados), no el texto', () => {
    expect(idIncidencia('FALTANTE', ['ancho'])).toBe('FALTANTE:ancho');
    expect(idIncidencia('COEX_SUMA_PESOS')).toBe('COEX_SUMA_PESOS');
    expect(idIncidencia('X', ['b', 'a'])).toBe('X:a+b');
    const a = incidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'Falta el ancho.', origen: 'FORMULARIO' });
    const b = incidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'Otra redacción distinta.', origen: 'PLANTILLA' });
    expect(a.id).toBe(b.id);
  });

  it('consolida por id: una misma causa se cuenta una sola vez (conserva la mayor severidad y la primera redacción)', () => {
    const base = { campos: ['unidadDimensiones' as const], seccion: 'medidas' as const, origen: 'FORMULARIO' as const };
    const lista = consolidarIncidencias([
      incidencia({ ...base, codigo: 'FALTANTE', nivel: 'PENDIENTE', mensaje: 'Primera.' }),
      incidencia({ ...base, codigo: 'FALTANTE', nivel: 'ERROR', mensaje: 'Segunda.' }),
      incidencia({ ...base, codigo: 'FALTANTE', nivel: 'INFORMACION', mensaje: 'Tercera.' })
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ nivel: 'ERROR', mensaje: 'Primera.' });
  });

  it('dos problemas distintos del mismo campo no se fusionan', () => {
    const lista = consolidarIncidencias([
      incidencia({ codigo: 'VALOR_INVALIDO', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'El ancho no es válido.', origen: 'PLANTILLA' }),
      incidencia({ codigo: 'CAMPO_NO_APLICA', nivel: 'INFORMACION', campos: ['ancho'], seccion: 'familia', mensaje: 'No aplica.', origen: 'FORMULARIO' })
    ]);
    expect(lista.map((i) => i.id).sort()).toEqual(['CAMPO_NO_APLICA:ancho', 'VALOR_INVALIDO:ancho']);
  });

  it('solo las contradicciones (y avisos de revisión explícitos) son reconocibles; los errores y los datos faltantes nunca', () => {
    const faltante = incidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'x', origen: 'FORMULARIO' });
    const contradiccion = incidencia({ codigo: 'COLOR_AZUL', nivel: 'CONTRADICCION', campos: ['colorPreset'], seccion: 'color', mensaje: 'x', origen: 'TITLE' });
    expect([faltante.reconocible, contradiccion.reconocible]).toEqual([false, true]);
  });
});

describe('clasificación de las advertencias de BIND', () => {
  const base = (codigo: CodigoAdvertencia, campos: string[]): AdvertenciaBase => ({ codigo, mensaje: `msg ${codigo}`, campos });

  it('el calibre sin unidad es informativo: nunca una advertencia de conversión ni un pendiente', () => {
    const [a] = clasificarAdvertencias([base('CALIBRE_SIN_UNIDAD', ['calibre'])]);
    expect(a).toMatchObject({ nivel: 'INFORMACION', explicaFaltante: false });
    const r = interpretarProductoBind({ ID: 'x', Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL.200 PAQUETE C/200 BOLSAS' });
    expect(r.advertencias.filter((x) => x.codigo.includes('CALIBRE') && x.nivel !== 'INFORMACION')).toEqual([]);
    expect(JSON.stringify(r.advertencias)).not.toMatch(/conver/i);
  });

  it('los datos ausentes solo EXPLICAN el faltante (el dato faltante ya los representa) y se traducen a los campos del formulario', () => {
    const lista = clasificarAdvertencias([base('UNIDAD_AUSENTE', ['unidadDimensiones']), base('PESO_AUSENTE', ['pesoLb']), base('RESINA_SIN_CASILLA', ['resina'])]);
    expect(lista.map((a) => [a.codigo, a.explicaFaltante])).toEqual([['UNIDAD_AUSENTE', true], ['PESO_AUSENTE', true], ['RESINA_SIN_CASILLA', false]]);
    expect(lista[2]).toMatchObject({ camposFormulario: ['composicion'], id: 'RESINA_SIN_CASILLA:composicion' });
  });

  it('el papel se informa una sola vez: el material sin plantilla absorbe al aviso genérico de producto de papel', () => {
    const lista = clasificarAdvertencias([base('PRODUCTO_DE_PAPEL', ['tipo']), base('MATERIAL_PAPEL_SIN_PLANTILLA', ['tipo', 'material'])]);
    expect(lista.map((a) => a.codigo)).toEqual(['MATERIAL_PAPEL_SIN_PLANTILLA']);
    expect(lista[0]).toMatchObject({ nivel: 'PENDIENTE', seccion: 'familia' });
    const papel = interpretarProductoBind({ ID: 'x', Code: 'TARPPW3301', Title: 'PAPEL VCI 30 x 40" CAL. 3 MIL' });
    expect(papel.advertencias.filter((a) => a.codigo === 'PRODUCTO_DE_PAPEL' || a.codigo === 'MATERIAL_PAPEL_SIN_PLANTILLA')).toHaveLength(1);
    expect(papel.advertencias.some((a) => a.nivel === 'ERROR')).toBe(false);              // el papel no es inválido
  });

  it('Title/Code: el intérprete y la coherencia técnica describen la MISMA causa con el mismo id (se cuenta una vez)', () => {
    const r = interpretarProductoBind({ ID: 'x', Code: 'ITESFCP002', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL' });
    const delIntérprete = r.advertencias.find((a) => a.codigo === 'CODIGO_RESINA_DISTINTA');
    const deCoherencia = revisarCoherencia('BOLSA_PLANA_1', { composicion: 'PMG' }, { title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL', code: 'ITESFCP002' }).find((a) => a.codigo === 'TITLE_CODE');
    expect(delIntérprete?.id).toBe('TITLE_CODE:composicion');
    expect(deCoherencia?.id).toBe('TITLE_CODE:composicion');
    expect(consolidarIncidencias([incidencia({ ...deCoherencia!, seccion: 'composicion' }), incidencia({ codigo: 'CODIGO_RESINA_DISTINTA', id: delIntérprete!.id, nivel: 'CONTRADICCION', campos: ['composicion'], seccion: 'composicion', mensaje: delIntérprete!.mensaje, origen: 'CODE' })])).toHaveLength(1);
  });

  it('el id es estable: la misma entrada produce los mismos ids', () => {
    const entrada = { ID: 'x', Code: 'ITESFCP002', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL' };
    expect(interpretarProductoBind(entrada).advertencias.map((a) => a.id)).toEqual(interpretarProductoBind(entrada).advertencias.map((a) => a.id));
  });
});

describe('coherencia técnica: una incidencia por causa', () => {
  it('capa exterior con libras distintas de cero: una sola incidencia (COEX_EXTERIOR), no además un COEX_VCI de la misma causa', () => {
    const r = revisarCoherencia('COEX', { coexVariante: 'AZUL', pesoLb: '0.3929', pesoCapaInterior: '0.13097', pesoCapaIntermedia: '0.13097', pesoCapaExterior: '0.13097', lbVciExterior: '0.1' });
    expect(r.filter((i) => i.campos.includes('lbVciExterior'))).toHaveLength(1);
  });
  it('cada incidencia de coherencia trae campos y sección; los de varios campos van a la sección', () => {
    const r = revisarCoherencia('COEX', { coexVariante: 'AZUL', pesoLb: '0.3929', pesoCapaInterior: '0.2', pesoCapaIntermedia: '0.13097', pesoCapaExterior: '0.13097' });
    const suma = r.find((i) => i.id === 'COEX_SUMA_PESOS')!;
    expect(suma).toMatchObject({ nivel: 'CONTRADICCION', seccion: 'capas', reconocible: true });
    expect(suma.campos).toHaveLength(3);
  });
});

const CASOS = JSON.parse(readFileSync(resolve(__dirname, 'manufacturing-sheets/prototype/casos.json'), 'utf8')) as Array<{ id: string; familia: FamilyCode; tipo: string; datos: Record<string, string> }>;

describe('vista previa: lista única de incidencias en las siete familias', { timeout: 30_000 }, () => {
  const service = new SheetPreviewService();

  it.each(FAMILY_CODES.map((f) => [f] as const))('%s: cada dato técnico obligatorio ausente genera UNA incidencia FALTANTE con su campo; `faltantes` es su proyección', async (familia) => {
    const r = await service.preview(familia, {});
    const def = FAMILIAS[familia];
    const esperados = def.requeridos.filter((k) => k !== 'colorPreset' && !(k === 'composicion' && def.composicionFija));
    const faltantes = r.incidencias.filter((i) => i.codigo === 'FALTANTE');
    expect(faltantes.map((i) => i.campos[0]).sort()).toEqual([...esperados].sort());
    expect(new Set(r.incidencias.map((i) => i.id)).size).toBe(r.incidencias.length);          // ningún id repetido
    expect(r.faltantes).toHaveLength(faltantes.length);
    expect(r.completo).toBe(false);
    expect(faltantes.every((i) => i.nivel === 'ERROR' && i.afectaVistaPrevia)).toBe(true);
  });

  it.each(CASOS.filter((c) => c.tipo === 'normal').map((c) => [c.id, c] as const))('%s: con los datos completos no queda ningún error ni pendiente técnico', async (_id, caso) => {
    const r = await service.preview(caso.familia, caso.datos);
    expect(r.incidencias.filter((i) => i.nivel !== 'INFORMACION')).toEqual([]);
    expect(r.completo).toBe(true);
  });

  it('un valor no válido es una sola incidencia con su campo (VALOR_INVALIDO), no un texto suelto, y deja la hoja incompleta', async () => {
    const r = await service.preview('BOLSA_PLANA_1', { ...CASOS.find((c) => c.id === 'bolsa-plana-1')!.datos, ancho: 'abc' });
    const i = r.incidencias.filter((x) => x.id === 'VALOR_INVALIDO:ancho');
    expect(i).toHaveLength(1);
    expect(i[0]).toMatchObject({ nivel: 'ERROR', afectaVistaPrevia: true, campos: ['ancho'] });
    expect(r.completo).toBe(false);
  });

  it('el cliente vacío es informativo: no bloquea ni cuenta como dato técnico; con cliente desaparece', async () => {
    const datos = CASOS.find((c) => c.id === 'bolsa-plana-1')!.datos;
    const sin = await service.preview('BOLSA_PLANA_1', { ...datos, cliente: '' });
    expect(sin.incidencias.find((i) => i.id === 'CLIENTE_SIN_IDENTIFICAR:cliente')).toMatchObject({ nivel: 'INFORMACION', afectaVistaPrevia: false });
    expect(sin.completo).toBe(true);
    const con = await service.preview('BOLSA_PLANA_1', { ...datos, cliente: 'Schneider Electric' });
    expect(con.incidencias.some((i) => i.codigo === 'CLIENTE_SIN_IDENTIFICAR')).toBe(false);
  });

  it.each(['ROLLO_CONTINUO', 'TERMOENCOGIBLE'] as const)('%s: la modalidad Extendida no autorizada es UNA incidencia de error que bloquea la vista previa', async (familia) => {
    const caso = CASOS.find((c) => c.familia === familia)!;
    const r = await service.preview(familia, { ...caso.datos, modalidad: 'EXTENDIDA' });
    expect(r.bloqueado).toMatch(/no está autorizada/);
    expect(r.html).toBe('');
    expect(r.incidencias.filter((i) => i.codigo === 'MODALIDAD_NO_AUTORIZADA')).toHaveLength(1);
    expect(r.incidencias.find((i) => i.codigo === 'MODALIDAD_NO_AUTORIZADA')).toMatchObject({ nivel: 'ERROR', campos: ['modalidad'], reconocible: false });
  });

  it('etiqueta y descripción extensas: una incidencia por campo (no se fusionan), con resumen breve y que afecta la vista previa', async () => {
    const caso = CASOS.find((c) => c.id === 'fuelle-etiqueta-descripcion-largas')!;
    const r = await service.preview(caso.familia, caso.datos);
    const largos = r.incidencias.filter((i) => i.codigo === 'TEXTO_EXTENSO');
    expect(largos.map((i) => i.id).sort()).toEqual(['TEXTO_EXTENSO:descripcion', 'TEXTO_EXTENSO:etiqueta']);
    expect(largos.every((i) => i.afectaVistaPrevia && i.nivel === 'PENDIENTE' && i.reconocible && (i.resumen ?? '').length < i.mensaje.length)).toBe(true);
  });
});
