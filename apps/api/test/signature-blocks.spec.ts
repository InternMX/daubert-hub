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
/** Recuadros de la plantilla que muestran el marcador «SIN FIRMA» (el comentario de la plantilla también lo menciona). */
const sinFirma = (html: string): number => (html.match(/id="firma_(?:elaboro|aprobo)"><span class="sin-firma">SIN FIRMA/g) ?? []).length;

describe.each(FAMILY_CODES)('bloque de firmas de %s', (familia) => {
  it('sin responsables (hojas anteriores) conserva el marcador «SIN FIRMA» de la plantilla y no añade nada', async () => {
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
    expect(html).toContain('resp-sin">SIN FIRMA');
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
    expect(html).toContain('resp-sin">SIN FIRMA');
  });

  it('el borrador (PDF/vista previa) conserva «SIN FIRMA» aunque existan responsables: las firmas solo se imprimen al finalizar', async () => {
    const r = await servicio.preview('BOLSA_PLANA_1', { codigo: 'X', descripcion: 'x' }, undefined, { capaBorrador: true });
    expect(sinFirma(r.html)).toBe(2);
    expect(r.html).not.toContain('class="resp"');
  });
});
