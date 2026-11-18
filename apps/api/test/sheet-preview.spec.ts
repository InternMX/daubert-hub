import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { IS_PUBLIC_KEY } from '../src/security/route-access.decorators';

const { pgPool } = vi.hoisted(() => ({ pgPool: vi.fn() }));
vi.mock('pg', () => ({ Pool: pgPool, default: { Pool: pgPool } }));

import { mapSheetData } from '../src/manufacturing-sheets/preview/sheet-data.mapper';
import { SheetPreviewController } from '../src/manufacturing-sheets/preview/sheet-preview.controller';
import { SheetPreviewRequestDto } from '../src/manufacturing-sheets/preview/sheet-preview.dto';
import { escapeHtml, SheetPreviewService, SIN_FIRMA_MARKER } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { ConfigService } from '@nestjs/config';
import { ManufacturingSheetsEnabledGuard } from '../src/manufacturing-documents/manufacturing-enabled.guard';
// El guard de habilitación de Manufactura se inyecta con ConfigService (esbuild no emite metadata de decoradores).
Reflect.defineMetadata('design:paramtypes', [ConfigService], ManufacturingSheetsEnabledGuard);
const CONFIG_MANUFACTURA = { provide: ConfigService, useValue: { get: () => ({ enabled: true, emission: 'PRUEBA' }) } };

const ROOT = resolve(__dirname, '../src/manufacturing-sheets');

// Datos del formulario con lo que el interpretador extrae de SCHFPMG001 (BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS, 0.0428 lb) + el color elegido por el usuario.
const SCHF = {
  codigo: 'SCHFPMG001', descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS',
  ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.0428', cliente: 'Schneider Electric', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5'
};

describe('mapSheetData', () => {
  it('traduce SCHFPMG001 a los datos de la plantilla sin inventar nada', () => {
    const m = mapSheetData('BOLSA_PLANA_1', SCHF);
    expect(m.datos).toMatchObject({
      codigo: 'SCHFPMG001', comp_pmg: 'X', comp_cp5000: 'NA', comp_natural: 'NA', pres_rollo: 'NA', pres_paquete: 'X', cantidad: '200 Bolsas', unidad_medidas: 'Pulgadas (IN)',
      ancho: '13"', largo: '16"', calibre: '3 MIL', peso_bolsa_lb: '0.0428', cliente: 'Schneider Electric', fecha_: '', etiqueta: '', resina_vci: '', color: 'DAUBERT AZUL AL 2%'
    });
    expect(m.colorBolsaHex).toBe('#538DD5');
    expect(m.faltantes).toEqual([]);
    expect(m.datos).not.toHaveProperty('hoja_doblada');
  });

  it('sin selección no imprime NA ni X; el peso/medidas inválidos se omiten con advertencia', () => {
    const m = mapSheetData('BOLSA_PLANA_1', { codigo: 'A', pesoLb: 'abc', ancho: '-3', unidadDimensiones: 'MM', cantidad: '1.5' });
    expect(m.datos).toMatchObject({ comp_pmg: '', comp_cp5000: '', pres_rollo: '', peso_bolsa_lb: '', ancho: '', cantidad: '' });
    expect(m.advertencias.length).toBeGreaterThanOrEqual(3);
    expect(m.faltantes).toEqual(expect.arrayContaining(['Composición', 'Presentación', 'Color del dibujo']));
  });

  it('Hoja Paq agrega la modalidad (y la exige); Bolsa Plana 1 la ignora con advertencia', () => {
    const hp = mapSheetData('HOJA_PAQ', { ...SCHF, modalidad: 'EXTENDIDA' });
    expect(hp.datos).toMatchObject({ hoja_doblada: 'NA', hoja_extendida: 'X' });
    expect(mapSheetData('HOJA_PAQ', SCHF).faltantes).toContain('Hoja doblada o extendida');
    expect(mapSheetData('BOLSA_PLANA_1', { ...SCHF, modalidad: 'DOBLADA' }).advertencias.join(' ')).toMatch(/no aplica/);
  });

  it('formatea milímetros, fecha de emisión y color inválido', () => {
    const m = mapSheetData('BOLSA_PLANA_1', { ...SCHF, unidadDimensiones: 'MM', fechaEmision: '2026-10-15', colorHex: 'azul' });
    expect(m.datos).toMatchObject({ ancho: '13 mm', unidad_medidas: 'Milímetros (MM)', fecha_: '15/10/2026' });
    expect(m.colorBolsaHex).toBeNull();
    expect(m.advertencias.join(' ')).toMatch(/#RRGGBB/);
  });
});

describe('SheetPreviewService (plantillas reales)', () => {
  const service = new SheetPreviewService();
  beforeEach(() => { pgPool.mockClear(); });

  it('Bolsa Plana 1 con los datos de SCHFPMG001: HTML real de la plantilla aprobada, borrador y SIN FIRMA', async () => {
    const r = await service.preview('BOLSA_PLANA_1', SCHF);
    expect(r).toMatchObject({ familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [] });
    for (const texto of ['SCHFPMG001', 'BOLSA VCI PMG 13 x 16&quot; CAL. 3 MIL PAQUETE C/200 BOLSAS', '200 Bolsas', '0.0428', '3 MIL', 'Pulgadas (IN)', 'Dibujo Hoja', 'Notas: En caso de que se fabrique con sello de fondo', 'fill="#538DD5"']) {
      expect(r.html).toContain(texto);
    }
    expect(r.html).toContain('id="comp_pmg" data-valor="X"');
    expect(r.html).toContain(`id="firma_elaboro">${SIN_FIRMA_MARKER}</div>`);   // ambas firmas son el marcador SIN FIRMA
    expect(r.html).toContain(`id="firma_aprobo">${SIN_FIRMA_MARKER}</div>`);
    expect(r.html).not.toMatch(/\{\{(?!color_bolsa_hex)/);           // ningún placeholder pendiente
    expect(r.html).toContain('data:image/jpeg;base64,');
    expect(r.html).not.toContain('.\\images\\');
  });

  it('modificar ancho, largo, calibre o cantidad cambia el HTML; los datos de entrada no se alteran', async () => {
    const original = Object.freeze({ ...SCHF });
    const base = await service.preview('BOLSA_PLANA_1', original);
    const cambios: Array<[Partial<typeof SCHF>, string]> = [[{ ancho: '14.5' }, '14.5&quot;'], [{ largo: '20' }, '20&quot;'], [{ calibre: '4 MIL' }, '4 MIL'], [{ cantidad: '300' }, '300 Bolsas']];
    for (const [cambio, esperado] of cambios) {
      const r = await service.preview('BOLSA_PLANA_1', { ...original, ...cambio });
      expect(r.html).not.toBe(base.html);
      expect(r.html).toContain(esperado);
    }
    expect(original).toEqual(SCHF);
  });

  it('Hoja Paq utiliza su plantilla específica (Dibujo Hoja de 160 pt y modalidad)', async () => {
    const hp = await service.preview('HOJA_PAQ', { ...SCHF, modalidad: 'DOBLADA' });
    const bp = await service.preview('BOLSA_PLANA_1', SCHF);
    expect(hp.html).toContain('viewBox="0 0 400.4 189"');            // sheet-drawing.hoja-paq
    expect(hp.html).toContain('id="hoja_doblada" data-valor="X"');
    expect(hp.html).toContain('Hoja:');
    expect(hp.html).not.toContain('Notas: En caso de que se fabrique con sello de fondo');
    expect(bp.html).not.toContain('viewBox="0 0 400.4 189"');
    expect(hp.html).not.toBe(bp.html);
    expect(hp.completo).toBe(true);
  });

  it('los campos faltantes generan advertencias y no se inventan valores ni dibujos', async () => {
    const r = await service.preview('HOJA_PAQ', { codigo: 'SCHFPMG001' });
    expect(r.completo).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['Descripción', 'Composición', 'Presentación', 'Cantidad', 'Ancho', 'Largo', 'Peso (lb)', 'Color del dibujo', 'Hoja doblada o extendida']));
    expect(r.html).toContain('{{color_bolsa_hex}}');                 // sin color: la plantilla lo muestra gris (no se inventa uno)
    expect(r.html).not.toMatch(/id="(comp|pres|hoja)_[a-z0-9_]+" data-valor="(X|NA)"/);   // ninguna selección inventada
    expect(r.html).toContain('SCHFPMG001');
  });

  it('las entradas maliciosas se escapan: sin scripts, sin atributos activos y sin re-interpretar placeholders', async () => {
    const payloads = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'; DROP TABLE x; --", '{{color_bolsa_hex}}{{codigo}}', '</style><script>x</script>', 'javascript:alert(1)'];
    for (const payload of payloads) {
      const r = await service.preview('BOLSA_PLANA_1', { ...SCHF, descripcion: payload, cliente: payload, etiqueta: payload, producto: payload, colorNombre: payload, resinaVci: payload });
      const sinMeta = r.html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
      expect(sinMeta).not.toMatch(/<script/i);
      expect(sinMeta).not.toMatch(/<img[^>]*onerror/i);
      expect(sinMeta).not.toMatch(/<(img|svg|iframe|a)[ >][^>]*\son\w+\s*=/i);
      expect(sinMeta).toContain(escapeHtml(payload));
    }
    const r = await service.preview('BOLSA_PLANA_1', { ...SCHF, descripcion: '{{codigo}}' });
    expect(r.html).toContain('{{codigo}}');                           // texto literal, no sustituido
    const colorMalo = await service.preview('BOLSA_PLANA_1', { ...SCHF, colorHex: '#538DD5" onload="alert(1)' });
    expect(colorMalo.html).not.toContain('onload');
    expect(colorMalo.advertencias.join(' ')).toMatch(/#RRGGBB/);
  });

  it('endurece el HTML para el iframe: CSP sin scripts ni red y sin contenido activo en la plantilla', async () => {
    const r = await service.preview('BOLSA_PLANA_1', SCHF);
    expect(r.html).toMatch(/Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:/);
    expect(r.html).not.toMatch(/https?:\/\//);
    expect(r.html).not.toMatch(/<(iframe|object|embed|link|form)\b/i);
  });

  it('reutiliza el compositor existente: la plantilla compuesta coincide con la salida de compose-template.mjs', async () => {
    const cli = execFileSync('node', [resolve(ROOT, 'tools/compose-template.mjs'), '--source', resolve(ROOT, 'templates/hoja-paq/hoja-paq.template.html'), '--out', resolve(process.env.TEMP ?? '/tmp', 'hp-preview-check.html')], { encoding: 'utf8' });
    expect(cli).toContain('Plantilla compuesta');
    const composed = readFileSync(resolve(process.env.TEMP ?? '/tmp', 'hp-preview-check.html'), 'utf8');
    const r = await service.preview('HOJA_PAQ', { ...SCHF, modalidad: 'DOBLADA' });
    // Los fragmentos fijos de la plantilla compuesta (sin placeholders) aparecen idénticos en la vista previa.
    for (const fragmento of ['<main class="hoja">', 'id="seccion-dibujo-hoja"', 'class="dibujo-hoja-caja"']) {
      expect(composed).toContain(fragmento);
      expect(r.html).toContain(fragmento);
    }
  });

  it('no usa PostgreSQL', async () => {
    await service.preview('BOLSA_PLANA_1', SCHF);
    expect(pgPool).not.toHaveBeenCalled();
    for (const archivo of ['preview/sheet-preview.service.ts', 'preview/sheet-preview.controller.ts', 'preview/sheet-data.mapper.ts']) {
      expect(readFileSync(resolve(ROOT, archivo), 'utf8'), archivo).not.toMatch(/from 'pg'|DatabaseService|DatabaseModule|INSERT\s|UPDATE\s|DELETE\s|writeFile/);
    }
  });
});

describe('POST /api/manufacturing-sheets/previews', { timeout: 20_000 }, () => {
  let app: INestApplication;
  beforeEach(async () => {
    Reflect.defineMetadata('design:paramtypes', [SheetPreviewService], SheetPreviewController);
    Reflect.defineMetadata('design:paramtypes', [SheetPreviewRequestDto], SheetPreviewController.prototype, 'create');
    const modulo = await Test.createTestingModule({ controllers: [SheetPreviewController], providers: [CONFIG_MANUFACTURA, SheetPreviewService] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });

  const post = (body: unknown) => request(app.getHttpServer()).post('/api/manufacturing-sheets/previews').send(body as object);

  it('devuelve la vista previa con borrador y SIN FIRMA (200, sin crear nada)', async () => {
    const res = await post({ familia: 'BOLSA_PLANA_1', datos: SCHF });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true });
    expect(res.body.data.html).toContain('SCHFPMG001');
    expect(pgPool).not.toHaveBeenCalled();
  });

  it('valida la entrada: familia desconocida, propiedades no permitidas (incluidas firmas), enums y longitudes', async () => {
    for (const body of [
      { familia: 'COEX_AZUL', datos: {} },     // Azul y Verde son variantes de la familia COEX, no familias
      { familia: 'HOJA_PAQ' },
      { familia: 'HOJA_PAQ', datos: { firma: '<img src=x>' } },
      { familia: 'HOJA_PAQ', datos: { bloque_firma_elaboro: '<img>' } },
      { familia: 'HOJA_PAQ', datos: { composicion: 'ESD' } },
      { familia: 'HOJA_PAQ', datos: { descripcion: 'x'.repeat(501) } },
      { familia: 'HOJA_PAQ', datos: { cliente: 42 } },
      { familia: 'HOJA_PAQ', datos: {}, contexto: { title: 'x'.repeat(501), code: 'A' } },
      { familia: 'HOJA_PAQ', datos: {}, contexto: { title: 'COLOR AZUL', code: 'A', html: '<script>x</script>' } },
      { familia: 'HOJA_PAQ', datos: {}, contexto: { title: 123, code: 'A' } },
      { familia: 'HOJA_PAQ', datos: {}, contexto: { title: 'COLOR AZUL', code: 'A'.repeat(65) } },
      { familia: 'HOJA_PAQ', datos: {}, extra: true }
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('el contexto original activa coherencia en HTTP sin insertarse como contenido activo ni modificar el borrador', async () => {
    const datos = { ...SCHF, colorNombre: 'VERDE', colorHex: '#00B050', cliente: '' };
    const res = await post({ familia: 'BOLSA_PLANA_1', datos, contexto: { title: 'BOLSA PMG COLOR AZUL <script>alert(1)</script>', code: 'SCHFPMG001' } });
    expect(res.status).toBe(200);
    expect(res.body.data.incidencias).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'COLOR_AZUL:colorPreset', nivel: 'CONTRADICCION' })]));
    expect(res.body.data.html).not.toContain('<script>');
    expect(res.body.data.html).toContain('fill="#00B050"');
    expect(res.body.data.pendientesEmision).toContain('Cliente');
    expect(pgPool).not.toHaveBeenCalled();
  });

  it('la ruta es autenticada (no @Public) y sigue la convención /api/manufacturing-sheets/…', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SheetPreviewController)).toBe('manufacturing-sheets/previews');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SheetPreviewController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SheetPreviewController.prototype.create)).toBeUndefined();
  });
});

describe('Fase 3.1 · contrato y borrador HTML', () => {
  const service = new SheetPreviewService();
  const celda = (html: string, id: string): string => new RegExp(`id="${id}"[^>]*>([^]*?)</td>`).exec(html)?.[1]?.trim() ?? '';

  it.each([['200'], ['250'], ['300'], ['2 MIL'], ['2.7'], ['3 MIL']])('el calibre confirmado «%s» se imprime exactamente, sin sufijos ocultos', async (calibre) => {
    const m = mapSheetData('BOLSA_PLANA_1', { ...SCHF, calibre });
    expect(m.datos.calibre).toBe(calibre);
    expect(m.advertencias).toEqual([]);
    const r = await service.preview('BOLSA_PLANA_1', { ...SCHF, calibre });
    expect(celda(r.html, 'calibre')).toBe(calibre);
    expect(r.completo).toBe(true);
  });

  it('un calibre sin número se advierte pero se imprime tal como se capturó (no se corrige)', () => {
    const m = mapSheetData('BOLSA_PLANA_1', { ...SCHF, calibre: 'MIL' });
    expect(m.datos.calibre).toBe('MIL');
    expect(m.advertencias.join(' ')).toMatch(/no contiene ningún número/);
  });

  it('el texto del color es obligatorio para la vista previa técnica; el cliente NO (demo): queda como pendiente de emisión', () => {
    const m = mapSheetData('BOLSA_PLANA_1', { ...SCHF, cliente: '', colorNombre: '' });
    expect(m.faltantes).toEqual(['Color']);
    expect(m.pendientesEmision).toEqual(['Cliente']);
    expect(mapSheetData('BOLSA_PLANA_1', SCHF).pendientesEmision).toEqual([]);
  });

  it('el texto del color y el dibujo vienen del mismo estado: cambiar el color cambia ambos en el HTML real', async () => {
    const azul = await service.preview('BOLSA_PLANA_1', SCHF);
    const verde = await service.preview('BOLSA_PLANA_1', { ...SCHF, colorNombre: 'VERDE', colorHex: '#00B050' });
    expect(celda(azul.html, 'color')).toBe('DAUBERT AZUL AL 2%');
    expect(celda(verde.html, 'color')).toBe('VERDE');
    expect(azul.html).toContain('fill="#538DD5"');
    expect(verde.html).toContain('fill="#00B050"');
    expect(verde.html).not.toContain('fill="#538DD5"');
  });

  it('«Otro» con hexadecimal inválido: el dibujo queda sin color y se advierte; con uno válido se aplica', async () => {
    const malo = await service.preview('BOLSA_PLANA_1', { ...SCHF, colorNombre: 'ROJO', colorHex: '#GG0000' });
    expect(malo.advertencias.join(' ')).toMatch(/#RRGGBB/);
    expect(malo.html).not.toContain('fill="#GG0000"');
    const bueno = await service.preview('BOLSA_PLANA_1', { ...SCHF, colorNombre: 'ROJO', colorHex: '#C00000' });
    expect(bueno.html).toContain('fill="#C00000"');
    expect(celda(bueno.html, 'color')).toBe('ROJO');
  });

  it('la etiqueta con el Title completo (número de ítem incluido) se imprime sin truncar y es independiente de la descripción', async () => {
    const titulo = `A 15M3M6 - ${'BOLSA VCI PMG '.repeat(12)}13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS`;
    const r = await service.preview('BOLSA_PLANA_1', { ...SCHF, etiqueta: titulo, descripcion: 'Descripción corta' });
    expect(celda(r.html, 'etiqueta')).toContain(titulo.replace(/"/g, '&quot;'));
    expect(celda(r.html, 'descripcion')).toContain('Descripción corta');
    expect(r.html).not.toContain('…');
  });

  it('resina VCI y fecha sugeridas se imprimen como se confirmaron; no se mezclan con el color', async () => {
    const r = await service.preview('BOLSA_PLANA_1', { ...SCHF, resinaVci: 'PMG AL 3%', fechaEmision: '2026-10-16' });
    expect(celda(r.html, 'resina_vci')).toBe('PMG AL 3%');
    expect(celda(r.html, 'fecha')).toBe('16/10/2026');
    expect(celda(r.html, 'color')).toBe('DAUBERT AZUL AL 2%');
  });
});
