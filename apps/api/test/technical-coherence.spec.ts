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
    expect(revisarCoherencia('BOLSA_FUELLE', { producto: 'BOLSA PLANA' }).some((a) => a.id === 'PRODUCTO_FAMILIA')).toBe(true);
    expect(revisarCoherencia('HOJA_PAQ', { producto: 'Bolsa PLANA' }).some((a) => a.id === 'PRODUCTO_FAMILIA')).toBe(false);
    expect(revisarCoherencia('TERMOENCOGIBLE', { producto: 'ROLLO VCI + UV TERMOENCOGIBLE' }).some((a) => a.id === 'PRODUCTO_FAMILIA')).toBe(false);
  });
  it('color explícito, con detección conservadora y sin alterar texto', () => {
    expect(coloresExplicitos('CLIENTE AZUL BANANA BLUE NATURAL')).toEqual([]);
    expect(coloresExplicitos('COLOR: BLUE / COLOR VERDE')).toEqual(['AZUL', 'VERDE']);
    const datos = Object.freeze({ colorNombre: 'VERDE', colorHex: '#00B050', descripcion: 'Original', etiqueta: 'Original' });
    const avisos = revisarCoherencia('BOLSA_PLANA_1', datos, { title: 'BOLSA PMG COLOR AZUL', code: 'SCHFPMG001' });
    expect(avisos.find((a) => a.id === 'COLOR_AZUL')).toMatchObject({ nivel: 'CONTRADICCION', mensaje: expect.stringContaining('VERDE') });
    expect(datos.descripcion).toBe('Original');
    expect(datos.etiqueta).toBe('Original');
  });

  it.each([
    ['BOLSA PMG', 'SCHFPMG001', 'CORROBORADO_resina'],
    ['BOLSA PMG', 'ITESFCP002', 'TITLE_CODE_resina'],
    ['BOLSA NAT', 'SCHFPMG001', 'TITLE_CODE_resina'],
    ['PAPEL PW33', 'TARPPW3301', 'FAMILIA_BIND'],
    ['BOLSA ESD', 'SCHFESD001', 'RESINA_SIN_COMPOSICION'],
    ['BOLSA XOW', 'SCHFXOW001', 'RESINA_SIN_COMPOSICION'],
    ['BOLSA PMG CON FUELLE', 'SCHFPMG001', 'FAMILIA_BIND']
  ])('%s / %s: %s', (title, code, id) => {
    expect(revisarCoherencia('BOLSA_PLANA_1', { composicion: 'PMG' }, { title, code }).map((a) => a.id)).toContain(id);
  });

  it('COEX mantiene las capas; natural y fuelles incompatibles se explican', () => {
    expect(revisarCoherencia('COEX', { lbVciExterior: '1' }).map((a) => a.id)).toContain('COEX_EXTERIOR');
    expect(revisarCoherencia('BOLSA_NATURAL', {}, { title: 'BOLSA PMG', code: 'SCHFPMG001', composicionSeleccionada: 'PMG' }).map((a) => a.id)).toContain('COMPOSICION_FAMILIA');
    expect(revisarCoherencia('BOLSA_FUELLE', { fuelleTotal: '10', fuelleDerecho: '4', fuelleIzquierdo: '4' }, { title: 'BOLSA PMG', code: '' }).map((a) => a.id)).toContain('FUELLE_TOTAL');
  });

  it('texto extremo se detecta y conserva completo en el HTML; no reduce dibujos', async () => {
    const texto = `INICIO ${'DATOS DE PRUEBA '.repeat(25)} FINAL`;
    const r = await new SheetPreviewService().preview('BOLSA_PLANA_1', { descripcion: texto, etiqueta: texto });
    expect(r.avisosTecnicos.filter((a) => a.id.startsWith('TEXTO_EXTENSO'))).toHaveLength(2);
    expect(r.html.split(texto)).toHaveLength(3);
    expect(r.avisosTecnicos.find((a) => a.id === 'TEXTO_EXTENSO_descripcion')?.nivel).toBe('PENDIENTE');
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
