import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aplicarCapaFinalizada, type InfoFinalizada } from '../src/manufacturing-sheets/preview/draft-layer';
import { resolveChromePath, type PdfRendererOptions } from '../src/manufacturing-sheets/preview/sheet-pdf.renderer';
import { nombreArchivoFinalizado, SheetPdfService, varianteParaArchivo } from '../src/manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';

const FUELLE = { codigo: 'FUELLE61', descripcion: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7', producto: 'Bolsa con Fuelle', cliente: '', fechaEmision: '2026-10-16', resinaVci: 'PMG AL 3%', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '61', fuelleDerecho: '24', fuelleIzquierdo: '24', largo: '70.9', unidadDimensiones: 'IN', calibre: '2.7', pesoLb: '1.285', etiqueta: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7' };
const HUELLA = 'a'.repeat(64);
const INFO: InfoFinalizada = { revision: 2, finalizadoEn: '2026-10-30', elaboro: 'Ana Pérez', reviso: 'Luis Gómez', autorizo: null, huella: HUELLA };

let carpeta = ''; let guion = '';
beforeAll(() => { carpeta = mkdtempSync(join(tmpdir(), 'chrome-final-')); guion = join(carpeta, 'chrome.cjs'); writeFileSync(guion, "const fs=require('node:fs');const a=process.argv.find(x=>x.startsWith('--print-to-pdf='));fs.writeFileSync(a.slice(15),'%PDF-1.4 simulado');"); });
afterAll(() => { rmSync(carpeta, { recursive: true, force: true }); });
const opciones = (chromePath: string | null = process.execPath): PdfRendererOptions => ({ chromePath, argsPrefix: [guion], timeoutMs: 5_000, maxConcurrent: 1, maxQueue: 1, maxHtmlBytes: 2_000_000, maxPdfBytes: 10_000_000 });

describe('versión finalizada: el PDF respeta la plantilla (sin leyenda superior ni pie del sistema)', () => {
  const html = '<html><head><style>body{margin:0}</style></head><body><p>hoja</p></body></html>';
  it('no añade NADA al HTML de la plantilla: ni leyenda roja, ni pie, ni revisión, fecha, TEST, huella, «No implica aprobación oficial» o nombres', () => {
    const r = aplicarCapaFinalizada(html, INFO);
    expect(r).toBe(html);                                                                 // idéntico: ningún elemento nuevo, ningún estilo nuevo, nada que desplace o pagine
    for (const texto of ['NO VÁLIDO PARA PRODUCCIÓN', 'PRUEBA ·', 'Revisión 02', 'Finalizada en TEST', 'Huella', 'No implica aprobación oficial', 'Ana Pérez', 'Luis Gómez', 'Firmas: SIN FIRMA']) expect(r).not.toContain(texto);
    expect(r).not.toMatch(/position:\s*fixed|marca-prueba|marca-borrador|#C00000/);
  });
  it('rechaza revisión, fecha o huella no válidas y plantillas sin </body>', () => {
    expect(() => aplicarCapaFinalizada(html, { ...INFO, revision: 0 })).toThrow();
    expect(() => aplicarCapaFinalizada(html, { ...INFO, finalizadoEn: '30/10/2026' })).toThrow();
    expect(() => aplicarCapaFinalizada(html, { ...INFO, huella: 'zz' })).toThrow();
    expect(() => aplicarCapaFinalizada('<p>x</p>', INFO)).toThrow(/<\/body>/);
  });
});

describe('nombre del PDF finalizado (idéntico a manufactura.fn_nombre_pdf)', () => {
  it('CODIGO_REV01.pdf sin variante; CODIGO-VARIANTE_REV01.pdf con variante; revisión con dos dígitos como mínimo', () => {
    expect(nombreArchivoFinalizado('SCHFPMG001', null, 1)).toBe('SCHFPMG001_REV01.pdf');
    expect(nombreArchivoFinalizado('SCHFPMG001', '', 2)).toBe('SCHFPMG001_REV02.pdf');
    expect(nombreArchivoFinalizado('SMOKE001', 'Extendida', 1)).toBe('SMOKE001-EXTENDIDA_REV01.pdf');
    expect(nombreArchivoFinalizado('A', 'Doble cara.2', 12)).toBe('A-DOBLE-CARA-2_REV12.pdf');
    expect(nombreArchivoFinalizado('HOJA48', 'doblada', 105)).toBe('HOJA48-DOBLADA_REV105.pdf');
  });
  it('conserva el código tal cual y nunca produce rutas ni caracteres peligrosos', () => {
    for (const malo of ['', 'A/B', '../x', 'A B', '.oculto']) expect(() => nombreArchivoFinalizado(malo, null, 1)).toThrow();
    expect(() => nombreArchivoFinalizado('OK', null, 0)).toThrow();
    expect(nombreArchivoFinalizado('OK', '../../evil\\x', 1)).toBe('OK-EVIL-X_REV01.pdf');
    expect(nombreArchivoFinalizado('OK', 'Variante larga '.repeat(3).trim(), 1)).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(varianteParaArchivo('  ')).toBeNull();
    expect(varianteParaArchivo('---')).toBeNull();
  });
});

describe('SheetPdfService.generarFinalizada: Chrome obligatorio y desde la copia registrada', () => {
  it('sin Chrome no genera nada y responde 501 SIN componer ni renderizar (la revisión no puede quedar finalizada sin PDF)', async () => {
    const preview = new SheetPreviewService();
    const espia = vi.spyOn(preview, 'preview');
    const servicio = new SheetPdfService(preview, opciones(null));
    await expect(servicio.generarFinalizada('BOLSA_FUELLE', FUELLE, undefined, INFO)).rejects.toMatchObject({ status: 501, response: { code: 'PDF_NOT_AVAILABLE' } });
    expect(espia).not.toHaveBeenCalled();
  });
  it('con Chrome devuelve el PDF con el nombre CODIGO[-VARIANTE]_REVNN.pdf y la capa de prueba (no la de borrador)', async () => {
    const preview = new SheetPreviewService();
    const espia = vi.spyOn(preview, 'preview');
    const r = await new SheetPdfService(preview, opciones()).generarFinalizada('BOLSA_FUELLE', FUELLE, undefined, INFO, 'Doblada');
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.filename).toBe('FUELLE61-DOBLADA_REV02.pdf');
    const opts = espia.mock.calls[0]![3]!;
    expect(opts.capaFinalizada).toMatchObject({ revision: 2 });
    expect(opts.capaBorrador).toBeUndefined();
    expect(opts.tituloPdf).toBe('FUELLE61');                                           // el título interno sigue siendo el código DCMX
    const html = (await espia.mock.results[0]!.value).html as string;
    expect(html).not.toContain('NO VÁLIDO PARA PRODUCCIÓN');
    expect(html).not.toMatch(/Finalizada en TEST|No implica aprobación|marca-prueba/);       // sin leyenda ni pie del sistema
    expect(html).not.toContain('BORRADOR · SIN APROBAR');
    expect(html).toContain('<title>FUELLE61</title>');
  });
  it('no finaliza con datos incompletos ni con una modalidad bloqueada (422); un código inválido no genera nombre', async () => {
    const servicio = new SheetPdfService(new SheetPreviewService(), opciones());
    await expect(servicio.generarFinalizada('BOLSA_FUELLE', { ...FUELLE, pesoLb: '' }, undefined, INFO)).rejects.toMatchObject({ status: 422, response: { code: 'FINALIZACION_INCOMPLETA' } });
    await expect(servicio.generarFinalizada('ROLLO_CONTINUO', { ...FUELLE, modalidad: 'EXTENDIDA' }, undefined, INFO)).rejects.toMatchObject({ status: 422, response: { code: 'PDF_BLOCKED' } });
    await expect(servicio.generarFinalizada('BOLSA_FUELLE', { ...FUELLE, codigo: 'con espacios' }, undefined, INFO)).rejects.toThrow(/no es válido/);
  });
});

const CHROME = resolveChromePath();
describe.skipIf(!CHROME)('Chrome real · versión finalizada', () => {
  it('imprime un PDF válido con el título = código y sin residuos', async () => {
    const r = await new SheetPdfService(new SheetPreviewService(), { chromePath: CHROME, timeoutMs: 30_000, maxConcurrent: 1, maxQueue: 0, maxHtmlBytes: 2_000_000, maxPdfBytes: 10_000_000 }).generarFinalizada('BOLSA_FUELLE', FUELLE, undefined, INFO);
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.filename).toBe('FUELLE61_REV02.pdf');
    expect(r.pdf.length).toBeGreaterThan(20_000);
  }, 60_000);
});
