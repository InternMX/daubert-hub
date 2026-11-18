import { describe, expect, it } from 'vitest';
import { interpretarCodigo, interpretarProductoBind, sugerirEspecificacion } from '../../src/manufacturing-sheets/bind-product-interpreter';
import type { BindProductInput, CodigoAdvertencia } from '../../src/manufacturing-sheets/bind-product-interpreter';

// Code como fuente SECUNDARIA: el Title manda; el Code sugiere solo cuando el Title omite un dato, con procedencia identificable.
const interpretar = (Code: string, Title: string) => interpretarProductoBind({ ID: 'x', Code, Title, Weight: 0.05 } as BindProductInput);
const avisos = (r: ReturnType<typeof interpretar>): CodigoAdvertencia[] => r.advertencias.map((a) => a.codigo);

describe('interpretarCodigo · estructura variable y claves', () => {
  it.each([
    ['SCHFPMG001', 'SCH', 'FILM', 'PMG', '001', []],
    ['IMPFPMG012', 'IMP', 'FILM', 'PMG', '012', []],
    ['DANFPMGOC09', 'DAN', 'FILM', 'PMG', '09', ['OC']],
    ['TARPPW3301', 'TAR', 'PAPER', 'PW33', '01', []],
    ['IMPPPW3013', 'IMP', 'PAPER', 'PW30', '13', []],
    ['ITESFPMG19', 'ITES', 'FILM', 'PMG', '19', []],                       // prefijo de cuatro letras
    ['SAMOFPMG01', 'SAMO', 'FILM', 'PMG', '01', []],
    ['XFESD1', 'X', 'FILM', 'ESD', '1', []],                               // prefijo de una letra y consecutivo de un dígito
    ['CATCFFPMG-014', 'CATCF', 'FILM', 'PMG', '014', []],                  // CF queda dentro del prefijo: sin catálogo no se puede separar
    ['VWMFLDPE003', 'VWM', 'FILM', 'LDPE', '003', []],
    ['ABCFXOW010-EXP-2', 'ABC', 'FILM', 'XOW', '010', ['EXP', '2']]
  ])('%s → prefijo %s · %s · %s · consecutivo %s · segmentos %j', (code, prefijo, material, clave, consecutivo, segmentos) => {
    expect(interpretarCodigo(code)).toMatchObject({ interpretable: true, prefijoCliente: prefijo, material, claveMaterial: clave, consecutivo, segmentosAdicionales: segmentos });
  });

  it('LARG01 y otros códigos sin la estructura no se interpretan ni se inventa nada', () => {
    for (const code of ['LARG01', 'AFTNESD001', 'VERPMG0004', 'SCHFPMG', '', '12345']) expect(interpretarCodigo(code), code).toMatchObject({ interpretable: false, material: null, claveMaterial: null, resina: null });
  });

  it.each(['ITESFCP002', 'AUDFCP5010', 'KAMFCP500002', 'MRHFCP3004', 'AUMFCP5000012'])('%s: CP con números es ambiguo y NO se divide en resina y consecutivo', (code) => {
    const c = interpretarCodigo(code);
    expect(c).toMatchObject({ interpretable: true, claveMaterial: 'CP', claveAmbigua: true, consecutivo: null, segmentosAdicionales: [], resina: 'CP5000' });
  });

  it('CP seguido de letras no es ambiguo en la clave (ITESFCPC14: segmento C, consecutivo 14)', () => {
    expect(interpretarCodigo('ITESFCPC14')).toMatchObject({ claveMaterial: 'CP', claveAmbigua: false, consecutivo: '14', segmentosAdicionales: ['C'] });
  });

  it('una P o F implausible con la clave deja el material ambiguo: DAIDPPMG02 podría ser prefijo DAIDP', () => {
    expect(interpretarCodigo('DAIDPPMG02')).toMatchObject({ interpretable: true, material: null, materialAmbiguo: true, claveMaterial: 'PMG', resina: 'PMG' });
    expect(interpretarCodigo('XYZFPW3001')).toMatchObject({ material: null, materialAmbiguo: true });
  });
});

describe('Title sin resina o sin tipo: el Code sugiere con procedencia CODE (nunca como extraído del Title)', () => {
  it('Title sin resina + IMPFPMG012: composición PMG INFERIDA del código', () => {
    const r = interpretar('IMPFPMG012', 'BOLSA VCI 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(r.campos.resina).toMatchObject({ valor: 'PMG', origen: 'SUGERIDO', procedencia: 'CODE' });
    expect(r.campos.resina.fuente).toMatch(/^Code IMPFPMG012/);
    expect(r.campos.resina.nota).toMatch(/Inferida de la clave PMG del código/);
    expect(avisos(r)).toContain('DATO_INFERIDO_DEL_CODIGO');
    expect(r.campos.material).toMatchObject({ valor: 'FILM', origen: 'SUGERIDO', procedencia: 'CODE' });
    expect(r.campos.claveMaterial).toMatchObject({ valor: 'PMG', procedencia: 'CODE' });
    // y la sugerencia de resina VCI lo declara
    expect(sugerirEspecificacion(r).resinaVci.nota).toMatch(/inferida del código, no del título/);
  });

  it('DANFPMGOC09 con Title sin resina: PMG inferida aunque el código traiga el segmento OC', () => {
    const r = interpretar('DANFPMGOC09', 'BOLSA 41.5 X 39.5 X 56.5" CAL. 200 PAQUETE C/50 BOLSAS');
    expect(r.codigo).toMatchObject({ consecutivo: '09', segmentosAdicionales: ['OC'] });
    expect(r.campos.resina).toMatchObject({ valor: 'PMG', procedencia: 'CODE' });
  });

  it('Title sin tipo de material + código P/PW33: papel inferido; no es un producto inválido', () => {
    const r = interpretar('TARPPW3301', 'PW33 40 x 50" PAQUETE C/100');
    expect(r.campos.material).toMatchObject({ valor: 'PAPEL', origen: 'SUGERIDO', procedencia: 'CODE' });
    expect(r.campos.claveMaterial).toMatchObject({ valor: 'PW33', procedencia: 'TITLE_Y_CODE' });         // el título también dice PW33
    expect(r.campos.tipo).toMatchObject({ valor: 'PAPEL' });
    expect(avisos(r)).toContain('MATERIAL_PAPEL_SIN_PLANTILLA');
    expect(avisos(r)).not.toContain('CODIGO_NO_INTERPRETABLE');
  });

  it('PW30 (IMPPPW3013) sin mención en el título: clave PW30 inferida del código', () => {
    const r = interpretar('IMPPPW3013', '40 x 50" C/100');
    expect(r.campos.claveMaterial).toMatchObject({ valor: 'PW30', origen: 'SUGERIDO', procedencia: 'CODE' });
    expect(r.campos.material).toMatchObject({ valor: 'PAPEL', procedencia: 'CODE' });
    expect(r.campos.resina.valor).toBeNull();                                                              // las claves de papel no son una composición plástica
  });

  it('F del código no determina bolsa, hoja ni familia: el tipo queda pendiente y no se sugiere familia', () => {
    const r = interpretar('SCHFPMG001', 'VCI 13 x 16" CAL. 3 MIL');
    expect(r.campos.material).toMatchObject({ valor: 'FILM', procedencia: 'CODE' });
    expect(r.campos.tipo).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    const s = sugerirEspecificacion(r);
    expect(s.familia.valor).toBeNull();
    expect(s.familia.motivo).toMatch(/bolsa o una hoja/i);
  });

  it('LARG01: sin interpretación confiable de material a partir del código', () => {
    const r = interpretar('LARG01', 'VCI 13 x 16" CAL. 3 MIL');
    expect(r.campos.material).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    expect(r.campos.claveMaterial).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    expect(r.campos.resina.valor).toBeNull();
    expect(avisos(r)).toContain('CODIGO_NO_INTERPRETABLE');
    expect(avisos(r)).not.toContain('DATO_INFERIDO_DEL_CODIGO');
  });

  it('LDPE en el código + Title de bolsa con fuelle sin resina: composición Natural inferida y Bolsa Natural sugerida (a confirmar)', () => {
    const r = interpretar('VWMFLDPE003', 'BOLSA 61 X 48 X 70.9 CAL. 300');
    expect(r.campos.resina).toMatchObject({ valor: 'NAT', origen: 'SUGERIDO', procedencia: 'CODE' });
    expect(r.campos.resina.nota).toMatch(/LDPE/);
    expect(sugerirEspecificacion(r).familia).toMatchObject({ valor: 'BOLSA_NATURAL' });
  });

  it('ESD inferida del código sin casilla de Composición: se advierte y la familia queda pendiente', () => {
    const r = interpretar('HELFPMGESD1'.replace('PMG', ''), 'BOLSA 9.45 X 10.2" CAL 4 MIL');        // HELFESD1
    expect(r.campos.resina).toMatchObject({ valor: 'ESD', procedencia: 'CODE' });
    expect(avisos(r)).toContain('RESINA_SIN_CASILLA');
    expect(sugerirEspecificacion(r).familia.valor).toBeNull();
  });
});

describe('Title y Code coinciden o se contradicen', () => {
  it('coinciden: corroborado por ambas fuentes, el valor sigue siendo el del Title', () => {
    const r = interpretar('SCHFPMG001', 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL');
    expect(r.campos.resina).toMatchObject({ valor: 'PMG', origen: 'EXTRAIDO', procedencia: 'TITLE_Y_CODE' });
    expect(r.campos.claveMaterial.valor).toBe('PMG');
    expect(avisos(r)).not.toContain('DATO_INFERIDO_DEL_CODIGO');
  });

  it('CP del código corrobora CP5000 del título (sin dividir el código)', () => {
    const r = interpretar('AUDFCP5010', 'BOLSA VCI CP5000 61 x 48.4 CAL. 250');
    expect(r.campos.resina).toMatchObject({ valor: 'CP5000', procedencia: 'TITLE_Y_CODE' });
    expect(avisos(r)).not.toContain('CODIGO_RESINA_DISTINTA');
  });

  it('contradicción de resina: se conserva el Title, se marca CONTRADICCION y se advierte', () => {
    const r = interpretar('ITESFCP002', 'BOLSA VCI PMG 10 x 14" CAL. 2 MIL');
    expect(r.campos.resina).toMatchObject({ valor: 'PMG', origen: 'EXTRAIDO', procedencia: 'CONTRADICCION' });
    expect(r.campos.resina.nota).toMatch(/título indica PMG y el código indica CP/);
    expect(avisos(r)).toContain('CODIGO_RESINA_DISTINTA');
  });

  it('LDPE (Natural) frente a PMG en el título: contradicción', () => {
    const r = interpretar('AUDFLDPE02', 'BOLSA VCI PMG 120 x 80" CAL. 250');
    expect(r.campos.resina).toMatchObject({ valor: 'PMG', procedencia: 'CONTRADICCION' });
  });

  it('contradicción de material: título de film con código de papel conserva el título y deja el material pendiente', () => {
    const r = interpretar('TARPPW3301', 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL');
    expect(r.campos.tipo).toMatchObject({ valor: 'BOLSA', procedencia: 'CONTRADICCION' });
    expect(r.campos.material).toMatchObject({ valor: null, origen: 'PENDIENTE', procedencia: 'CONTRADICCION' });
    expect(avisos(r)).toContain('CODIGO_MATERIAL_DISTINTO');
  });

  it('título de papel con código de film (F): contradicción; el título manda', () => {
    const r = interpretar('SCHFPMG001', 'PAPEL VCI 40 x 50" C/100 HOJAS');
    expect(r.campos.tipo).toMatchObject({ valor: 'PAPEL', procedencia: 'CONTRADICCION' });
    expect(r.campos.material).toMatchObject({ valor: 'PAPEL', procedencia: 'CONTRADICCION' });
  });

  it('título con resinas contradictorias entre sí: no lo resuelve el código (queda pendiente)', () => {
    const r = interpretar('SCHFPMG001', 'BOLSA PMG CP5000 13 x 16" CAL. 3 MIL');
    expect(r.campos.resina).toMatchObject({ valor: null, origen: 'PENDIENTE', procedencia: 'CONTRADICCION' });
  });

  it('ambas fuentes insuficientes: pendiente', () => {
    const r = interpretar('LARG01', 'PRODUCTO VARIOS');
    expect(r.campos.resina).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    expect(r.campos.material.origen).toBe('PENDIENTE');
  });
});

describe('Paper no recibe plantillas plásticas', () => {
  it.each([['TARPPW3301', 'PW33'], ['IMPPPW3013', 'PW30']])('%s (%s): sin familia, todas las familias incompatibles, producto válido', (code, clave) => {
    const r = interpretar(code, `BOLSA VCI 40 x 50" C/100`.replace('BOLSA VCI', clave));
    const s = sugerirEspecificacion(r);
    expect(s.familia.valor).toBeNull();
    expect(s.familia.motivo).toMatch(/no hay una plantilla de papel disponible en este prototipo/);
    expect(s.familia.motivo).toMatch(/válido en BIND/);
    expect(s.familia.incompatibles.length).toBeGreaterThanOrEqual(7);
    expect(r.familia.posiblesEstaFase).toEqual([]);
  });
});
