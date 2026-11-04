import { describe, expect, it } from 'vitest';
import { interpretarProductoBind, sugerirDatosPlantilla } from '../../src/manufacturing-sheets/bind-product-interpreter';
import { sugerirEspecificacion } from '../../src/manufacturing-sheets/bind-product-interpreter/specification-suggestions';

// Extracción combinada Title + Description (+ Code + Weight). No hay reglas para un producto concreto: DANFPMGOC04 es el caso de regresión principal de reglas generales.
const producto = (Code: string, Title: string, Description: string | null, Weight: number | null = 0.155) => interpretarProductoBind({ ID: 1, Code, Title, Description, Weight });
const codigos = (r: ReturnType<typeof producto>) => r.advertencias.map((a) => a.codigo);

describe('DANFPMGOC04 · caso real (Title con dos sistemas de medidas; Description con calibre, presentación y cantidad)', () => {
  const r = producto('DANFPMGOC04', 'GPN034000021 BOLSA VCI PMG 69 x 43 x 66 cm (27 x 17 x 26.4") (MINI)', 'Bolsa PMG 27 x 17 x 26.4" CAL. 200 PAQUETE 200/B');

  it('aprovecha Description: presentación, cantidad, calibre y las medidas que el Title deja ambiguas (los 9 datos que antes faltaban)', () => {
    expect(r.campos.presentacion).toMatchObject({ valor: 'PAQUETE', origen: 'EXTRAIDO', procedencia: 'DESCRIPTION' });
    expect(r.campos.cantidad.valor).toEqual({ cantidad: 200, unidad: 'BOLSAS' });
    expect(r.campos.calibre.valor).toMatchObject({ valorOriginal: '200', unidadOriginal: null, textoLiteral: '200' });                // nunca 2 MIL
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: 'IN', procedencia: 'TITLE_Y_DESCRIPTION' });
    expect(r.campos.ancho.valor).toBe(27);
    expect(r.campos.largo.valor).toBe(26.4);
    expect(r.campos.fuelleTotal.valor).toBe(17);
    expect([r.campos.fuelleDerecho.valor, r.campos.fuelleIzquierdo.valor]).toEqual([8.5, 8.5]);
    expect(r.campos.pesoLb.valor).toBe(0.155);
    expect(r.campos.resina.valor).toBe('PMG');
  });

  it('lo no confirmado queda como SUGERIDO con su explicación: unidad de «/B», tres medidas como Ancho × Fuelle × Largo y mitades de fuelle; nada se convierte', () => {
    expect(r.campos.cantidad.origen).toBe('SUGERIDO');
    expect(r.campos.cantidad.nota).toMatch(/«B» de «\/B» no está confirmada como «bolsas»/);
    for (const k of ['ancho', 'largo', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo'] as const) expect(r.campos[k].origen).toBe('SUGERIDO');
    expect(r.campos.calibre.nota).toMatch(/no se convierte/);
    expect(codigos(r)).toEqual(expect.arrayContaining(['MEDIDAS_EN_VARIOS_SISTEMAS', 'MEDIDAS_TRES_DIMENSIONES_SUGERIDAS', 'CALIBRE_SIN_UNIDAD']));
    expect(codigos(r)).not.toContain('MEDIDAS_MULTIPLES');
    expect(r.advertencias.find((a) => a.codigo === 'MEDIDAS_EN_VARIOS_SISTEMAS')?.mensaje).toContain('69 X 43 X 66 CM');         // la otra expresión se informa para compararla
  });

  it('sugiere la familia con fuelle y entrega los datos de plantilla sin inventar nada (la unidad de calibre sigue sin convertirse)', () => {
    expect(sugerirEspecificacion(r).familia.valor).toBe('BOLSA_FUELLE');
    const datos = sugerirDatosPlantilla(r);
    expect(datos).toMatchObject({ pres_paquete: 'X', pres_rollo: 'NA', cantidad: '200 Bolsas', peso_bolsa_lb: '0.1550' });
    expect(datos.calibre).toBeUndefined();                                                                                     // sin unidad no se imprime «200 MIL»
  });
});

describe('datos que solo aparecen en Description', () => {
  it('presentación, cantidad explícita, calibre con unidad y medidas de dos dimensiones con unidad', () => {
    const r = producto('XXXFPMG01', 'BOLSA VCI PMG', 'PAQUETE C/500 BOLSAS CAL. 3 MIL 20 X 30 IN', 0.5);
    expect(r.campos.presentacion).toMatchObject({ valor: 'PAQUETE', procedencia: 'DESCRIPTION' });
    expect(r.campos.cantidad).toMatchObject({ valor: { cantidad: 500, unidad: 'BOLSAS' }, origen: 'EXTRAIDO', procedencia: 'DESCRIPTION' });
    expect(r.campos.calibre).toMatchObject({ origen: 'EXTRAIDO', procedencia: 'DESCRIPTION' });
    expect(r.campos.calibre.valor).toMatchObject({ valorOriginal: '3', unidadOriginal: 'MIL' });
    expect([r.campos.ancho.valor, r.campos.largo.valor, r.campos.unidadDimensiones.valor]).toEqual([20, 30, 'IN']);
    expect(r.campos.ancho).toMatchObject({ origen: 'EXTRAIDO' });
    expect(r.pendientes).not.toContain('calibre');
    expect(codigos(r)).not.toEqual(expect.arrayContaining(['CALIBRE_AUSENTE', 'PRESENTACION_AUSENTE', 'CANTIDAD_AUSENTE', 'MEDIDAS_INCOMPLETAS']));    // ya no son «ausentes»
  });

  it('rollo con «ROLLO C/40 BOLSAS»', () => {
    const r = producto('ROLFPMG01', 'BOLSA VCI PMG 10 X 12 IN CAL. 2 MIL', 'ROLLO C/40 BOLSAS');
    expect(r.campos.presentacion.valor).toBe('ROLLO');
    expect(r.campos.cantidad.valor).toEqual({ cantidad: 40, unidad: 'BOLSAS' });
  });

  it('el Title ya completo no cambia: los datos coincidentes con Description quedan corroborados', () => {
    const r = producto('AAAFPMG01', 'BOLSA PMG 20 X 30 " CAL. 3 MIL PAQUETE C/100 BOLSAS', 'Bolsa PMG 20 x 30" cal. 3 mil paquete c/100 bolsas');
    expect(r.campos.ancho).toMatchObject({ valor: 20, origen: 'EXTRAIDO', procedencia: 'TITLE_Y_DESCRIPTION' });
    expect(r.campos.calibre.procedencia).toBe('TITLE_Y_DESCRIPTION');
    expect(r.campos.cantidad.procedencia).toBe('TITLE_Y_DESCRIPTION');
    expect(r.campos.presentacion.procedencia).toBe('TITLE_Y_DESCRIPTION');
  });

  it('la unidad de las medidas que el Title omite se toma de Description cuando los números coinciden', () => {
    const r = producto('AAAFPMG02', 'BOLSA PMG 20 X 30 CAL. 3 MIL', 'Bolsa 20 x 30 IN');
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: 'IN', procedencia: 'DESCRIPTION' });
  });
});

describe('contradicciones Title ↔ Description: no se elige una fuente', () => {
  it('calibre, cantidad y medidas distintos quedan pendientes con la advertencia correspondiente', () => {
    const r = producto('CCCFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL PAQUETE C/100 BOLSAS', 'Bolsa PMG 25 x 35 IN CAL. 2 MIL PAQUETE C/200 BOLSAS');
    expect(r.campos.calibre).toMatchObject({ valor: null, origen: 'PENDIENTE', procedencia: 'CONTRADICCION' });
    expect(r.campos.cantidad).toMatchObject({ valor: null, origen: 'PENDIENTE', procedencia: 'CONTRADICCION' });
    expect(r.campos.ancho).toMatchObject({ valor: null, origen: 'PENDIENTE', procedencia: 'CONTRADICCION' });
    expect(r.campos.largo.valor).toBeNull();
    const dist = r.advertencias.filter((a) => a.codigo === 'TITULO_DESCRIPCION_DISTINTOS');
    expect(dist.map((a) => a.nivel)).toEqual(['CONTRADICCION', 'CONTRADICCION', 'CONTRADICCION']);
    expect(dist.flatMap((a) => a.campos).sort()).toEqual(['ancho', 'calibre', 'cantidad', 'largo']);
  });

  it('presentaciones y resinas contradictorias entre Title y Description también quedan pendientes', () => {
    const r = producto('DDDFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL ROLLO', 'Bolsa CP5000 20 x 30 IN CAL. 3 MIL PAQUETE');
    expect(r.campos.presentacion).toMatchObject({ valor: null, procedencia: 'CONTRADICCION' });
    expect(r.campos.resina).toMatchObject({ valor: null, origen: 'PENDIENTE' });
  });

  it('unidades distintas con los mismos números → unidad contradictoria (sin convertir)', () => {
    const r = producto('EEEFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL', 'Bolsa 20 x 30 MM');
    expect(r.campos.unidadDimensiones).toMatchObject({ valor: null, procedencia: 'CONTRADICCION' });
    expect(codigos(r)).toContain('UNIDAD_CONTRADICTORIA');
  });
});

describe('lo que NO se infiere', () => {
  it('dos sistemas de medidas en el Title SIN corroboración de Description siguen pendientes (como antes)', () => {
    const r = producto('FFFFPMG01', 'BOLSA VCI PMG 69 x 43 x 66 cm (27 x 17 x 26.4")', null);
    expect(r.campos.ancho.valor).toBeNull();
    expect(codigos(r)).toContain('MEDIDAS_MULTIPLES');
  });

  it('si la única medida de Description no coincide con ninguna del Title, no se elige al azar', () => {
    const r = producto('FFFFPMG02', 'BOLSA VCI PMG 69 x 43 x 66 cm (27 x 17 x 26.4")', 'Bolsa 30 x 20 x 40"');
    expect(r.campos.ancho.valor).toBeNull();
    expect(codigos(r)).toContain('MEDIDAS_MULTIPLES');
  });

  it('«200/B» sin hablar de paquete o rollo no es una cantidad; con la palabra, la unidad no se asume por la «B» (se sugiere por el tipo y se avisa)', () => {
    expect(producto('GGGFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL', 'Bolsa 200/B').campos.cantidad.valor).toBeNull();
    const con = producto('GGGFPMG02', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL', 'PAQUETE 200/B');
    expect(con.campos.cantidad).toMatchObject({ valor: { cantidad: 200, unidad: 'BOLSAS' }, origen: 'SUGERIDO' });
    const sinTipo = producto('GGGFPMG03', 'PMG 20 X 30 IN CAL. 3 MIL', 'PAQUETE 200/B');
    expect(sinTipo.campos.cantidad.valor).toEqual({ cantidad: 200, unidad: null });                                           // sin tipo de producto no se inventa la unidad
  });

  it('«CAL. 200» jamás se convierte a MIL ni a otra unidad, venga de Title o de Description', () => {
    for (const r of [producto('HHHFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 200', null), producto('HHHFPMG02', 'BOLSA PMG 20 X 30 IN', 'CAL. 200')]) {
      expect(r.campos.calibre.valor).toMatchObject({ valorOriginal: '200', unidadOriginal: null, textoLiteral: '200' });
    }
  });

  it('el porcentaje de VCI no se inventa a partir de Description', () => {
    const r = producto('IIIFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL', 'Bolsa VCI PMG PAQUETE 10 BOLSAS');
    expect(sugerirEspecificacion(r).resinaVci.regla).toBe('RESINA_VCI_PMG_3PCT');                                              // solo la regla validada de la composición, no un % leído
  });

  it('un Description vacío, nulo o sin datos técnicos no cambia el resultado del Title', () => {
    const base = producto('JJJFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL PAQUETE C/100 BOLSAS', null);
    for (const d of ['', '   ', 'Producto especial para exportación']) expect(producto('JJJFPMG01', 'BOLSA PMG 20 X 30 IN CAL. 3 MIL PAQUETE C/100 BOLSAS', d).campos).toEqual(base.campos);
  });
});

describe('familias distintas de la bolsa', () => {
  it('rollo continuo: sin etiquetas ANCHO/LARGO no se supone Ancho × Largo aunque Description traiga dos medidas (no se aplican reglas de bolsa a rollos)', () => {
    const r = producto('ROCFPMG01', 'ROLLO CONTINUO PMG CAL. 3 MIL', 'Rollo 40 x 100 IN');
    expect(sugerirEspecificacion(r).familia.valor).toBe('ROLLO_CONTINUO');
    expect([r.campos.ancho.valor, r.campos.largo.valor]).toEqual([null, null]);
    expect(r.campos.fuelleTotal.valor).toBeNull();
    expect(r.campos.calibre.valor).toMatchObject({ valorOriginal: '3', unidadOriginal: 'MIL' });                                    // lo demás sí se aprovecha
  });

  it('rollo continuo con etiquetas ANCHO / LARGO en Description: se leen (misma regla que en el Title)', () => {
    const r = producto('ROCFPMG02', 'ROLLO CONTINUO PMG CAL. 3 MIL', 'ANCHO 40 IN LARGO 100 IN');
    expect([r.campos.ancho.valor, r.campos.largo.valor, r.campos.unidadDimensiones.valor]).toEqual([40, 100, 'IN']);
    expect(r.campos.ancho.procedencia).toBe('DESCRIPTION');
  });

  it('hoja: dos medidas y cantidad de Description, sin fuelles', () => {
    const r = producto('HOJFPMG01', 'HOJA VCI PMG CAL. 3 MIL', 'PAQUETE C/100 HOJAS 40 X 40 IN');
    expect(r.campos.tipo.valor).toBe('HOJA');
    expect(r.campos.cantidad.valor).toEqual({ cantidad: 100, unidad: 'HOJAS' });
    expect([r.campos.ancho.valor, r.campos.largo.valor]).toEqual([40, 40]);
    expect(r.campos.fuelleTotal.valor).toBeNull();
    expect(sugerirEspecificacion(r).familia.valor).toBe('HOJA_PAQ');
  });

  it('la familia considera marcas explícitas en Description (fuelle, COEX) además del Title', () => {
    expect(sugerirEspecificacion(producto('FUEFPMG01', 'BOLSA VCI PMG 20 X 30 IN CAL. 3 MIL', 'Bolsa con fuelle lateral')).familia.valor).toBe('BOLSA_FUELLE');
    expect(sugerirEspecificacion(producto('COEFPMG01', 'BOLSA VCI PMG 20 X 30 IN CAL. 3 MIL', 'Película COEX azul')).familia.valor).toBe('COEX');
  });
});
