import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { InfoFinalizada, ResponsableImpreso } from '../src/manufacturing-sheets/preview/draft-layer';
import { FAMILY_CODES } from '../src/manufacturing-sheets/preview/family-registry';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { pngFirma } from './imagenes-firma';

// Composición del bloque de firmas de los PDF finalizados: 1 a 3 responsables con función, nombre e imagen opcional, en TODAS las familias, sin tocar las plantillas aprobadas.
const servicio = new SheetPreviewService();
const imagen = pngFirma(300, 100, { fondo: 'blanco' });
const firma = { tipoMime: 'image/png', contenido: imagen, sha256: 'a'.repeat(64) };
const R = (posicion: number, funcion: ResponsableImpreso['funcion'], nombre: string, conFirma: boolean): ResponsableImpreso => ({ posicion, funcion, nombre, firma: conFirma ? firma : null });
const info = (responsables?: ResponsableImpreso[]): InfoFinalizada => ({ revision: 1, finalizadoEn: '2026-11-03', elaboro: 'General Dos', huella: 'b'.repeat(64), ...(responsables ? { responsables } : {}) });
const compuesto = async (familia: (typeof FAMILY_CODES)[number], responsables?: ResponsableImpreso[]): Promise<string> =>
  (await servicio.preview(familia, { codigo: 'SIGTEST', descripcion: 'x' }, undefined, { capaFinalizada: info(responsables) })).html;
const cuenta = (html: string, texto: string): number => html.split(texto).length - 1;
/** HTML sin comentarios HTML ni CSS: la plantilla menciona «SIN FIRMA» en comentarios que no se imprimen. */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
/** Recuadros de la plantilla que muestran el marcador «SIN FIRMA» (el comentario de la plantilla también lo menciona). */
const sinFirma = (html: string): number => (html.match(/id="firma_(?:elaboro|aprobo)"><span class="sin-firma">SIN FIRMA/g) ?? []).length;

describe.each(FAMILY_CODES)('bloque de firmas de %s', (familia) => {
  it('sin información de responsables (llamada directa, no el flujo documental) conserva el marcador de la plantilla y no añade nada', async () => {
    const html = await compuesto(familia);
    expect(sinFirma(html)).toBe(2);
    expect(html).not.toContain('class="resp"');
    expect(html).not.toContain('firma_extra');
    expect(html).toContain('PRUEBA · NO VÁLIDO PARA PRODUCCIÓN');
  });

  it('un responsable sin imagen: función y nombre en el primer recuadro; el segundo queda vacío', async () => {
    const html = await compuesto(familia, [R(1, 'GENERO', 'Ana Pérez', false)]);
    expect(cuenta(html, 'class="resp"')).toBe(1);
    expect(html).toContain('>Ana Pérez</div><div class="resp-funcion">Generó</div>');
    expect(html).toContain('<div class="resp-img"></div><div class="resp-linea"></div>');          // espacio de firma vacío con su línea; nada de texto sustituto
    expect(visible(html)).not.toContain('SIN FIRMA');
    expect(html).not.toContain('firma_extra');
    expect(html).toMatch(/id="firma_aprobo"><\/div>/);
  });

  it('dos responsables, uno con imagen incrustada (data URI) y funciones distintas', async () => {
    const html = await compuesto(familia, [R(1, 'GENERO', 'Ana', true), R(2, 'APROBO', 'Beto', false)]);
    expect(cuenta(html, 'class="resp"')).toBe(2);
    expect(html).toContain('<img alt="" src="data:image/png;base64,');
    expect(html).toContain('Aprobó</div>');
    expect(html).not.toContain('firma_extra');
  });

  it('el PDF finalizado con responsables nunca imprime «SIN FIRMA» (combinaciones con y sin imagen) y no genera espacios de más', async () => {
    for (const combinacion of [[false], [true, false], [false, true], [true, false, true], [false, false, false]]) {
      const html = await compuesto(familia, combinacion.map((conFirma, i) => R(i + 1, i === 0 ? 'GENERO' : 'REVISO', `Persona ${i + 1}`, conFirma)));
      expect(visible(html), JSON.stringify(combinacion)).not.toMatch(/SIN FIRMA|PENDIENTE/);
      expect(cuenta(html, 'class="resp"')).toBe(combinacion.length);                                // un recuadro por responsable agregado, ninguno de más
      expect(cuenta(html, '<img alt="" src="data:image/png')).toBe(combinacion.filter(Boolean).length);
      expect(cuenta(html, 'id="firma_extra"')).toBe(combinacion.length === 3 ? 1 : 0);
    }
  });

  it('tres responsables con funciones repetidas: tercer recuadro dentro de la zona de firmas y reparto en tres columnas', async () => {
    const html = await compuesto(familia, [R(1, 'GENERO', 'Ana', true), R(2, 'GENERO', 'Beto', true), R(3, 'REVISO', 'Carla', false)]);
    expect(cuenta(html, 'class="resp"')).toBe(3);
    expect(cuenta(html, 'id="firma_extra"')).toBe(1);
    expect(html.indexOf('id="seccion-firmas"')).toBeLessThan(html.indexOf('id="firma_extra"'));
    expect(html).toContain('.firmas-zona .firma-extra { left: 67% !important; }');
    expect(cuenta(html, 'Generó</div>')).toBe(2);
    expect(html).toContain('Generó: Ana · Generó: Beto · Revisó: Carla');          // pie de la capa de prueba
  });
});

describe('seguridad del bloque de firmas', () => {
  it('los nombres se escapan (sin HTML activo) y se limitan; un tipo de imagen no permitido nunca se incrusta', async () => {
    const html = await compuesto('BOLSA_PLANA_1', [R(1, 'GENERO', '<img src=x onerror=alert(1)> "Ana" & Cía', false), { posicion: 2, funcion: 'REVISO', nombre: 'Beto', firma: { tipoMime: 'image/svg+xml', contenido: Buffer.from('<svg/>'), sha256: 'c'.repeat(64) } }]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;Ana&quot; &amp; Cía');
    expect(html).not.toContain('image/svg+xml');
    expect(visible(html)).not.toContain('SIN FIRMA');                                                // un tipo no permitido deja el espacio vacío, no un texto
  });

  it('el borrador (PDF/vista previa) conserva «SIN FIRMA» aunque existan responsables: las firmas solo se imprimen al finalizar', async () => {
    const r = await servicio.preview('BOLSA_PLANA_1', { codigo: 'X', descripcion: 'x' }, undefined, { capaBorrador: true });
    expect(sinFirma(r.html)).toBe(2);
    expect(r.html).not.toContain('class="resp"');
  });
});
