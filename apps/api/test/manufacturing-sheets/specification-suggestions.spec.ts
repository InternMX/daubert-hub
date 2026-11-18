import { describe, expect, it } from 'vitest';
import { interpretarProductoBind, sugerirEspecificacion } from '../../src/manufacturing-sheets/bind-product-interpreter';
import { FAMILIAS, FAMILY_CODES } from '../../src/manufacturing-sheets/preview/family-registry';

const sugerir = (Title: string, Code = 'LARG01') => sugerirEspecificacion(interpretarProductoBind({ ID: 'x', Code, Title, Weight: 0.05 }));

describe('sugerirEspecificacion · familia', () => {
  const familia = (titulo: string) => sugerir(titulo).familia;

  it('SCHFPMG001: bolsa de dos medidas → Bolsa Plana 1, con motivo', () => {
    const f = familia('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(f.valor).toBe('BOLSA_PLANA_1');
    expect(f.motivo).toMatch(/dos medidas/);
    expect(f.incompatibles).toEqual([{ familia: 'HOJA_PAQ', motivo: 'BIND describe una bolsa, no una hoja.' }]);
  });

  it('hoja plástica explícita de dos medidas → Hojas; las familias de bolsa quedan incompatibles', () => {
    const f = familia('HOJA VCI PMG 48 x 60" CAL. 3 MIL ROLLO C/25 HOJAS');
    expect(f.valor).toBe('HOJA_PAQ');
    expect(f.incompatibles.map((i) => i.familia).sort()).toEqual(['BOLSA_FUELLE', 'BOLSA_NATURAL', 'BOLSA_PLANA_1']);
  });

  it.each([
    ['tres medidas', 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7', /tres medidas/i],
    ['la palabra FUELLE', 'BOLSA VCI PMG CON FUELLE 13 x 16" CAL. 3 MIL', /fuelle/i]
  ])('bolsa con fuelle (%s) → Bolsa Fuelle y Bolsa Plana 1 queda incompatible', (_caso, titulo, motivo) => {
    const f = familia(titulo);
    expect(f.valor).toBe('BOLSA_FUELLE');
    expect(f.motivo).toMatch(motivo);
    expect(f.incompatibles.map((i) => i.familia)).toEqual(expect.arrayContaining(['BOLSA_PLANA_1', 'HOJA_PAQ']));
  });

  it('material Natural con fuelle → Bolsa Natural, pidiendo confirmar el tipo real; sin fuelle sigue siendo Bolsa Plana 1 (composición Natural)', () => {
    const natural = familia('BOLSA LDPE NAT 61 X 48 X 70.9 CAL. 3');
    expect(natural.valor).toBe('BOLSA_NATURAL');
    expect(natural.motivo).toMatch(/Confirma que sea realmente una bolsa natural/);
    const plana = familia('BOLSA LDPE NAT 25 x 30" CAL. 300 PAQUETE C/100 BOLSAS');
    expect(plana.valor).toBe('BOLSA_PLANA_1');
    expect(plana.motivo).toMatch(/Natural/);
  });

  it('una mención genérica de BOLSA no confirma una familia específica: sin medidas queda pendiente', () => {
    const f = familia('BOLSA VCI PMG CAL. 3 MIL');
    expect(f.valor).toBeNull();
    expect(f.motivo).toMatch(/dos medidas/i);
  });

  it.each([
    ['termoencogible', 'ROLLO VCI + UV TERMOENCOGIBLE 6 X 30 MTS CAL. 7 MIL', 'TERMOENCOGIBLE', /termoencogible/i],
    ['coextrusión', 'BOLSA COEX VCI PMG 51 X 46 X 80" CAL. 3', 'COEX', /coextrusi/i],
    ['rollo continuo', 'ROLLO CONTINUO VCI PMG 58 x 4500" CAL. 3 MIL', 'ROLLO_CONTINUO', /rollo continuo/i]
  ])('%s explícito: la familia aún no está en el registro, así que queda pendiente con explicación (no se sugiere algo que el prototipo no tiene)', (_caso, titulo, familiaEsperada, motivo) => {
    const f = familia(titulo);
    if ((FAMILY_CODES as string[]).includes(familiaEsperada)) expect(f.valor).toBe(familiaEsperada);
    else {
      expect(f.valor).toBeNull();
      expect(f.motivo).toMatch(motivo);
      expect(f.motivo).toMatch(/todavía no está disponible/);
    }
    expect(f.incompatibles.map((i) => i.familia)).not.toContain(familiaEsperada);
  });

  it('rollo continuo y termoencogible explícitos → su familia, con motivo; un «ROLLO» genérico no basta', () => {
    const rollo = familia('ROLLO CONTINUO VCI PMG 58 x 4500" CAL. 3 MIL');
    expect(rollo).toMatchObject({ valor: 'ROLLO_CONTINUO' });
    expect(rollo.motivo).toMatch(/rollo continuo/i);
    const termo = familia('ROLLO VCI + UV TERMOENCOGIBLE 6 X 30 MTS CAL. 8 MIL');
    expect(termo).toMatchObject({ valor: 'TERMOENCOGIBLE' });
    expect(termo.incompatibles.map((i) => i.familia)).not.toContain('TERMOENCOGIBLE');
    const generico = familia('ROLLO VCI PMG 58 x 4500" CAL. 3 MIL');
    expect(generico.valor).toBeNull();
    expect(generico.motivo).toMatch(/bolsa o una hoja/i);
  });

  it.each([
    ['resina ESD sin casilla', 'BOLSA ESD 9.45 X 10.2" CAL. 4 MIL', /ESD/],
    ['tipo ambiguo (bolsa y hoja)', 'BOLSA U HOJA PMG 13 x 16" CAL. 3', /varios tipos/i],
    ['sin tipo', 'PRODUCTO VCI PMG 13 x 16" CAL. 3', /bolsa o una hoja/i],
    ['tubo', 'TUBO PMG 120 x 180 CAL. 2 MIL', /tubo/i]
  ])('queda pendiente cuando %s', (_caso, titulo, motivo) => {
    const f = familia(titulo);
    expect(f.valor).toBeNull();
    expect(f.motivo).toMatch(motivo);
  });

  it('papel: sin familia y todas incompatibles', () => {
    const f = familia('PAPEL VCI 48 x 60" C/100 HOJAS');
    expect(f.valor).toBeNull();
    expect(f.incompatibles.length).toBeGreaterThanOrEqual(7);
  });
});

describe('sugerirEspecificacion · resina VCI', () => {
  it('PMG → «PMG AL 3%»; CP5000 → «CP5000 AL 3%»', () => {
    expect(sugerir('BOLSA VCI PMG 13 x 16" CAL. 3 MIL').resinaVci).toMatchObject({ valor: 'PMG AL 3%', regla: 'RESINA_VCI_PMG_3PCT' });
    expect(sugerir('BOLSA VCI CP5000 13 x 16" CAL. 3 MIL').resinaVci).toMatchObject({ valor: 'CP5000 AL 3%', regla: 'RESINA_VCI_CP5000_3PCT' });
  });

  it('Natural y otras composiciones no reciben formulación VCI', () => {
    const nat = sugerir('BOLSA LDPE NAT 13 x 16" CAL. 4 MIL').resinaVci;
    expect(nat.valor).toBeNull();
    const natural = sugerir('BOLSA NAT 13 x 16" CAL. 4 MIL').resinaVci;
    expect(natural).toMatchObject({ valor: null, regla: null });
    expect(natural.nota).toMatch(/Natural/);
    expect(sugerir('BOLSA ESD 13 x 16" CAL. 4 MIL').resinaVci.valor).toBeNull();
    expect(sugerir('BOLSA 13 x 16" CAL. 4 MIL').resinaVci.valor).toBeNull();
  });

  it('entrega la tabla de la regla para recalcular al cambiar la composición', () => {
    expect(sugerir('BOLSA VCI PMG 13 x 16"').resinaVciPorComposicion).toEqual({ PMG: 'PMG AL 3%', CP5000: 'CP5000 AL 3%' });
  });
});

describe('sugerirEspecificacion · color', () => {
  it('sin color explícito y resina PMG/CP5000 → Daubert Azul con 2 % de concentración de color', () => {
    expect(sugerir('BOLSA VCI PMG 13 x 16" CAL. 3 MIL').color).toMatchObject({ preset: 'DAUBERT_AZUL', concentracionPct: '2', regla: 'COLOR_POR_DEFECTO_VCI_AZUL_2' });
    expect(sugerir('BOLSA VCI CP5000 13 x 16" CAL. 3 MIL').color.preset).toBe('DAUBERT_AZUL');
  });

  it('azul explícito → Daubert Azul; verde explícito → Verde sin concentración', () => {
    expect(sugerir('BOLSA PMG AZUL 13 x 16" CAL. 3').color).toMatchObject({ preset: 'DAUBERT_AZUL', regla: 'COLOR_EXPLICITO_EN_TITULO' });
    expect(sugerir('BOLSA PMG BLUE 13 x 16" CAL. 3').color.preset).toBe('DAUBERT_AZUL');
    expect(sugerir('BOLSA PMG VERDE 13 x 16" CAL. 3')).toMatchObject({ color: { preset: 'VERDE', concentracionPct: null } });
  });

  it('otro color explícito o contradictorio → sin sugerencia (no se inventa un hexadecimal)', () => {
    const amarillo = sugerir('BOLSA VCI PMG 13 x 16" CAL. 3 COLOR AMARILLO').color;
    expect(amarillo).toMatchObject({ preset: null, concentracionPct: null, detectado: 'AMARILLO' });
    expect(amarillo.nota).toMatch(/Otro/);
    const contradictorio = sugerir('BOLSA VCI PMG AZUL VERDE 13 x 16" CAL. 3').color;
    expect(contradictorio.preset).toBeNull();
    expect(contradictorio.nota).toMatch(/varios colores/);
  });

  it('Natural / ESD / resina desconocida → sin sugerencia de color', () => {
    expect(sugerir('BOLSA LDPE NAT 13 x 16" CAL. 4').color.preset).toBeNull();
    expect(sugerir('BOLSA ESD 13 x 16" CAL. 4').color.preset).toBeNull();
    expect(sugerir('BOLSA 13 x 16" CAL. 4').color.preset).toBeNull();
  });
});

describe('sugerirEspecificacion · etiqueta', () => {
  it('es el Title completo, con números de ítem o parte del cliente, sin recortar', () => {
    const titulo = 'A 15M3M6 - BOLSA VCI CP5000 90 x 70 x 118" CAL. 2 MIL PAQUETE C/10 BOLSAS';
    expect(sugerir(titulo).etiqueta).toMatchObject({ valor: titulo, regla: 'ETIQUETA_TITLE_BIND' });
    const largo = `XE-H00024 - ${'BOLSA PMG '.repeat(30)}13 x 16"`;
    expect(sugerir(largo).etiqueta.valor).toBe(largo);
  });

  it('sin título no hay etiqueta', () => {
    expect(sugerir('').etiqueta.valor).toBeNull();
  });
});

describe('calibre: texto literal de BIND', () => {
  const calibre = (titulo: string) => interpretarProductoBind({ ID: 'x', Code: 'ABCFPMG001', Title: titulo }).campos.calibre;

  it.each([
    ['BOLSA PMG 13 x 16" CAL. 200 PAQUETE', '200', null],
    ['BOLSA PMG 13 x 16" CAL. 250 PAQUETE', '250', null],
    ['BOLSA PMG 13 x 16" CAL. 300 PAQUETE', '300', null],
    ['BOLSA PMG 13 x 16" CAL. 2 MIL PAQUETE', '2 MIL', 'MIL'],
    ['BOLSA PMG 13 x 16" CAL. 2.7 PAQUETE', '2.7', null],
    ['BOLSA PMG 13 x 16" CAL. 3 MIL PAQUETE', '3 MIL', 'MIL'],
    ['bolsa pmg 13 x 16" cal.3 mil paquete', '3 mil', 'MIL']
  ])('«%s» → texto literal «%s»', (titulo, literal, unidad) => {
    const c = calibre(titulo);
    expect(c.valor?.textoLiteral).toBe(literal);
    expect(c.valor?.unidadOriginal).toBe(unidad);
  });

  it('nunca agrega MIL ni divide o multiplica por 100', () => {
    const c = calibre('BOLSA PMG 13 x 16" CAL. 200');
    expect(c.valor).toEqual({ valorOriginal: '200', unidadOriginal: null, textoLiteral: '200' });
    expect(JSON.stringify(c)).not.toMatch(/MIL|"2"|"20000"/);
  });
});

describe('sugerirEspecificacion · COEX', () => {
  it('coextrusión explícita → COEX (una sola familia); la variante solo se sugiere si el título declara el color', () => {
    const azul = sugerir('BOLSA COEX VCI PMG AZUL 51.2 X 23.6 X 31.5" CAL. 2.5 MIL');
    expect(azul.familia).toMatchObject({ valor: 'COEX' });
    expect(azul.coexVariante).toMatchObject({ valor: 'AZUL' });
    expect(sugerir('BOLSA COEX VCI PMG VERDE 55 X 46 X 80" CAL. 2.5').coexVariante.valor).toBe('VERDE');
    const sinColor = sugerir('BOLSA COEX VCI PMG 55 X 46 X 80" CAL. 2.5');
    expect(sinColor.coexVariante.valor).toBeNull();
    expect(sinColor.coexVariante.nota).toMatch(/elige la variante COEX/);
    expect(sugerir('BOLSA COEX AZUL VERDE 55 X 46 X 80"').coexVariante.valor).toBeNull();      // contradictorio: no se elige
  });

  it('no aplica una concentración general de 3 % a COEX: la resina por capa es fija y no pasa por la regla monocapa', () => {
    const s = sugerir('BOLSA COEX VCI PMG AZUL 51.2 X 23.6 X 31.5" CAL. 2.5 MIL');
    expect(s.familia.valor).toBe('COEX');
    // la tabla monocapa sigue existiendo para las demás familias, pero COEX no tiene campo de Resina VCI (ver el registro)
    expect(FAMILIAS.COEX.campos).not.toContain('resinaVci');
    expect(FAMILIAS.COEX.capas?.map((c) => c.resina)).toEqual(['VCI PMG al 4%', 'VCI PMG al 2%', 'SIN VCI']);
  });
});
