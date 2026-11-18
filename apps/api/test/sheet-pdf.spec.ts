import 'reflect-metadata';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { IS_PUBLIC_KEY } from '../src/security/route-access.decorators';
import { aplicarCapaBorrador, MARCA_BORRADOR, MARCA_INCOMPLETO } from '../src/manufacturing-sheets/preview/draft-layer';
import { PDF_RENDERER_OPTIONS, resolveChromePath, SheetPdfRenderer, type PdfRendererOptions } from '../src/manufacturing-sheets/preview/sheet-pdf.renderer';
import { codigoDcmxSeguro, NOMBRE_GENERICO, nombreArchivoBorrador, SheetPdfService } from '../src/manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewRequestDto } from '../src/manufacturing-sheets/preview/sheet-preview.dto';
import { SheetPreviewController } from '../src/manufacturing-sheets/preview/sheet-preview.controller';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { ConfigService } from '@nestjs/config';
import { ManufacturingSheetsEnabledGuard } from '../src/manufacturing-documents/manufacturing-enabled.guard';
// El guard de habilitación de Manufactura se inyecta con ConfigService (esbuild no emite metadata de decoradores).
Reflect.defineMetadata('design:paramtypes', [ConfigService], ManufacturingSheetsEnabledGuard);
const CONFIG_MANUFACTURA = { provide: ConfigService, useValue: { get: () => ({ enabled: true, emission: 'PRUEBA' }) } };

const SECRETO_DE_LA_HOJA = 'CODIGO-CONFIDENCIAL-9X';
const FUELLE = { codigo: SECRETO_DE_LA_HOJA, descripcion: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7', producto: 'Bolsa con Fuelle', cliente: '', fechaEmision: '2026-10-16', resinaVci: 'PMG AL 3%', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '61', fuelleDerecho: '24', fuelleIzquierdo: '24', largo: '70.9', unidadDimensiones: 'IN', calibre: '2.7', pesoLb: '1.285', etiqueta: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7' };

// Chrome simulado: un ejecutable (node) con un guion que escribe el archivo de --print-to-pdf según el modo.
const GUION = `
const fs = require('node:fs');
const modo = process.argv[2];
const salida = (process.argv.find((a) => a.startsWith('--print-to-pdf=')) || '').slice('--print-to-pdf='.length);
const bitacora = process.env.FAKE_LOG;
if (bitacora) fs.appendFileSync(bitacora, 'start\\n');
const fin = (cod) => { if (bitacora) fs.appendFileSync(bitacora, 'end\\n'); process.exit(cod); };
if (modo === 'hang') { setInterval(() => {}, 1000); }
else if (modo === 'fail') fin(3);
else if (modo === 'empty') { fs.writeFileSync(salida, ''); fin(0); }
else if (modo === 'nopdf') { fs.writeFileSync(salida, 'esto no es un pdf'); fin(0); }
else if (modo === 'slow') { setTimeout(() => { fs.writeFileSync(salida, '%PDF-1.4 simulado'); fin(0); }, 250); }
else { fs.writeFileSync(salida, '%PDF-1.4 simulado'); fin(0); }
`;
let carpeta = '';
let guion = '';
let temporales = '';                                        // directorio propio de esta suite: otras suites (en paralelo) no interfieren con la comprobación de limpieza
beforeAll(() => { carpeta = mkdtempSync(join(tmpdir(), 'chrome-simulado-')); guion = join(carpeta, 'chrome-simulado.cjs'); writeFileSync(guion, GUION); temporales = join(carpeta, 'tmp'); mkdirSync(temporales); });
afterAll(() => { rmSync(carpeta, { recursive: true, force: true }); });

const opciones = (modo: string, extra: Partial<PdfRendererOptions> = {}): PdfRendererOptions => ({ chromePath: process.execPath, argsPrefix: [guion, modo], tmpDir: temporales, timeoutMs: 5_000, maxConcurrent: 2, maxQueue: 1, maxHtmlBytes: 100_000, maxPdfBytes: 1_000_000, ...extra });
const residuos = () => readdirSync(temporales).filter((n) => n.startsWith('daubert-pdf-'));

describe('capa de borrador (dentro del documento, no una superposición de la interfaz)', () => {
  it('añade BORRADOR · SIN APROBAR (o INCOMPLETO) y el pie con SIN FIRMA, como texto fijo antes de </body>', () => {
    const html = '<html><head></head><body><p>hoja</p></body></html>';
    const completo = aplicarCapaBorrador(html, true);
    expect(completo).toContain(MARCA_BORRADOR);
    expect(completo).toContain('Firmas: SIN FIRMA');
    expect(completo).toContain('data-modo="borrador"');
    expect(completo.indexOf('marca-borrador')).toBeGreaterThan(completo.indexOf('<p>hoja</p>'));
    expect(completo.endsWith('</body></html>')).toBe(true);
    const incompleto = aplicarCapaBorrador(html, false);
    expect(incompleto).toContain(MARCA_INCOMPLETO);
    expect(incompleto).toContain('data-modo="incompleto"');
  });
  it('fuera del flujo: solo position fixed en los márgenes (no desplaza medidas, dibujos ni tablas) y sin scripts ni recursos externos', () => {
    const capa = aplicarCapaBorrador('<body></body>', true);
    expect(capa).toMatch(/position: fixed/);
    expect(capa).not.toMatch(/<script|url\(|https?:|<img|<link/i);
    expect(() => aplicarCapaBorrador('<p>sin cierre</p>', true)).toThrow(/<\/body>/);
  });
});

describe('SheetPreviewService: una sola composición para la vista previa y el PDF', () => {
  const service = new SheetPreviewService();
  it('la vista previa del navegador no lleva la capa; el modo PDF añade EXACTAMENTE la capa y nada más', async () => {
    const vista = await service.preview('BOLSA_FUELLE', FUELLE);
    const pdf = await service.preview('BOLSA_FUELLE', FUELLE, undefined, { capaBorrador: true });
    expect(vista.html).not.toContain('marca-borrador');
    expect(pdf.html.replace(/<title>[^<]*<\/title>/, '<title></title>')).toBe(aplicarCapaBorrador(vista.html.replace(/<title>[^<]*<\/title>/, '<title></title>'), vista.completo));
    expect({ ...pdf, html: '' }).toEqual({ ...vista, html: '' });                      // mismos datos, validaciones, incidencias y bloqueos
  });
  it('datos incompletos → el documento se identifica como INCOMPLETO; la modalidad bloqueada no genera documento', async () => {
    const incompleta = await service.preview('BOLSA_FUELLE', { ...FUELLE, pesoLb: '' }, undefined, { capaBorrador: true });
    expect(incompleta.completo).toBe(false);
    expect(incompleta.html).toContain(MARCA_INCOMPLETO);
    const bloqueada = await service.preview('ROLLO_CONTINUO', { ...FUELLE, modalidad: 'EXTENDIDA' }, undefined, { capaBorrador: true });
    expect(bloqueada.bloqueado).toMatch(/no está autorizada/);
    expect(bloqueada.html).toBe('');
  });
  it('los valores editables y de BIND siguen escapados en el documento que se imprime', async () => {
    const r = await service.preview('BOLSA_FUELLE', { ...FUELLE, etiqueta: '<script>alert(1)</script><img src="https://x.test/a.png">' }, undefined, { capaBorrador: true });
    expect(r.html).not.toMatch(/<script>alert|<img src="https/);
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain("default-src 'none'");                                   // CSP: sin scripts ni recursos remotos
  });
});

describe('nombre del archivo y título: el código DCMX', () => {
  it('el nombre es <CODIGO_DCMX>.pdf, conservando el código tal cual (sin familia, descripción ni prefijos)', () => {
    expect(nombreArchivoBorrador('SCHFPMG001')).toBe('SCHFPMG001.pdf');
    expect(nombreArchivoBorrador('  SCHFPMG001  ')).toBe('SCHFPMG001.pdf');
    expect(nombreArchivoBorrador('ITESFCP002')).toBe('ITESFCP002.pdf');
    expect(nombreArchivoBorrador('DCMX-01_a.b')).toBe('DCMX-01_a.b.pdf');
    expect(nombreArchivoBorrador('X'.repeat(64))).toBe(`${'X'.repeat(64)}.pdf`);
  });
  it('un código ausente o no válido (rutas, espacios, control, acentos, demasiado largo, archivos ocultos) da un nombre genérico seguro', () => {
    for (const malo of [undefined, '', '   ', 'A/B', 'A\\B', '../../etc/passwd', 'A B', 'A:B', 'A"B', 'A\r\nB', 'áéí', 'A*B', 'X'.repeat(65), '.oculto', '..', '---', 'A\u0000B']) {
      expect(nombreArchivoBorrador(malo as string | undefined)).toBe(`${NOMBRE_GENERICO}.pdf`);
    }
    expect(NOMBRE_GENERICO).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  it('los nombres reservados de Windows no se usan tal cual', () => {
    expect(nombreArchivoBorrador('CON')).toBe('_CON.pdf');
    expect(nombreArchivoBorrador('nul')).toBe('_nul.pdf');
    expect(nombreArchivoBorrador('COM1')).toBe('_COM1.pdf');
    expect(nombreArchivoBorrador('CONSOLA1')).toBe('CONSOLA1.pdf');
  });
  it('codigoDcmxSeguro devuelve el mismo código válido o null', () => {
    expect(codigoDcmxSeguro('SCHFPMG001')).toBe('SCHFPMG001');
    expect(codigoDcmxSeguro('A B')).toBeNull();
    expect(codigoDcmxSeguro(undefined)).toBeNull();
  });
  it('el título del documento (metadato del PDF) es el código; no cambia nada visible ni el resto del HTML', async () => {
    const service = new SheetPreviewService();
    const vista = await service.preview('BOLSA_FUELLE', FUELLE);
    const pdf = await service.preview('BOLSA_FUELLE', FUELLE, undefined, { capaBorrador: true, tituloPdf: 'SCHFPMG001' });
    expect(pdf.html).toContain('<title>SCHFPMG001</title>');
    expect(vista.html).toContain('<title>Hoja de Instrucción de Manufactura</title>');
    expect(pdf.html.replace('<title>SCHFPMG001</title>', '<title>Hoja de Instrucción de Manufactura</title>')).toBe(aplicarCapaBorrador(vista.html, vista.completo));
    // el encabezado visible del machote («Hoja de Instrucción de Manufactura») no se toca
    expect(pdf.html).toContain('Hoja de Instrucción de');
    const hostil = await service.preview('BOLSA_FUELLE', FUELLE, undefined, { capaBorrador: true, tituloPdf: '</title><script>1</script>' });
    expect(hostil.html).toContain('<title>&lt;/title&gt;&lt;script&gt;1&lt;/script&gt;</title>');
  });
});

describe('resolveChromePath', () => {
  it('usa la ruta configurada si existe; sin configurar, solo fuera de producción busca las rutas habituales', () => {
    expect(resolveChromePath({ MANUFACTURING_PDF_CHROME_PATH: '/opt/chrome' } as never, (r) => r === '/opt/chrome')).toBe('/opt/chrome');
    expect(resolveChromePath({ MANUFACTURING_PDF_CHROME_PATH: '/opt/inexistente' } as never, () => false)).toBeNull();
    expect(resolveChromePath({ NODE_ENV: 'development' } as never, (r) => r === '/usr/bin/chromium')).toBe('/usr/bin/chromium');
    expect(resolveChromePath({ NODE_ENV: 'production' } as never, () => true)).toBeNull();           // en producción nunca se adivina
  });
});

describe('SheetPdfRenderer (aislamiento, límites y limpieza)', () => {
  beforeEach(() => { delete process.env.FAKE_LOG; });
  afterEach(() => { delete process.env.FAKE_LOG; });

  it('sin Chrome configurado informa NO_DISPONIBLE y no ejecuta nada', async () => {
    expect(await new SheetPdfRenderer({ ...opciones('ok'), chromePath: null }).render('<html></html>')).toEqual({ kind: 'NO_DISPONIBLE' });
  });
  it('imprime HTML en un directorio temporal con perfil propio, sin red ni shell, devuelve un PDF válido y borra los temporales', async () => {
    const antes = residuos();
    const r = await new SheetPdfRenderer(opciones('ok')).render('<html><body>x</body></html>');
    expect(r.kind).toBe('OK');
    if (r.kind === 'OK') expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(residuos()).toEqual(antes);
  });
  it('pasa a Chrome los parámetros de impresión de las regresiones y el aislamiento (sin red, perfil propio, archivo local)', async () => {
    const espia = join(carpeta, 'args.json');
    const guionArgs = join(carpeta, 'args.cjs');
    writeFileSync(guionArgs, `const fs=require('node:fs');const a=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(espia)},JSON.stringify(a));fs.writeFileSync((a.find(x=>x.startsWith('--print-to-pdf='))).slice(15),'%PDF-1.4 x');`);
    await new SheetPdfRenderer({ ...opciones('ok'), argsPrefix: [guionArgs] }).render('<html></html>');
    const args = JSON.parse(readFileSync(espia, 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining(['--headless', '--disable-gpu', '--no-pdf-header-footer', '--disable-extensions', '--host-resolver-rules=MAP * ~NOTFOUND']));
    expect(args.find((a) => a.startsWith('--user-data-dir='))).toContain('daubert-pdf-');
    expect(args.at(-1)).toMatch(/^file:\/\/\/.*hoja\.html$/);
    expect(args.join(' ')).not.toMatch(/https?:\/\/|--no-sandbox|--allow-file-access/);
  });
  it.each([['fail'], ['empty'], ['nopdf']])('salida inválida (%s) → ERROR, sin PDF y sin temporales', async (modo) => {
    const antes = residuos();
    expect(await new SheetPdfRenderer(opciones(modo)).render('<html></html>')).toEqual({ kind: 'ERROR' });
    expect(residuos()).toEqual(antes);
  });
  it('un proceso que no termina se corta al vencer el tiempo (TIMEOUT) y se liberan los recursos', async () => {
    const antes = residuos();
    const t0 = Date.now();
    expect(await new SheetPdfRenderer(opciones('hang', { timeoutMs: 400 })).render('<html></html>')).toEqual({ kind: 'TIMEOUT' });
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(residuos()).toEqual(antes);
  });
  it('un ejecutable inexistente es ERROR (no una excepción) y un HTML demasiado grande se rechaza sin ejecutar Chrome', async () => {
    expect(await new SheetPdfRenderer({ ...opciones('ok'), chromePath: join(carpeta, 'no-existe.exe') }).render('<html></html>')).toEqual({ kind: 'ERROR' });
    const bitacora = join(carpeta, 'grande.log'); process.env.FAKE_LOG = bitacora;
    expect(await new SheetPdfRenderer(opciones('ok', { maxHtmlBytes: 100 })).render('x'.repeat(500))).toEqual({ kind: 'ERROR' });
    expect(existsSync(bitacora)).toBe(false);
  });
  it('concurrencia acotada: nunca más de maxConcurrent procesos a la vez y, con la cola llena, responde OCUPADO', async () => {
    const bitacora = join(carpeta, 'concurrencia.log'); process.env.FAKE_LOG = bitacora; rmSync(bitacora, { force: true });
    const renderer = new SheetPdfRenderer(opciones('slow', { maxConcurrent: 1, maxQueue: 1 }));
    const resultados = await Promise.all([renderer.render('<html></html>'), renderer.render('<html></html>'), renderer.render('<html></html>')]);
    expect(resultados.map((r) => r.kind).sort()).toEqual(['OCUPADO', 'OK', 'OK']);       // 1 activo + 1 en cola + 1 rechazado
    let activos = 0; let maximo = 0;
    for (const linea of readFileSync(bitacora, 'utf8').trim().split('\n')) { activos += linea === 'start' ? 1 : -1; maximo = Math.max(maximo, activos); }
    expect(maximo).toBe(1);
    expect((await renderer.render('<html></html>')).kind).toBe('OK');                     // el cupo se liberó
  });
});

describe('SheetPdfService', () => {
  const crear = (modo: string, extra: Partial<PdfRendererOptions> = {}) => new SheetPdfService(new SheetPreviewService(), opciones(modo, extra));
  afterEach(() => { vi.restoreAllMocks(); });

  it('genera el PDF del MISMO documento que la vista previa, con nombre seguro y marca de completo', async () => {
    const r = await crear('ok').generarBorrador('BOLSA_FUELLE', FUELLE);
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.filename).toBe(`${SECRETO_DE_LA_HOJA}.pdf`);
    expect(r.completo).toBe(true);
    const incompleto = await crear('ok').generarBorrador('BOLSA_FUELLE', { ...FUELLE, pesoLb: '' });
    expect(incompleto.filename).toBe(`${SECRETO_DE_LA_HOJA}.pdf`);                       // el nombre es siempre el código; lo incompleto se indica dentro del documento
    expect(incompleto.completo).toBe(false);
    expect((await crear('ok').generarBorrador('BOLSA_FUELLE', { ...FUELLE, codigo: 'con espacios' })).filename).toBe('HOJA_SIN_CODIGO.pdf');
  });
  it('modalidad no autorizada → 422 sin renderizar; sin renderizador → 501; ocupado → 429; tiempo → 504; fallo → 500', async () => {
    await expect(crear('ok').generarBorrador('ROLLO_CONTINUO', { ...FUELLE, modalidad: 'EXTENDIDA' })).rejects.toMatchObject({ status: 422, response: { code: 'PDF_BLOCKED' } });
    await expect(new SheetPdfService(new SheetPreviewService(), { ...opciones('ok'), chromePath: null }).generarBorrador('BOLSA_FUELLE', FUELLE)).rejects.toMatchObject({ status: 501, response: { code: 'PDF_NOT_AVAILABLE' } });
    await expect(crear('hang', { timeoutMs: 300 }).generarBorrador('BOLSA_FUELLE', FUELLE)).rejects.toMatchObject({ status: 504, response: { code: 'PDF_TIMEOUT' } });
    await expect(crear('fail').generarBorrador('BOLSA_FUELLE', FUELLE)).rejects.toMatchObject({ status: 500, response: { code: 'PDF_FAILED' } });
    const ocupado = crear('slow', { maxConcurrent: 1, maxQueue: 0 });
    const [a, b] = await Promise.allSettled([ocupado.generarBorrador('BOLSA_FUELLE', FUELLE), ocupado.generarBorrador('BOLSA_FUELLE', FUELLE)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((a.status === 'rejected' ? a.reason : (b as PromiseRejectedResult).reason)).toMatchObject({ status: 429, response: { code: 'PDF_BUSY', retryAfterSeconds: 5 } });
  });
  it('no registra el contenido de la hoja (código, textos, datos) en los logs', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await crear('fail').generarBorrador('BOLSA_FUELLE', FUELLE).catch(() => undefined);
    await crear('hang', { timeoutMs: 300 }).generarBorrador('BOLSA_FUELLE', FUELLE).catch(() => undefined);
    const salida = JSON.stringify([...warn.mock.calls, ...log.mock.calls, ...error.mock.calls]);
    expect(warn).toHaveBeenCalled();
    expect(salida).not.toContain(SECRETO_DE_LA_HOJA);
    expect(salida).not.toContain('BOLSA VCI PMG');
  });
});

describe('POST /api/manufacturing-sheets/previews/pdf', () => {
  let app: INestApplication;
  // vitest (esbuild) no emite metadatos de decoradores: se declaran los tipos del constructor (igual que bind-products.service.spec.ts).
  Reflect.defineMetadata('design:paramtypes', [SheetPreviewService, SheetPdfService], SheetPreviewController);
  Reflect.defineMetadata('design:paramtypes', [SheetPreviewService, Object], SheetPdfService);
  Reflect.defineMetadata('design:paramtypes', [SheetPreviewRequestDto, Object], SheetPreviewController.prototype, 'downloadPdf');
  const montar = async (opts: PdfRendererOptions) => {
    const modulo = await Test.createTestingModule({ controllers: [SheetPreviewController], providers: [CONFIG_MANUFACTURA, SheetPreviewService, SheetPdfService, { provide: PDF_RENDERER_OPTIONS, useValue: opts }] }).compile();
    app = modulo.createNestApplication(); app.setGlobalPrefix('api'); app.useGlobalFilters(new SafeExceptionFilter());
    const { ValidationPipe } = await import('@nestjs/common'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  };
  afterEach(async () => { await app?.close(); });
  const cuerpo = { familia: 'BOLSA_FUELLE', datos: FUELLE };

  it('entrega un PDF como adjunto: Content-Type application/pdf, nombre seguro, sin caché ni sniffing', async () => {
    await montar(opciones('ok'));
    const r = await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send(cuerpo).buffer(true).parse((res, cb) => { const partes: Buffer[] = []; res.on('data', (c: Buffer) => partes.push(c)); res.on('end', () => cb(null, Buffer.concat(partes))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe(`attachment; filename="${SECRETO_DE_LA_HOJA}.pdf"`);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-draft-complete']).toBe('1');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('rechaza HTML, rutas o propiedades desconocidas (solo acepta el DTO de la vista previa)', async () => {
    await montar(opciones('ok'));
    for (const extra of [{ html: '<script>1</script>' }, { url: 'http://interno/' }, { path: 'C:\\x.html' }]) {
      expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send({ ...cuerpo, ...extra })).status).toBe(400);
    }
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send({ ...cuerpo, datos: { ...FUELLE, descripcion: 'x'.repeat(501) } })).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send({ familia: 'OTRA', datos: {} })).status).toBe(400);
  });
  it('422 con el motivo visible si el documento no se muestra; 501 / 429 / 504 sin exponer detalles internos', async () => {
    await montar(opciones('ok'));
    const bloqueada = await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send({ familia: 'ROLLO_CONTINUO', datos: { ...FUELLE, modalidad: 'EXTENDIDA' } });
    expect(bloqueada.status).toBe(422);
    expect(bloqueada.body.message).toMatch(/no está autorizada/);
    await app.close();
    await montar({ ...opciones('ok'), chromePath: null });
    const sin = await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send(cuerpo);
    expect(sin.status).toBe(501);
    expect(JSON.stringify(sin.body)).not.toMatch(/chrome|\.exe|\\\\|tmp/i);
    await app.close();
    await montar(opciones('slow', { maxConcurrent: 1, maxQueue: 0 }));
    const [a, b] = await Promise.all([request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send(cuerpo), request(app.getHttpServer()).post('/api/manufacturing-sheets/previews/pdf').send(cuerpo)]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect((a.status === 429 ? a : b).headers['retry-after']).toBe('5');
  });
  it('la ruta está protegida por los guards globales (no es @Public) y es un POST', () => {
    const proto = SheetPreviewController.prototype as unknown as Record<string, () => void>;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.downloadPdf as never)).toBeFalsy();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SheetPreviewController)).toBeFalsy();
    expect(Reflect.getMetadata(PATH_METADATA, proto.downloadPdf as never)).toBe('pdf');
  });
});

// Con el Chrome real (si el entorno lo tiene): el documento de verdad es un PDF. La verificación completa (8 hojas, texto, posiciones y píxeles) está en test:sheets-pdf-borrador.
const CHROME = resolveChromePath();
/** /Title del diccionario de información del PDF (cadena literal o hexadecimal UTF-16BE). */
function tituloDelPdf(pdf: Buffer): string | null {
  const m = /\/Title\s*(?:<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\)])*)\))/.exec(pdf.toString('latin1'));
  if (!m) return null;
  if (m[1]) { const b = Buffer.from(m[1].replace(/\s/g, ''), 'hex'); return b.subarray(0, 2).toString('hex') === 'feff' ? b.subarray(2).swap16().toString('utf16le') : b.toString('latin1'); }
  return (m[2] ?? '').replace(/\\(.)/g, '$1');
}
describe.skipIf(!CHROME)('Chrome real', () => {
  it('imprime el borrador de una hoja como un PDF válido de una página y sin temporales', async () => {
    const antes = residuos();
    const r = await new SheetPdfService(new SheetPreviewService(), { chromePath: CHROME, tmpDir: temporales, timeoutMs: 30_000, maxConcurrent: 1, maxQueue: 0, maxHtmlBytes: 2_000_000, maxPdfBytes: 10_000_000 }).generarBorrador('BOLSA_FUELLE', FUELLE);
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.pdf.length).toBeGreaterThan(20_000);
    expect(r.pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    expect(r.filename).toBe(`${SECRETO_DE_LA_HOJA}.pdf`);
    expect(tituloDelPdf(r.pdf)).toBe(SECRETO_DE_LA_HOJA);                                  // metadato /Title = código DCMX
    expect(residuos()).toEqual(antes);
  }, 60_000);
});
