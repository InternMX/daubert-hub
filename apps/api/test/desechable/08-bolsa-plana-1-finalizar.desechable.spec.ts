import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SheetEngineAdapter } from '../../src/manufacturing-documents/sheet-engine.port';
import { DEFAULT_PDF_RENDERER_OPTIONS, resolveChromePath } from '../../src/manufacturing-sheets/preview/sheet-pdf.renderer';
import { SheetPdfService } from '../../src/manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewService } from '../../src/manufacturing-sheets/preview/sheet-preview.service';
import { actor, crearServicio, falla, type Vista } from './entorno';

// Recorrido real del caso SCHFPMG001 · Bolsa Plana 1 (cliente escrito a mano, concentración del color 3 %) con el motor REAL (Chrome) y la instancia desechable:
// borrador guardado → «Elaboró» confirmado → finalización → REV01 → descarga → reapertura desde el historial. Los datos son los que envía el formulario web (incluye `colorConcentracion`).
const preview = new SheetPreviewService();
const chromePath = resolveChromePath();
const motor = new SheetEngineAdapter(preview, new SheetPdfService(preview, { ...DEFAULT_PDF_RENDERER_OPTIONS, chromePath }));
const { service } = crearServicio(motor);

const DATOS = {
  codigo: 'SCHFPMG001', descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', producto: 'Bolsa PLANA', fechaEmision: '2026-10-30', resinaVci: 'PMG AL 4%',
  colorNombre: 'DAUBERT AZUL AL 3%', colorHex: '#538DD5', colorConcentracion: '3', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS',
  ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '10', etiqueta: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS'
};

function textoDelPdf(contenido: Buffer): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  const ruta = join(dir, 'hoja.pdf');
  writeFileSync(ruta, contenido);
  const r = spawnSync('pdftotext', ['-layout', ruta, '-'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

describe('SCHFPMG001 · Bolsa Plana 1: finalizar de extremo a extremo con Chrome real', () => {
  it.skipIf(!chromePath)('borrador → Elaboró → finalizar → REV01 → PDF descargable con la leyenda de PRUEBA → reapertura desde el historial', async () => {
    const b = await service.crearBorrador(actor(2), { codigo: 'SCHFPMG001', familia: 'BOLSA_PLANA_1', datos: DATOS, cliente: { nombre: 'SCHAEFFLER' } } as never) as Vista;
    expect(b).toMatchObject({ estado: 'BORRADOR', cliente: { nombre: 'SCHAEFFLER', verificado: false } });

    // Sin «Elaboró» confirmado no se finaliza: se explica qué falta y el borrador queda intacto.
    const sin = await falla(service.finalizar(actor(2), b.id, b.version));
    expect(sin.status).toBe(422);
    expect(sin.body.motivos.map((m: Vista) => m.codigo)).toContain('ELABORO_SIN_CONFIRMAR');
    expect((await service.obtener(actor(2), b.id) as Vista).estado).toBe('BORRADOR');

    const confirmado = await service.actualizarBorrador(actor(2), b.id, { version: b.version, elaboroConfirmado: true } as never) as Vista;
    expect((await service.obtener(actor(2), b.id) as Vista).datos?.colorConcentracion ?? (await service.obtener(actor(2), b.id) as Vista).especificacion.datos.colorConcentracion).toBe('3');
    const fin = await service.finalizar(actor(2), b.id, confirmado.version) as Vista;
    expect(fin).toMatchObject({ estado: 'FINALIZADA', revision: 1, entorno: 'PRUEBA' });
    expect(fin.pdf.nombre).toBe('SCHFPMG001_REV01.pdf');

    // Descarga del PDF almacenado: contenido, leyenda y datos impresos.
    const d = await service.descargarPdf(actor(2), b.id);
    expect(d.contenido.subarray(0, 5).toString()).toBe('%PDF-');
    expect(d.nombre).toBe('SCHFPMG001_REV01.pdf');
    const texto = textoDelPdf(d.contenido);
    expect(texto, 'pdftotext debe estar disponible para verificar el contenido impreso').not.toBeNull();
    if (texto !== null) {
      expect(texto).toMatch(/PRUEBA/);
      expect(texto).toMatch(/NO V.LIDO PARA PRODUCCI.N/);
      expect(texto).toContain('SCHAEFFLER');
      expect(texto).toContain('DAUBERT AZUL AL 3%');
      expect(texto).toContain('SCHFPMG001');
    }

    // Reapertura: aparece en el historial del código como FINALIZADA REV01 con PDF y no admite más cambios.
    const hist = (await service.historial(actor(2), 'SCHFPMG001') as { data: Vista[] }).data;
    const fila = hist.find((h) => h.id === b.id);
    expect(fila).toMatchObject({ estado: 'FINALIZADA', revision: 1 });
    expect(fila?.pdf?.nombre).toBe('SCHFPMG001_REV01.pdf');
    const cambio = await falla(service.actualizarBorrador(actor(2), b.id, { version: fin.version, autorizoNombre: 'X' } as never));
    expect([409, 422, 403]).toContain(cambio.status);

    // Una segunda finalización (doble clic o respuesta repetida) no duplica ni altera la revisión.
    const otra = await falla(service.finalizar(actor(2), b.id, fin.version));
    expect([409, 422]).toContain(otra.status);
    const luego = await service.obtener(actor(2), b.id) as Vista;
    expect(luego).toMatchObject({ estado: 'FINALIZADA', revision: 1 });
    expect(luego.pdf.sha256).toBe(fin.pdf.sha256);
  }, 90_000);
});
