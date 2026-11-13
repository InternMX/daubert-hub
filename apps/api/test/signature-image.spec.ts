import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { BadRequestException } from '@nestjs/common';
import { MAX_ALTO_SALIDA, MAX_ANCHO_SALIDA, MAX_SALIDA_BYTES, procesarFirma } from '../src/manufacturing-documents/signature-image';
import { jpgFirma, pngFirma, SVG } from './imagenes-firma';

const rechaza = (entrada: Buffer, patron: RegExp): void => {
  try { procesarFirma(entrada); } catch (e) { expect(e).toBeInstanceOf(BadRequestException); expect(JSON.stringify((e as BadRequestException).getResponse())).toMatch(patron); return; }
  throw new Error('Se esperaba un rechazo');
};

describe('procesamiento seguro de imágenes de firma', () => {
  it('acepta un PNG válido: lo vuelve a codificar como PNG, sin ampliar y dentro del límite de bytes', () => {
    const r = procesarFirma(pngFirma(400, 160));
    expect(r.tipoMime).toBe('image/png');
    expect([r.ancho, r.alto]).toEqual([400, 160]);                       // cabe en 600 × 240: no se modifica el tamaño
    expect(r.bytes).toBeLessThanOrEqual(MAX_SALIDA_BYTES);
    expect(r.contenido.subarray(1, 4).toString()).toBe('PNG');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('acepta un JPG válido y lo entrega como PNG', () => {
    const r = procesarFirma(jpgFirma(500, 200));
    expect(r.tipoMime).toBe('image/png');
    expect(PNG.sync.read(r.contenido).width).toBe(r.ancho);
  });

  it('reduce una imagen grande conservando la proporción y sin pasar de 600 × 240', () => {
    const r = procesarFirma(pngFirma(2400, 600, { fondo: 'blanco' }));
    expect(r.ancho).toBeLessThanOrEqual(MAX_ANCHO_SALIDA);
    expect(r.alto).toBeLessThanOrEqual(MAX_ALTO_SALIDA);
    expect(Math.abs(r.ancho / r.alto - 4)).toBeLessThan(0.1);
  });

  it('el trazo sigue visible tras reducir (se conserva la apariencia)', () => {
    const r = procesarFirma(pngFirma(1800, 720, { fondo: 'blanco' }));
    const png = PNG.sync.read(r.contenido);
    let oscuros = 0;
    for (let i = 0; i < png.data.length; i += 4) if ((png.data[i] as number) < 200) oscuros += 1;
    expect(oscuros).toBeGreaterThan(50);
  });

  it('rechaza SVG (aunque se declare .png/.jpg: se mira el contenido, no la extensión)', () => rechaza(SVG, /Solo se aceptan imágenes JPG o PNG/));
  it('rechaza archivos que no son imágenes o están dañados', () => {
    rechaza(Buffer.from('MZ\x90\x00 esto es un ejecutable'), /Solo se aceptan imágenes/);
    rechaza(Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from('basura-basura-basura-basura')]), /FIRMA_INVALIDA/);
    rechaza(Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.from('no es un jpg de verdad, solo la cabecera')]), /FIRMA_INVALIDA/);
  });
  it('rechaza imágenes vacías, minúsculas o demasiado grandes (bytes y píxeles)', () => {
    rechaza(Buffer.alloc(0), /ninguna imagen/);
    rechaza(pngFirma(400, 160, { vacia: true }), /vacía/);
    rechaza(pngFirma(10, 6), /demasiado pequeña/);
    rechaza(Buffer.concat([pngFirma(400, 160), Buffer.alloc(2 * 1024 * 1024)]), /demasiado grande/);
    // Cabecera que declara 20 000 × 20 000 px: se rechaza ANTES de decodificar (no reserva memoria).
    const bomba = Buffer.from(pngFirma(400, 160));
    bomba.writeUInt32BE(20000, 16); bomba.writeUInt32BE(20000, 20);
    rechaza(bomba, /demasiado grande/);
  });
});
