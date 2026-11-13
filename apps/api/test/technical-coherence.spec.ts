import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { coloresExplicitos, revisarCoherencia } from '../src/manufacturing-sheets/preview/technical-coherence';
import { SheetPreviewRequestDto } from '../src/manufacturing-sheets/preview/sheet-preview.dto';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { denominacionEspecifica } from '../src/manufacturing-sheets/preview/product-denomination';
import { interpretarProductoBind } from '../src/manufacturing-sheets/bind-product-interpreter/bind-product-interpreter';
import { sugerirEspecificacion } from '../src/manufacturing-sheets/bind-product-interpreter/specification-suggestions';
import { huellaIncidencia, incidenciasQueBloquean } from '../src/manufacturing-documents/documents.spec-model';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coherencia del borrador (sin confirmar ni sobrescribir)', () => {
  it.each([['0.3929', '0.13097', false], ['0.7540', '0.25133', false], ['0.7540', '0.27367', true], ['0.900015', '0.30000', false], ['0.900016', '0.30000', true]])('suma capas: total %s / cada capa %s, contradicción=%s', (pesoLb, peso, contradiccion) => {
    for (const coexVariante of ['AZUL', 'VERDE']) {
      const avisos = revisarCoherencia('COEX', { pesoLb, coexVariante, pesoCapaInterior: peso, pesoCapaIntermedia: peso, pesoCapaExterior: peso });
      expect(avisos.some((a) => a.id === 'COEX_SUMA_PESOS')).toBe(contradiccion);
      if (contradiccion) expect(avisos.find((a) => a.id === 'COEX_SUMA_PESOS')).toMatchObject({ nivel: 'CONTRADICCION', mensaje: expect.stringContaining('tolerancia de 0.000015 lb') });
    }
  });
  it('no inventa una suma con total inválido, una capa vacía o fuera de las variantes autorizadas', () => {
    for (const pesoLb of ['', '0', 'inválido']) expect(revisarCoherencia('COEX', { pesoLb, coexVariante: 'AZUL', pesoCapaInterior: '0.1', pesoCapaIntermedia: '0.1', pesoCapaExterior: '0.1' }).some((a) => a.id === 'COEX_SUMA_PESOS')).toBe(false);
    expect(revisarCoherencia('COEX', { pesoLb: '1', coexVariante: 'AZUL', pesoCapaInterior: '' }).some((a) => a.id === 'COEX_SUMA_PESOS')).toBe(false);
  });
  it('fixture simulado Verde corregido; no se cambian las referencias históricas', () => {
    const casos = JSON.parse(readFileSync(resolve(__dirname, 'manufacturing-sheets/prototype/casos.json'), 'utf8')) as Array<{ id: string; datos: Record<string, string> }>;
    const verde = casos.find((c) => c.id === 'coex-verde')!.datos;
    expect(verde).toMatchObject({ pesoLb: '0.7540', pesoCapaInterior: '0.25133', pesoCapaIntermedia: '0.25133', pesoCapaExterior: '0.25133', lbVciInterior: '0.010053', lbVciIntermedia: '0.005027', lbVciExterior: '0' });
    expect(revisarCoherencia('COEX', verde).some((a) => a.id === 'COEX_SUMA_PESOS')).toBe(false);
  });
  it('denominación explícita se conserva y las incompatibles se advierten desde el backend', () => {
    const title = 'BOLSA PLANA PMG 13 X 16 IN';
    const r = interpretarProductoBind({ ID: 'simulado', Code: 'A', Title: title });
    expect(sugerirEspecificacion(r).productoEspecifico).toBe('BOLSA PLANA');
    expect(r.producto.title).toBe(title);
    expect(denominacionEspecifica('BOLSA VCI PMG')).toBeNull();
    expect(revisarCoherencia('BOLSA_FUELLE', { producto: 'BOLSA PLANA' }).some((a) => a.id === 'PRODUCTO_FAMILIA:producto')).toBe(true);
    expect(revisarCoherencia('HOJA_PAQ', { producto: 'Bolsa PLANA' }).some((a) => a.id === 'PRODUCTO_FAMILIA:producto')).toBe(false);
    expect(revisarCoherencia('TERMOENCOGIBLE', { producto: 'ROLLO VCI + UV TERMOENCOGIBLE' }).some((a) => a.id === 'PRODUCTO_FAMILIA:producto')).toBe(false);
  });
  it('color explícito, con detección conservadora y sin alterar texto', () => {
    expect(coloresExplicitos('CLIENTE AZUL BANANA BLUE NATURAL')).toEqual([]);
    expect(coloresExplicitos('COLOR: BLUE / COLOR VERDE')).toEqual(['AZUL', 'VERDE']);
    const datos = Object.freeze({ colorNombre: 'VERDE', colorHex: '#00B050', descripcion: 'Original', etiqueta: 'Original' });
    const avisos = revisarCoherencia('BOLSA_PLANA_1', datos, { title: 'BOLSA PMG COLOR AZUL', code: 'SCHFPMG001' });
    expect(avisos.find((a) => a.id === 'COLOR_AZUL:colorPreset')).toMatchObject({ nivel: 'CONTRADICCION', mensaje: expect.stringContaining('VERDE') });
    expect(datos.descripcion).toBe('Original');
    expect(datos.etiqueta).toBe('Original');
  });

  it.each([
    ['BOLSA PMG', 'SCHFPMG001', 'CORROBORADO:composicion'],
    ['BOLSA PMG', 'ITESFCP002', 'TITLE_CODE:composicion'],
    ['BOLSA NAT', 'SCHFPMG001', 'TITLE_CODE:composicion'],
    ['PAPEL PW33', 'TARPPW3301', 'FAMILIA_INCOMPATIBLE'],
    ['BOLSA ESD', 'SCHFESD001', 'RESINA_SIN_CASILLA:composicion'],
    ['BOLSA XOW', 'SCHFXOW001', 'RESINA_SIN_CASILLA:composicion'],
    ['BOLSA PMG CON FUELLE', 'SCHFPMG001', 'FAMILIA_INCOMPATIBLE']
  ])('%s / %s: %s', (title, code, id) => {
    expect(revisarCoherencia('BOLSA_PLANA_1', { composicion: 'PMG' }, { title, code }).map((a) => a.id)).toContain(id);
  });

  it('COEX mantiene las capas; natural y fuelles incompatibles se explican', () => {
    expect(revisarCoherencia('COEX', { lbVciExterior: '1' }).map((a) => a.id)).toContain('COEX_EXTERIOR:lbVciExterior');
    expect(revisarCoherencia('BOLSA_NATURAL', {}, { title: 'BOLSA PMG', code: 'SCHFPMG001', composicionSeleccionada: 'PMG' }).map((a) => a.id)).toContain('COMPOSICION_FAMILIA:composicion');
    expect(revisarCoherencia('BOLSA_FUELLE', { fuelleTotal: '10', fuelleDerecho: '4', fuelleIzquierdo: '4' }, { title: 'BOLSA PMG', code: '' }).map((a) => a.id)).toContain('FUELLE_TOTAL');
  });

  describe('color personalizado (nombre + HEX) frente a un color explícito del Title', () => {
    const titulo = { title: 'BOLSA VCI PMG 13 X 16 IN CAL. 3 MIL COLOR AZUL PAQUETE C/200 BOLSAS', code: 'DEMOFPMG001' };
    it('un nombre que no coincide con el COLOR del Title sigue produciendo la contradicción (reconocible); uno coherente no', () => {
      const incoherente = revisarCoherencia('BOLSA_PLANA_1', { colorHex: '#C00000', colorNombre: 'ROJO ESPECIAL' }, titulo).filter((a) => a.id.startsWith('COLOR_'));
      expect(incoherente).toHaveLength(1);
      expect(incoherente[0]).toMatchObject({ id: 'COLOR_AZUL:colorPreset', nivel: 'CONTRADICCION', reconocible: true });
      expect(revisarCoherencia('BOLSA_PLANA_1', { colorHex: '#3778C8', colorNombre: 'AZUL ESPECIAL CLIENTE' }, titulo).filter((a) => a.id.startsWith('COLOR_'))).toEqual([]);
    });
  });

  describe('Bolsa Natural sugiere NATURAL: un color distinto declarado por BIND no se oculta', () => {
    const azul = { title: 'BOLSA LDPE NAT AZUL 61 X 48 X 70.9 CAL. 3 MIL', code: 'NAT61' };
    const ids = (hex: string, nombre: string, ctx: { title: string; code: string }) => revisarCoherencia('BOLSA_NATURAL', { colorHex: hex, colorNombre: nombre }, ctx).filter((a) => a.id.startsWith('COLOR_'));
    it('BIND indica AZUL y la hoja conserva el azul: advierte que la familia sugiere NATURAL (reconocible, una sola vez)', () => {
      const avisos = ids('#538DD5', 'DAUBERT AZUL', azul);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ id: 'COLOR_AZUL:colorPreset', nivel: 'CONTRADICCION', reconocible: true, campos: ['colorPreset'], mensaje: expect.stringContaining('sugiere NATURAL') });
    });
    it('BIND indica AZUL y la hoja usa NATURAL: también hay una sola contradicción', () => {
      const avisos = ids('#FFF2CC', 'NATURAL', azul);
      expect(avisos.map((a) => a.id)).toEqual(['COLOR_AZUL:colorPreset']);
    });
    it('sin color en BIND, o con NATURAL, no hay contradicción; las demás familias no cambian', () => {
      expect(ids('#FFF2CC', 'NATURAL', { title: 'BOLSA LDPE NAT 61 X 48 X 70.9 CAL. 3 MIL', code: 'NAT61' })).toEqual([]);
      expect(ids('#FFF2CC', 'NATURAL', { title: 'BOLSA LDPE NATURAL 61 X 48 X 70.9', code: 'NAT61' })).toEqual([]);
      expect(revisarCoherencia('BOLSA_FUELLE', { colorHex: '#538DD5', colorNombre: 'DAUBERT AZUL' }, azul).filter((a) => a.id.startsWith('COLOR_'))).toEqual([]);
    });
  });

  it('texto extremo se detecta y conserva completo en el HTML; no reduce dibujos', async () => {
    const texto = `INICIO ${'DATOS DE PRUEBA '.repeat(25)} FINAL`;
    const r = await new SheetPreviewService().preview('BOLSA_PLANA_1', { descripcion: texto, etiqueta: texto });
    expect(r.incidencias.filter((a) => a.id.startsWith('TEXTO_EXTENSO'))).toHaveLength(2);
    expect(r.html.split(texto)).toHaveLength(3);
    expect(r.incidencias.find((a) => a.id === 'TEXTO_EXTENSO:descripcion')?.nivel).toBe('PENDIENTE');
  });

  it('el contexto nuevo rechaza propiedades extra y títulos excesivos sin habilitar HTML', async () => {
    const dto = plainToInstance(SheetPreviewRequestDto, { familia: 'COEX', datos: {}, contexto: { title: 'x'.repeat(501), code: 'A', html: '<script>x</script>' } });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
    const r = await new SheetPreviewService().preview('BOLSA_PLANA_1', { descripcion: '<img src=x onerror=alert(1)>', ancho: '-2' }, { title: 'COLOR AZUL <script>alert(1)</script>', code: '' });
    expect(r.completo).toBe(false);
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).not.toContain('<script>');
  });
});

describe('INTERPRETACIÓN DIMENSIONAL: una sola decisión sobre Ancho × Fuelle × Largo', () => {
  const contexto = { title: 'BOLSA PMG 69 X 43 X 66 CM (27 X 17 X 26.4")', code: 'DANFPMGOC04', description: 'PAQUETE 200/B CAL. 200 27 x 17 x 26.4"' };
  const datos = { ancho: '27', fuelleTotal: '17', fuelleDerecho: '8.5', fuelleIzquierdo: '8.5', largo: '26.4', unidadDimensiones: 'IN' };
  const dimensional = (d: Record<string, string>, ctx = contexto) => revisarCoherencia('BOLSA_FUELLE', d, ctx).filter((a) => a.id === 'INTERPRETACION_DIMENSIONAL');

  it('agrupa ancho, fuelles, largo y unidad en UNA contradicción reconocible; no hay avisos sueltos por fuelle', () => {
    const lista = dimensional(datos);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ nivel: 'CONTRADICCION', reconocible: true, seccion: 'medidas' });
    expect(lista[0]?.campos).toEqual(['ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo', 'unidadDimensiones']);
    expect(revisarCoherencia('BOLSA_FUELLE', datos, contexto).map((a) => a.id)).not.toContain('CONFIRMAR_FUELLE_TOTAL');
  });

  it('bloquea la finalización hasta que se reconoce con los mismos valores; cambiar una medida invalida el reconocimiento', () => {
    const inc = dimensional(datos)[0]!;
    expect(incidenciasQueBloquean([inc], datos, undefined).map((i) => i.id)).toEqual(['INTERPRETACION_DIMENSIONAL']);
    const reconocida = [{ id: inc.id, huella: huellaIncidencia(inc, datos) }];
    expect(incidenciasQueBloquean([inc], datos, reconocida)).toEqual([]);
    const cambiado = { ...datos, ancho: '28' };
    const inc2 = dimensional(cambiado)[0]!;
    expect(incidenciasQueBloquean([inc2], cambiado, reconocida).map((i) => i.id)).toEqual(['INTERPRETACION_DIMENSIONAL']);
  });

  it('no aparece sin tres medidas en BIND ni en familias sin fuelle', () => {
    expect(dimensional(datos, { title: 'BOLSA PMG 20 X 30 IN', code: 'DEMOFPMG001', description: '' })).toEqual([]);
    expect(revisarCoherencia('BOLSA_PLANA_1', datos, contexto).map((a) => a.id)).not.toContain('INTERPRETACION_DIMENSIONAL');
  });
});
