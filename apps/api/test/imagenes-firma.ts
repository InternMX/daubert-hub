import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// Imágenes sintéticas para probar firmas (sin archivos binarios en el repositorio).

/** PNG con un trazo oscuro sobre fondo transparente o blanco. */
export function pngFirma(ancho = 400, alto = 160, opciones: { fondo?: 'transparente' | 'blanco'; vacia?: boolean } = {}): Buffer {
  const png = new PNG({ width: ancho, height: alto });
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const i = (y * ancho + x) * 4;
      const blanco = opciones.fondo === 'blanco';
      png.data[i] = blanco ? 255 : 0; png.data[i + 1] = blanco ? 255 : 0; png.data[i + 2] = blanco ? 255 : 0; png.data[i + 3] = blanco ? 255 : 0;
      const trazo = !opciones.vacia && Math.abs(y - (alto / 2 + Math.sin(x / 12) * (alto / 5))) < 2;
      if (trazo) { png.data[i] = 10; png.data[i + 1] = 20; png.data[i + 2] = 120; png.data[i + 3] = 255; }
    }
  }
  return PNG.sync.write(png);
}

/** JPG con trazo oscuro sobre fondo blanco. */
export function jpgFirma(ancho = 400, alto = 160): Buffer {
  const data = Buffer.alloc(ancho * alto * 4, 255);
  for (let x = 0; x < ancho; x += 1) {
    const y = Math.round(alto / 2 + Math.sin(x / 12) * (alto / 5));
    for (let d = -1; d <= 1; d += 1) { const i = ((y + d) * ancho + x) * 4; data[i] = 10; data[i + 1] = 20; data[i + 2] = 120; }
  }
  return Buffer.from(jpeg.encode({ data, width: ancho, height: alto }, 85).data);
}

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><script>alert(1)</script><path d="M0 0L100 40"/></svg>');
