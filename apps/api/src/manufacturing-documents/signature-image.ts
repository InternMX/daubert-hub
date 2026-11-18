import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// Validación y normalización de imágenes de firma. NO se confía en la extensión ni en el tipo declarado por el navegador: se identifica el formato por su cabecera real, se DECODIFICA
// la imagen (si no es una imagen válida, se rechaza), se limita su tamaño en píxeles y bytes, se reduce a un tamaño razonable para impresión y se vuelve a codificar como PNG. Con esto
// se descartan metadatos (EXIF, texto, perfiles), cuadros adicionales y cualquier contenido ajeno a los píxeles. Las firmas SVG y cualquier otro formato se rechazan.

export const MAX_ENTRADA_BYTES = 2 * 1024 * 1024;     // archivo recibido
export const MAX_PIXELES_ENTRADA = 16_000_000;        // 16 MP: evita bombas de descompresión
export const MAX_LADO_ENTRADA = 8000;
export const MIN_ANCHO = 24;
export const MIN_ALTO = 12;
export const MAX_ANCHO_SALIDA = 600;
export const MAX_ALTO_SALIDA = 240;
export const MAX_SALIDA_BYTES = 262_144;               // 256 KB (igual que la restricción de la base)

export interface FirmaProcesada { contenido: Buffer; tipoMime: 'image/png'; ancho: number; alto: number; bytes: number; sha256: string }

const invalida = (mensaje: string): BadRequestException => new BadRequestException({ code: 'FIRMA_INVALIDA', message: mensaje });

const FIRMA_PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const esPng = (b: Buffer): boolean => b.length > 24 && b.subarray(0, 8).equals(FIRMA_PNG);
const esJpeg = (b: Buffer): boolean => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Dimensiones declaradas en la cabecera (antes de decodificar) para no reservar memoria con una imagen enorme. */
function dimensionesPng(b: Buffer): { ancho: number; alto: number } {
  if (b.subarray(12, 16).toString('latin1') !== 'IHDR') throw invalida('La imagen PNG está dañada.');
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
}
function dimensionesJpeg(b: Buffer): { ancho: number; alto: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marcador = b[i + 1] as number;
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }
    const largo = b.readUInt16BE(i + 2);
    if ((marcador >= 0xc0 && marcador <= 0xcf) && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
    i += 2 + largo;
  }
  throw invalida('La imagen JPG está dañada.');
}

interface Rgba { ancho: number; alto: number; datos: Buffer }

function decodificar(entrada: Buffer): Rgba {
  if (esPng(entrada)) {
    const { ancho, alto } = dimensionesPng(entrada);
    limitar(ancho, alto);
    try {
      const png = PNG.sync.read(entrada);
      return { ancho: png.width, alto: png.height, datos: png.data };
    } catch { throw invalida('No se pudo leer la imagen PNG: el archivo está dañado o no es una imagen válida.'); }
  }
  if (esJpeg(entrada)) {
    const { ancho, alto } = dimensionesJpeg(entrada);
    limitar(ancho, alto);
    try {
      const j = jpeg.decode(entrada, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 16, maxMemoryUsageInMB: 256 });
      return { ancho: j.width, alto: j.height, datos: Buffer.from(j.data.buffer, j.data.byteOffset, j.data.byteLength) };
    } catch { throw invalida('No se pudo leer la imagen JPG: el archivo está dañado o no es una imagen válida.'); }
  }
  throw invalida('Solo se aceptan imágenes JPG o PNG (no SVG ni otros formatos). El tipo se verifica por el contenido del archivo, no por su extensión.');
}

function limitar(ancho: number, alto: number): void {
  if (!(ancho > 0 && alto > 0)) throw invalida('La imagen no tiene dimensiones válidas.');
  if (ancho > MAX_LADO_ENTRADA || alto > MAX_LADO_ENTRADA || ancho * alto > MAX_PIXELES_ENTRADA) throw invalida(`La imagen es demasiado grande (máximo ${MAX_LADO_ENTRADA} px por lado y 16 megapíxeles).`);
  if (ancho < MIN_ANCHO || alto < MIN_ALTO) throw invalida(`La imagen es demasiado pequeña (mínimo ${MIN_ANCHO} × ${MIN_ALTO} px).`);
}

/** Reducción por promedio de área (con alfa premultiplicado): conserva el trazo sin dientes de sierra. Nunca amplía. */
function reducir(origen: Rgba, ancho: number, alto: number): Rgba {
  if (ancho === origen.ancho && alto === origen.alto) return origen;
  const destino = Buffer.alloc(ancho * alto * 4);
  const sx = origen.ancho / ancho;
  const sy = origen.alto / alto;
  for (let y = 0; y < alto; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(origen.alto, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < ancho; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(origen.ancho, Math.ceil((x + 1) * sx)));
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * origen.ancho + xx) * 4;
          const alfa = origen.datos[i + 3] as number;
          r += (origen.datos[i] as number) * alfa; g += (origen.datos[i + 1] as number) * alfa; b += (origen.datos[i + 2] as number) * alfa; a += alfa; n += 1;
        }
      }
      const o = (y * ancho + x) * 4;
      if (a > 0) { destino[o] = Math.round(r / a); destino[o + 1] = Math.round(g / a); destino[o + 2] = Math.round(b / a); }
      destino[o + 3] = Math.round(a / n);
    }
  }
  return { ancho, alto, datos: destino };
}

/** Una firma totalmente transparente o sin ningún trazo visible no sirve. */
function tieneContenido(img: Rgba): boolean {
  for (let i = 3; i < img.datos.length; i += 4) { if ((img.datos[i] as number) > 16) return true; }
  return false;
}

export function procesarFirma(entrada: Buffer): FirmaProcesada {
  if (!Buffer.isBuffer(entrada) || entrada.length === 0) throw invalida('No se recibió ninguna imagen.');
  if (entrada.length > MAX_ENTRADA_BYTES) throw invalida('El archivo es demasiado grande (máximo 2 MB).');
  const original = decodificar(entrada);
  if (!tieneContenido(original)) throw invalida('La imagen está vacía (totalmente transparente).');
  let factor = Math.min(1, MAX_ANCHO_SALIDA / original.ancho, MAX_ALTO_SALIDA / original.alto);
  for (let intento = 0; intento < 6; intento += 1) {
    const ancho = Math.max(MIN_ANCHO, Math.round(original.ancho * factor));
    const alto = Math.max(MIN_ALTO, Math.round(original.alto * factor));
    const img = reducir(original, Math.min(ancho, original.ancho), Math.min(alto, original.alto));
    const png = new PNG({ width: img.ancho, height: img.alto });
    img.datos.copy(png.data);
    const contenido = PNG.sync.write(png, { deflateLevel: 9 });
    if (contenido.length <= MAX_SALIDA_BYTES) {
      return { contenido, tipoMime: 'image/png', ancho: img.ancho, alto: img.alto, bytes: contenido.length, sha256: createHash('sha256').update(contenido).digest('hex') };
    }
    factor *= 0.75;
  }
  throw invalida('La imagen no se puede reducir al tamaño permitido (256 KB): usa una imagen más simple.');
}
