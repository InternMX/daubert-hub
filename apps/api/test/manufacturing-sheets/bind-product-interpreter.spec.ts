import { describe, expect, it } from 'vitest';
import { interpretarProductoBind, interpretarCodigo, sugerirDatosPlantilla } from '../../src/manufacturing-sheets/bind-product-interpreter';
import type { BindProductInput, CodigoAdvertencia } from '../../src/manufacturing-sheets/bind-product-interpreter';

const producto = (over: Partial<BindProductInput> & Record<string, unknown> = {}): BindProductInput =>
  ({ ID: 1, Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', Weight: 0.0428, CreationDate: '2025-03-10T15:20:00Z', ...over }) as BindProductInput;
const advertencias = (r: ReturnType<typeof interpretarProductoBind>): CodigoAdvertencia[] => r.advertencias.map((a) => a.codigo);

describe('interpretarProductoBind · Caso A (SCHFPMG001)', () => {
  const r = interpretarProductoBind({ ID: 'A-1', Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', Weight: '0.042800', CreationDate: '2025-03-10' });

  it('extrae código, tipo, resina, medidas, unidad, calibre, presentación, cantidad y peso', () => {
    expect(r.campos.codigoDcmx).toMatchObject({ valor: 'SCHFPMG001', origen: 'EXTRAIDO' });
    expect(r.campos.tipo).toMatchObject({ valor: 'BOLSA', origen: 'EXTRAIDO' });
    expect(r.campos.resina).toMatchObject({ valor: 'PMG', origen: 'EXTRAIDO' });
    expect(r.campos.ancho).toMatchObject({ valor: 13, origen: 'EXTRAIDO' });
    expect(r.campos.largo).toMatchObject({ valor: 16, origen: 'EXTRAIDO' });
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: 'IN', origen: 'EXTRAIDO' });
    expect(r.campos.calibre).toMatchObject({ valor: { valorOriginal: '3', unidadOriginal: 'MIL', textoLiteral: '3 MIL' }, origen: 'EXTRAIDO' });
    expect(r.campos.presentacion).toMatchObject({ valor: 'PAQUETE', origen: 'EXTRAIDO' });
    expect(r.campos.cantidad).toMatchObject({ valor: { cantidad: 200, unidad: 'BOLSAS' }, origen: 'EXTRAIDO' });
    expect(r.campos.pesoLb).toMatchObject({ valor: 0.0428, origen: 'EXTRAIDO' });
  });

  it('deja la familia sin confirmar y sin campos pendientes', () => {
    expect(r.familia).toEqual({ valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: ['BOLSA_PLANA_1'] });
    expect(r.pendientes).toEqual([]);
    expect(advertencias(r)).toEqual(['FAMILIA_NO_CONFIRMADA']);
  });

  it('interpreta el código de forma auxiliar y conserva la fecha de alta de BIND (no es fecha de emisión)', () => {
    expect(r.codigo).toMatchObject({ interpretable: true, prefijoCliente: 'SCH', material: 'FILM', claveMaterial: 'PMG', resina: 'PMG', consecutivo: '001', segmentosAdicionales: [] });
    expect(r.producto.fechaAltaBind).toBe('2025-03-10T00:00:00.000Z');
    expect(JSON.stringify(r)).not.toContain('fecha_');
  });

  it('sugiere datos de plantilla solo con lo extraído', () => {
    expect(sugerirDatosPlantilla(r)).toEqual({
      codigo: 'SCHFPMG001', descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', comp_pmg: 'X', comp_cp5000: 'NA', comp_natural: 'NA', pres_rollo: 'NA', pres_paquete: 'X',
      cantidad: '200 Bolsas', unidad_medidas: 'Pulgadas (IN)', ancho: '13"', largo: '16"', calibre: '3 MIL', peso_bolsa_lb: '0.0428'
    });
  });
});

describe('interpretarProductoBind · Caso B (sin unidad ni escala de calibre)', () => {
  const r = interpretarProductoBind({ ID: 2, Code: '', Title: 'Bolsa PMG 58 X 43 Cal.200 Paquete 100 bolsas' });

  it('extrae tipo, resina, medidas, presentación y cantidad', () => {
    expect(r.campos.tipo.valor).toBe('BOLSA');
    expect(r.campos.resina.valor).toBe('PMG');
    expect(r.campos.ancho).toMatchObject({ valor: 58, origen: 'EXTRAIDO' });
    expect(r.campos.largo).toMatchObject({ valor: 43, origen: 'EXTRAIDO' });
    expect(r.campos.presentacion.valor).toBe('PAQUETE');
    expect(r.campos.cantidad.valor).toEqual({ cantidad: 100, unidad: 'BOLSAS' });
  });

  it('conserva el calibre original 200 sin convertirlo y deja la unidad/escala pendiente', () => {
    expect(r.campos.calibre).toMatchObject({ valor: { valorOriginal: '200', unidadOriginal: null, textoLiteral: '200' }, origen: 'PENDIENTE' });
    expect(JSON.stringify(r.campos.calibre)).not.toContain('MIL');
    expect(advertencias(r)).toContain('CALIBRE_SIN_UNIDAD');
  });

  it('deja pendiente la unidad dimensional, la familia y el peso ausente', () => {
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    expect(r.familia.valor).toBeNull();
    expect(r.pendientes).toEqual(expect.arrayContaining(['unidadDimensiones', 'calibre', 'pesoLb', 'codigoDcmx']));
    expect(advertencias(r)).toEqual(expect.arrayContaining(['UNIDAD_AUSENTE', 'PESO_AUSENTE', 'FAMILIA_NO_CONFIRMADA']));
  });

  it('no sugiere medidas ni calibre mientras estén pendientes', () => {
    const s = sugerirDatosPlantilla(r);
    expect(s).not.toHaveProperty('ancho');
    expect(s).not.toHaveProperty('unidad_medidas');
    expect(s).not.toHaveProperty('calibre');
    expect(s).toMatchObject({ pres_paquete: 'X', cantidad: '100 Bolsas', comp_pmg: 'X' });
  });
});

describe('interpretarProductoBind · pruebas negativas', () => {
  it('medidas incompletas: no inventa la segunda dimensión', () => {
    for (const title of ['BOLSA PMG 13 X CAL. 3 MIL', 'BOLSA PMG 13" CAL. 3 MIL PAQUETE C/200 BOLSAS', 'BOLSA PMG CAL. 3 MIL']) {
      const r = interpretarProductoBind(producto({ Title: title }));
      expect(r.campos.ancho).toMatchObject({ valor: null, origen: 'PENDIENTE' });
      expect(r.campos.largo).toMatchObject({ valor: null, origen: 'PENDIENTE' });
      expect(advertencias(r)).toContain('MEDIDAS_INCOMPLETAS');
    }
  });

  it('tres dimensiones en un producto que no es una bolsa explícita, o varias expresiones de medidas, quedan pendientes', () => {
    const tres = interpretarProductoBind(producto({ Title: 'HOJA PMG 61 x 70.9 x 24" CAL. 4 MIL' }));
    expect(tres.campos.ancho.valor).toBeNull();
    expect(tres.campos.fuelleTotal.valor).toBeNull();
    expect(advertencias(tres)).toContain('MEDIDAS_NO_ESTANDAR');
    const sinTipo = interpretarProductoBind(producto({ Title: 'PRODUCTO PMG 61 x 70.9 x 24" CAL. 4 MIL' }));
    expect(sinTipo.campos.ancho.valor).toBeNull();
    const varias = interpretarProductoBind(producto({ Title: 'BOLSA PMG 13 x 16" Y 20 x 30" CAL. 3 MIL' }));
    expect(advertencias(varias)).toContain('MEDIDAS_MULTIPLES');
  });

  it('resinas contradictorias: no elige una', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG CP5000 13 x 16" CAL. 3 MIL' }));
    expect(r.campos.resina).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    expect(advertencias(r)).toContain('RESINAS_CONTRADICTORIAS');
    expect(sugerirDatosPlantilla(r)).not.toHaveProperty('comp_pmg');
  });

  it('el código contradice al título: se conserva el título y se advierte', () => {
    const r = interpretarProductoBind(producto({ Code: 'SCHFCP5000001' }));
    expect(r.campos.resina.valor).toBe('PMG');
    expect(r.codigo.resina).toBe('CP5000');
    expect(advertencias(r)).toContain('CODIGO_RESINA_DISTINTA');
  });

  it('producto de papel: se marca fuera de alcance y no propone familia', () => {
    const r = interpretarProductoBind(producto({ Code: 'TARPPW3301', Title: 'PAPEL VCI PMG 40 x 50" PAQUETE C/100 HOJAS' }));
    expect(r.campos.tipo.valor).toBe('PAPEL');
    // Una sola advertencia por causa: el material de papel sin plantilla absorbe al aviso genérico de producto de papel.
    expect(advertencias(r)).toContain('MATERIAL_PAPEL_SIN_PLANTILLA');
    expect(advertencias(r)).not.toContain('PRODUCTO_DE_PAPEL');
    expect(r.familia.posiblesEstaFase).toEqual([]);
    expect(r.codigo.material).toBe('PAPER');
  });

  it('producto de papel solo por el título (sin código interpretable): se informa una vez como producto de papel', () => {
    const r = interpretarProductoBind(producto({ Code: 'LARG01', Title: 'PAPEL VCI PMG 40 x 50" PAQUETE C/100 HOJAS' }));
    expect(advertencias(r).filter((c) => c === 'PRODUCTO_DE_PAPEL' || c === 'MATERIAL_PAPEL_SIN_PLANTILLA').length).toBeGreaterThanOrEqual(1);
  });

  it('código de papel con título de film: advierte la contradicción', () => {
    const r = interpretarProductoBind(producto({ Code: 'TARPPW3301' }));
    expect(advertencias(r)).toContain('CODIGO_MATERIAL_DISTINTO');
    expect(r.campos.tipo.valor).toBe('BOLSA');
  });

  it('títulos no interpretables: todo queda pendiente y no se inventa nada', () => {
    for (const title of ['', '   ', 'PRODUCTO VARIOS', 'ABC-123']) {
      const r = interpretarProductoBind(producto({ Code: 'LARG01', Title: title, Weight: null }));
      expect(advertencias(r)).toContain('TITULO_NO_INTERPRETABLE');
      for (const c of ['tipo', 'resina', 'ancho', 'largo', 'unidadDimensiones', 'calibre', 'presentacion', 'cantidad'] as const) expect(r.campos[c].valor).toBeNull();
      expect(r.familia.valor).toBeNull();
    }
  });

  it('peso cero, negativo, no numérico o ausente: queda pendiente', () => {
    for (const [peso, codigo] of [[0, 'PESO_CERO'], ['0.000000', 'PESO_CERO'], [-1, 'PESO_INVALIDO'], ['abc', 'PESO_INVALIDO'], [null, 'PESO_AUSENTE'], [undefined, 'PESO_AUSENTE']] as const) {
      const r = interpretarProductoBind(producto({ Weight: peso }));
      expect(r.campos.pesoLb).toMatchObject({ valor: null, origen: 'PENDIENTE' });
      expect(advertencias(r)).toContain(codigo);
      expect(sugerirDatosPlantilla(r)).not.toHaveProperty('peso_bolsa_lb');
    }
  });
});

describe('interpretarProductoBind · reglas de título', () => {
  it('reconoce las cinco resinas y avisa cuando no tienen casilla en estas familias', () => {
    for (const [titulo, resina] of [['PMG', 'PMG'], ['CP5000', 'CP5000'], ['CP 5000', 'CP5000'], ['NAT', 'NAT'], ['ESD', 'ESD'], ['XOW', 'XOW']] as const) {
      const r = interpretarProductoBind(producto({ Title: `BOLSA ${titulo} 13 x 16" CAL. 3 MIL` }));
      expect(r.campos.resina.valor).toBe(resina);
      if (resina === 'ESD' || resina === 'XOW') {
        expect(advertencias(r)).toContain('RESINA_SIN_CASILLA');
        expect(sugerirDatosPlantilla(r)).not.toHaveProperty('comp_pmg');
      }
    }
  });

  it('reconoce Hoja, Rollo, milímetros y el signo ×; no convierte unidades', () => {
    const r = interpretarProductoBind(producto({ Title: 'HOJA CP5000 1000 × 1500 MM CAL. 80 MICRAS ROLLO C/50 HOJAS' }));
    expect(r.campos.tipo.valor).toBe('HOJA');
    expect(r.campos.ancho.valor).toBe(1000);
    expect(r.campos.largo.valor).toBe(1500);
    expect(r.campos.unidadDimensiones.valor).toBe('MM');
    expect(r.campos.calibre.valor).toEqual(expect.objectContaining({ valorOriginal: '80', unidadOriginal: 'MICRAS' }));
    expect(r.campos.presentacion.valor).toBe('ROLLO');
    expect(r.campos.cantidad.valor).toEqual({ cantidad: 50, unidad: 'HOJAS' });
    expect(r.familia.posiblesEstaFase).toEqual(['HOJA_PAQ']);
  });

  it('centímetros reconocidos, conserva valores y calibre sin conversión', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA VCI PMG 50 x 50 cm CAL.300 PAQUETE C/250 BOLSAS' }));
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: 'CM', origen: 'EXTRAIDO' });
    expect(advertencias(r)).not.toContain('UNIDAD_NO_SOPORTADA');
    expect(r.campos.calibre.valor).toEqual(expect.objectContaining({ valorOriginal: '300', unidadOriginal: null, textoLiteral: '300' }));
    expect(sugerirDatosPlantilla(r)).toHaveProperty('ancho', '50 cm');
  });

  it('unidades contradictorias entre las dos dimensiones quedan pendientes', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG 13" x 400 MM CAL. 3 MIL' }));
    expect(r.campos.unidadDimensiones.valor).toBeNull();
    expect(advertencias(r)).toContain('UNIDAD_CONTRADICTORIA');
  });

  it('cantidad sin la palabra Bolsas/Hojas: la unidad solo se sugiere según el tipo', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG 13 x 16" CAL. 3 MIL PAQUETE C/200' }));
    expect(r.campos.cantidad).toMatchObject({ valor: { cantidad: 200, unidad: 'BOLSAS' }, origen: 'SUGERIDO' });
  });

  it('presentación o cantidad contradictorias quedan pendientes', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG 13 x 16" CAL. 3 MIL PAQUETE ROLLO C/200 BOLSAS C/100 BOLSAS' }));
    expect(r.campos.presentacion.valor).toBeNull();
    expect(r.campos.cantidad.valor).toBeNull();
    expect(advertencias(r)).toEqual(expect.arrayContaining(['PRESENTACION_AMBIGUA', 'CANTIDAD_AMBIGUA']));
  });

  it('tipos contradictorios en el título no se resuelven por suposición', () => {
    const r = interpretarProductoBind(producto({ Title: 'HOJA PMG 13 x 16" CAL. 3 MIL C/100 BOLSAS' }));
    expect(r.campos.tipo.valor).toBeNull();
    expect(advertencias(r)).toContain('TIPO_AMBIGUO');
  });

  it('decimales con coma y comillas tipográficas', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG 12,5 x 18” CAL. 2,5 MIL' }));
    expect(r.campos.ancho.valor).toBe(12.5);
    expect(r.campos.unidadDimensiones.valor).toBe('IN');
    expect(r.campos.calibre.valor).toEqual(expect.objectContaining({ valorOriginal: '2,5', unidadOriginal: 'MIL' }));
  });
});

describe('interpretarCodigo', () => {
  it.each([
    ['SCHFPMG001', { prefijoCliente: 'SCH', material: 'FILM', resina: 'PMG', consecutivo: '001', segmentosAdicionales: [] }],
    ['CONFPMG04', { prefijoCliente: 'CON', material: 'FILM', resina: 'PMG', consecutivo: '04', segmentosAdicionales: [] }],
    ['AUMFCP5000012', { prefijoCliente: 'AUM', material: 'FILM', claveMaterial: 'CP', claveAmbigua: true, resina: 'CP5000', consecutivo: null, segmentosAdicionales: [] }],      // CP + dígitos: no se parte
    ['LEROYPNAT0007-B', { prefijoCliente: 'LEROY', material: 'PAPER', resina: 'NAT', consecutivo: '0007', segmentosAdicionales: ['B'] }],
    ['XFESD1', { prefijoCliente: 'X', material: 'FILM', resina: 'ESD', consecutivo: '1', segmentosAdicionales: [] }],
    ['ABCFXOW010-EXP-2', { prefijoCliente: 'ABC', material: 'FILM', resina: 'XOW', consecutivo: '010', segmentosAdicionales: ['EXP', '2'] }]
  ])('%s', (code, esperado) => {
    expect(interpretarCodigo(code)).toMatchObject({ interpretable: true, ...esperado });
  });

  it('códigos no interpretables se conservan sin inventar partes', () => {
    for (const code of ['', 'ABC', '12345', 'SCHFPMG']) expect(interpretarCodigo(code).interpretable).toBe(false);
    const r = interpretarProductoBind(producto({ Code: 'XYZ-7' }));
    expect(r.campos.codigoDcmx).toMatchObject({ valor: 'XYZ-7', origen: 'EXTRAIDO' });
    expect(advertencias(r)).toContain('CODIGO_NO_INTERPRETABLE');
  });
});

describe('interpretarProductoBind · alcance de los datos', () => {
  it('ignora costos, inventarios y precios aunque vengan en el objeto', () => {
    const r = interpretarProductoBind(producto({ Price: 123.45, Cost: 99, Stock: 1000, Inventory: { total: 5 }, UnitPrice: 7 }));
    const salida = JSON.stringify(r);
    for (const prohibido of ['123.45', '"Cost"', 'Stock', 'Inventory', 'UnitPrice', 'Price', '1000']) expect(salida).not.toContain(prohibido);
  });

  it('conserva Description sin interpretarla y no confirma jamás la familia', () => {
    const r = interpretarProductoBind(producto({ Description: '  Bolsa especial para refacciones  ' }));
    expect(r.producto.informacionAdicional).toBe('Bolsa especial para refacciones');
    expect(r.familia.valor).toBeNull();
    expect(r.familia.estado).toBe('PENDIENTE_CONFIRMACION');
    expect(r.pendientes).not.toContain('familia');
  });

  it('fecha de alta inválida o ausente es nula', () => {
    expect(interpretarProductoBind(producto({ CreationDate: 'no es fecha' })).producto.fechaAltaBind).toBeNull();
    expect(interpretarProductoBind(producto({ CreationDate: undefined })).producto.fechaAltaBind).toBeNull();
    expect(interpretarProductoBind(producto({ CreationDate: new Date('2025-01-02T00:00:00Z') })).producto.fechaAltaBind).toBe('2025-01-02T00:00:00.000Z');
  });
});

describe('interpretarProductoBind · Ancho × Fuelle total × Largo (bolsa con tres medidas)', () => {
  it('BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7 → ancho 61, fuelle total 48 (24 + 24), largo 70.9; unidad pendiente', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7' }));
    const c = r.campos;
    expect([c.ancho.valor, c.fuelleTotal.valor, c.fuelleDerecho.valor, c.fuelleIzquierdo.valor, c.largo.valor]).toEqual([61, 48, 24, 24, 70.9]);
    for (const k of ['ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo'] as const) expect(c[k].origen).toBe('SUGERIDO');   // suposición de patrón, no extracción
    expect(c.fuelleDerecho.nota).toMatch(/÷ 2/);
    expect(c.unidadDimensiones).toMatchObject({ valor: null, origen: 'PENDIENTE' });
    expect(advertencias(r)).toEqual(expect.arrayContaining(['MEDIDAS_TRES_DIMENSIONES_SUGERIDAS', 'UNIDAD_AUSENTE']));
    expect(c.calibre.valor).toMatchObject({ valorOriginal: '2.7', textoLiteral: '2.7' });
  });

  it('con unidad explícita la hereda; el fuelle impar se reparte en mitades exactas (47 → 23.5)', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG 51 X 47 X 80" CAL. 3 MIL' }));
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: 'IN', origen: 'EXTRAIDO' });
    expect([r.campos.fuelleDerecho.valor, r.campos.fuelleIzquierdo.valor]).toEqual([23.5, 23.5]);
  });

  it('solo las bolsas: «HOJA» o «BOLSA y HOJA» con tres medidas no inventan fuelles', () => {
    for (const title of ['HOJA PMG 61 X 48 X 70.9 CAL. 2.7', 'BOLSA U HOJA PMG 61 X 48 X 70.9 CAL. 2.7']) {
      const r = interpretarProductoBind(producto({ Title: title }));
      expect(r.campos.fuelleTotal.valor, title).toBeNull();
      expect(r.campos.ancho.valor, title).toBeNull();
    }
  });

  it('dos medidas: los fuelles no son pendientes del producto (no se inventan)', () => {
    const r = interpretarProductoBind(producto({ Title: 'BOLSA PMG 13 x 16" CAL. 3 MIL' }));
    expect(r.campos.fuelleDerecho.valor).toBeNull();
    expect(r.pendientes.some((p) => p.startsWith('fuelle'))).toBe(false);
  });
});
