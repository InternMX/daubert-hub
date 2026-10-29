import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SheetEngineAdapter } from '../../src/manufacturing-documents/sheet-engine.port';
import { DEFAULT_PDF_RENDERER_OPTIONS, resolveChromePath } from '../../src/manufacturing-sheets/preview/sheet-pdf.renderer';
import { SheetPdfService } from '../../src/manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewService } from '../../src/manufacturing-sheets/preview/sheet-preview.service';
import { actor, codigoUnico, falla, crearServicio, poolAdmin, type Vista } from './entorno';

// Integración con el MOTOR REAL de hojas (SheetPreviewService + SheetPdfService + Chrome local) y la instancia PostgreSQL desechable: la hoja se guarda, se finaliza y su PDF sale de la
// copia guardada. Se omite (no falla) si este equipo no tiene Chrome: en ese caso finalizar es imposible por diseño (501) y así lo comprueba la prueba de abajo.
const preview = new SheetPreviewService();
const chromePath = resolveChromePath();
const motor = new SheetEngineAdapter(preview, new SheetPdfService(preview, { ...DEFAULT_PDF_RENDERER_OPTIONS, chromePath }));
const { service } = crearServicio(motor);
const FUELLE = { descripcion: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7', producto: 'Bolsa con Fuelle', cliente: '', fechaEmision: '2026-10-16', resinaVci: 'PMG AL 3%', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '61', fuelleDerecho: '24', fuelleIzquierdo: '24', largo: '70.9', unidadDimensiones: 'IN', calibre: '2.7', pesoLb: '1.285', etiqueta: 'BOLSA VCI PMG 61 X 48 X 70.9 CAL. 2.7' };

describe('motor real de hojas + gestor documental (instancia desechable)', () => {
  it.skipIf(!chromePath)('guarda la hoja, la finaliza y almacena el PDF generado por Chrome desde la copia guardada', async () => {
    const codigo = codigoUnico('REAL');
    const borrador = await service.crearBorrador(actor(2), { codigo, variante: 'Doblada', familia: 'BOLSA_FUELLE', datos: { ...FUELLE, codigo }, cliente: { empresaId: '1' } } as never) as Vista;
    const confirmado = await service.actualizarBorrador(actor(2), borrador.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
    const finalizado = await service.finalizar(actor(2), borrador.id, confirmado.version) as Vista;
    expect(finalizado).toMatchObject({ estado: 'FINALIZADA', revision: 1, entorno: 'PRUEBA' });
    expect(finalizado.pdf.nombre).toBe(`${codigo}-DOBLADA_REV01.pdf`);
    const d = await service.descargarPdf(actor(3), borrador.id);
    expect(d.contenido.subarray(0, 5).toString()).toBe('%PDF-');
    expect(d.contenido.length).toBeGreaterThan(5_000);
    expect(createHash('sha256').update(d.contenido).digest('hex')).toBe(finalizado.pdf.sha256);
    const fila = await poolAdmin.query('SELECT p.bytes, p.pdf_sha256, p.nombre_archivo FROM manufactura.pdfs p JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [borrador.id]);
    expect(fila.rows[0]).toMatchObject({ bytes: d.contenido.length, pdf_sha256: finalizado.pdf.sha256 });
  }, 60_000);

  it.skipIf(!chromePath)('una hoja incompleta se rechaza con los datos que faltan, sin tocar el estado ni generar PDF', async () => {
    const codigo = codigoUnico('REAL');
    const b = await service.crearBorrador(actor(2), { codigo, familia: 'BOLSA_FUELLE', datos: { codigo, descripcion: 'Incompleta' }, cliente: { nombre: 'Cliente manual' } } as never) as Vista;
    const c = await service.actualizarBorrador(actor(2), b.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
    const e = await falla(service.finalizar(actor(2), b.id, c.version));
    expect(e.status).toBe(422);
    expect(e.body.motivos.map((m: Vista) => m.codigo)).toContain('HOJA_INCOMPLETA');
    expect((await service.obtener(actor(2), b.id) as Vista).estado).toBe('BORRADOR');
  }, 60_000);

  it.skipIf(!!chromePath)('sin Chrome en este equipo: finalizar responde 501 y deja el borrador intacto', async () => {
    const codigo = codigoUnico('REAL');
    const b = await service.crearBorrador(actor(2), { codigo, familia: 'BOLSA_FUELLE', datos: { ...FUELLE, codigo }, cliente: { nombre: 'Cliente manual' } } as never) as Vista;
    const c = await service.actualizarBorrador(actor(2), b.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
    const e = await falla(service.finalizar(actor(2), b.id, c.version));
    expect(e.status).toBe(501);
    expect((await service.obtener(actor(2), b.id) as Vista).estado).toBe('BORRADOR');
  });
});
