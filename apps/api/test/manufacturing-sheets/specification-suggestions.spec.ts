import { describe, expect, it } from 'vitest';
import { interpretarProductoBind, sugerirEspecificacion } from '../../src/manufacturing-sheets/bind-product-interpreter';

const sugerir = (Title: string, Code = 'ABCFPMG001') => sugerirEspecificacion(interpretarProductoBind({ ID: 'x', Code, Title, Weight: 0.05 }));

describe('sugerirEspecificacion · familia', () => {
  it('SCHFPMG001: bolsa de dos medidas → Bolsa Plana 1, con motivo', () => {
    const s = sugerir('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 'SCHFPMG001');
    expect(s.familia.valor).toBe('BOLSA_PLANA_1');
    expect(s.familia.motivo).toMatch(/dos medidas/);
    expect(s.familia.incompatibles).toEqual([{ familia: 'HOJA_PAQ', motivo: 'BIND describe una bolsa, no una hoja.' }]);
  });

  it('hoja plástica explícita de dos medidas → HOJA_PAQ', () => {
    const s = sugerir('HOJA VCI PMG 48 x 60" CAL. 3 MIL ROLLO C/25 HOJAS');
    expect(s.familia.valor).toBe('HOJA_PAQ');
    expect(s.familia.incompatibles.map((i) => i.familia)).toEqual(['BOLSA_PLANA_1']);
  });

  it.each([
    ['tres dimensiones (fuelle)', 'BOLSA VCI PMG 51 X 46 X 80" CAL. 3 MIL ROLLO C/50 BOLSAS', /fuelle/i],
    ['palabra FUELLE', 'BOLSA PMG CON FUELLE 13 x 16" CAL. 3 MIL', /fuelle/i],
    ['coextrusión', 'BOLSA COEX PMG 13 x 16" CAL. 3 MIL', /otra familia/i],
    ['tubo', 'TUBO PMG 120 x 180 CAL. 2 MIL', /otra familia|bolsa o una hoja/i],
    ['termoencogible', 'BOLSA TERMOENCOGIBLE PMG 13 x 16" CAL. 3 MIL', /otra familia/i],
    ['resina ESD sin casilla', 'BOLSA ESD 9.45 X 10.2" CAL. 4 MIL', /ESD/],
    ['bolsa sin medidas', 'BOLSA VCI PMG CAL. 3 MIL', /dos medidas/i],
    ['tipo ambiguo (bolsa y hoja)', 'BOLSA U HOJA PMG 13 x 16" CAL. 3', /varios tipos/i],
    ['sin tipo', 'PRODUCTO VCI PMG 13 x 16" CAL. 3', /bolsa o una hoja/i]
  ])('no sugiere familia cuando %s', (_caso, titulo, motivo) => {
    const s = sugerir(titulo);
    expect(s.familia.valor).toBeNull();
    expect(s.familia.motivo).toMatch(motivo);
  });

  it('no sugiere Bolsa Plana solo porque el título diga BOLSA: con fuelle queda incompatible y se advierte', () => {
    const s = sugerir('BOLSA VCI PMG CON FUELLE 13 x 16"');
    expect(s.familia.valor).toBeNull();
    expect(s.familia.incompatibles.map((i) => i.familia)).toEqual(expect.arrayContaining(['BOLSA_PLANA_1', 'HOJA_PAQ']));
  });

  it('papel: sin familia y ambas incompatibles', () => {
    const s = sugerir('PAPEL VCI 48 x 60" C/100 HOJAS');
    expect(s.familia.valor).toBeNull();
    expect(s.familia.incompatibles.map((i) => i.familia).sort()).toEqual(['BOLSA_PLANA_1', 'HOJA_PAQ']);
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
