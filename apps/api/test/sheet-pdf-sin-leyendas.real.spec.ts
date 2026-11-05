import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ResponsableImpreso } from '../src/manufacturing-sheets/preview/draft-layer';
import { FAMILY_CODES } from '../src/manufacturing-sheets/preview/family-registry';
import { DEFAULT_PDF_RENDERER_OPTIONS, resolveChromePath, SheetPdfRenderer } from '../src/manufacturing-sheets/preview/sheet-pdf.renderer';
import { SheetPdfService } from '../src/manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { pngFirma } from './imagenes-firma';

// REGRESIÓN con Chrome real: el PDF FINALIZADO de los ocho formatos (7 familias; COEX en sus dos variantes Azul y Verde) respeta la plantilla original: no lleva la leyenda roja superior «PRUEBA · NO VÁLIDO
// PARA PRODUCCIÓN» ni el pie del sistema (revisión, fecha, TEST, huella, «No implica aprobación oficial», nombres), y quitarlos NO mueve nada: se compara contra el mismo HTML con la capa anterior (réplica
// exacta de la capa retirada) y toda palabra del PDF nuevo está en la MISMA posición que en el anterior, con el mismo número de páginas. Se omite si no hay Chrome o Python con PyMuPDF.
const chrome = resolveChromePath();
const SCRIPT = join(__dirname, 'helpers', 'pdf_palabras.py');
const hayPyMuPdf = spawnSync('python', ['-c', 'import fitz'], { encoding: 'utf8' }).status === 0;
const opciones = { ...DEFAULT_PDF_RENDERER_OPTIONS, chromePath: chrome };
const preview = new SheetPreviewService();
const pdf = new SheetPdfService(preview, opciones);
const renderer = new SheetPdfRenderer(opciones);
const carpeta = mkdtempSync(join(tmpdir(), 'sin-leyendas-'));
afterAll(() => { rmSync(carpeta, { recursive: true, force: true }); });

const firma = (ancho: number, alto: number) => ({ tipoMime: 'image/png', contenido: pngFirma(ancho, alto), sha256: 'a'.repeat(64) });
const RESPONSABLES: ResponsableImpreso[] = [
  { posicion: 1, funcion: 'GENERO', nombre: 'Alejandro López Matamoros', firma: firma(600, 200) },
  { posicion: 2, funcion: 'REVISO', nombre: 'María de los Ángeles Hernández-Domínguez de la Garza', firma: firma(240, 120) },
  { posicion: 3, funcion: 'APROBO', nombre: 'Persona sin imagen', firma: null }
];
const INFO = { revision: 3, finalizadoEn: '2026-11-05', elaboro: 'Alejandro López', huella: 'c'.repeat(64) };
const BASE = { codigo: 'SINLEY-001', descripcion: 'Regresión sin leyendas', producto: 'Bolsa', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '61', largo: '70.9', unidadDimensiones: 'IN', calibre: '2.7', pesoLb: '10', cliente: 'Cliente de prueba', fechaEmision: '2026-11-05', colorNombre: 'AZUL', colorHex: '#538DD5', resinaVci: 'PMG AL 3%', etiqueta: 'BOLSA VCI PMG' };
const FUELLES = { fuelleTotal: '48', fuelleDerecho: '24', fuelleIzquierdo: '24' };
const COEX = { codigo: 'COEX-001', descripcion: 'Bolsa COEX VCI PMG 51.2 x 23.6 x 31.5" Cal. 2.5 mil', producto: 'Bolsa Con Fuelle - 20% de material reciclado', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '150', cantidadUnidad: 'BOLSAS', ancho: '51.2', fuelleTotal: '23.6', fuelleDerecho: '11.8', fuelleIzquierdo: '11.8', largo: '31.5', unidadDimensiones: 'IN', calibre: '2.5 MIL', pesoLb: '0.3929', colorNombre: 'AZUL', coexVariante: 'AZUL', pesoCapaInterior: '0.13097', pesoCapaIntermedia: '0.13097', pesoCapaExterior: '0.13097', lbVciInterior: '0.005239', lbVciIntermedia: '0.002619', lbVciExterior: '0' };
const FORMATOS: Array<[string, (typeof FAMILY_CODES)[number], Record<string, string>]> = [
  ['Bolsa Plana 1', 'BOLSA_PLANA_1', BASE],
  ['Hojas', 'HOJA_PAQ', { ...BASE, modalidad: 'DOBLADA' }],
  ['Bolsa Fuelle', 'BOLSA_FUELLE', { ...BASE, ...FUELLES }],
  ['Bolsa Natural', 'BOLSA_NATURAL', { ...BASE, ...FUELLES, composicion: 'CP5000', colorNombre: 'NATURAL', colorHex: '#FFF2CC', resinaVci: '' }],
  ['Rollo Continuo', 'ROLLO_CONTINUO', { codigo: 'RC-001', descripcion: 'Rollo VCI PMG doblado 58 x 4500" Cal. 3 mil', producto: 'ROLLO VCI', composicion: 'PMG', presentacion: 'ROLLO', modalidad: 'DOBLADA', ancho: '58', largo: '4500', unidadDimensiones: 'IN', anchoRollo: '30', calibre: '3 MIL', pesoLb: '8.25', colorNombre: 'ROJO', colorHex: '#C0504D' }],
  ['Termoencogible', 'TERMOENCOGIBLE', { codigo: 'TE-001', descripcion: 'Rollo VCI + UV termoencogible doblado 6 x 30 metros Cal. 8 mil', producto: 'ROLLO VCI + UV TERMOENCOGIBLE', composicion: 'PMG', presentacion: 'ROLLO', modalidad: 'DOBLADA', ancho: '6', largo: '30', unidadDimensiones: 'M', calibre: '8 MIL', pesoLb: '45.2', colorNombre: 'NATURAL', anchoDoblado: '1.60', medidaPliegue: '0.70', largoPresentacionFinal: '30', anchoPresentacionFinal: '1.60' }],
  ['COEX Azul', 'COEX', COEX],
  ['COEX Verde', 'COEX', { ...COEX, coexVariante: 'VERDE', colorNombre: 'VERDE', colorHex: '#00B050' }]
];

// Réplica EXACTA de la capa que se retiró (leyenda roja superior + pie), solo para comparar posiciones.
const CAPA_RETIRADA = (info: typeof INFO): string => `<style>
  .marca-prueba, .marca-prueba-pie { position: fixed; left: 0; right: 0; text-align: center; pointer-events: none; z-index: 2147483647; font-family: Calibri, Carlito, "Segoe UI", Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .marca-prueba { top: 11pt; font-size: 10.5pt; font-weight: 700; letter-spacing: 0.06em; color: #C00000; }
  .marca-prueba-pie { bottom: 9pt; font-size: 7.5pt; color: #595959; line-height: 1.25; }
</style>
<div class="marca-prueba" data-modo="finalizada-prueba">PRUEBA · NO VÁLIDO PARA PRODUCCIÓN</div>
<div class="marca-prueba-pie">Revisión 0${info.revision} · Finalizada en TEST el ${info.finalizadoEn} · Huella ${info.huella.slice(0, 12)} · No implica aprobación oficial<br>Generó: Alejandro López Matamoros · Revisó: María · Aprobó: Persona</div>
`;

interface Palabra { pagina: number; x: number; y: number; texto: string }
function palabras(contenido: Buffer, nombre: string): { paginas: number; palabras: Palabra[]; texto: string } {
  const ruta = join(carpeta, `${nombre}.pdf`);
  writeFileSync(ruta, contenido);
  const r = spawnSync('python', [SCRIPT, ruta], { encoding: 'utf8', maxBuffer: 20_000_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
  if (r.status !== 0) throw new Error(`pdf_palabras.py falló: ${r.stderr}`);
  const datos = JSON.parse(r.stdout) as { paginas: number; palabras: Array<[number, number, number, number, number, string]> };
  const lista = datos.palabras.map(([pagina, x, y, , , texto]) => ({ pagina, x, y, texto }));
  return { paginas: datos.paginas, palabras: lista, texto: lista.map((p) => p.texto).join(' ') };
}
const clave = (p: Palabra): string => `${p.pagina}|${p.x.toFixed(2)}|${p.y.toFixed(2)}|${p.texto}`;

describe.skipIf(!chrome || !hayPyMuPdf)('PDF finalizado sin leyenda superior ni pie del sistema (Chrome real, ocho formatos)', () => {
  it.each(FORMATOS)('%s: sin leyendas añadidas, una página y todo en la misma posición que antes', async (_nombre, familia, datos) => {
    const nuevo = await pdf.generarFinalizada(familia, datos, undefined, { ...INFO, responsables: RESPONSABLES }, null);
    const a = palabras(nuevo.pdf, `${familia}-nuevo`);
    // 1. Ninguna leyenda ni texto del sistema.
    for (const prohibido of [/NO V.LIDO PARA PRODUCCI.N/, /PRUEBA/, /Finalizada en TEST/, /No implica aprobaci.n oficial/, /Huella/, /Revisi.n 0\d/, /cccccccccccc/]) expect(a.texto, String(prohibido)).not.toMatch(prohibido);
    // 2. Sigue siendo UNA página Carta y conserva los campos originales de responsables y firmas de la plantilla.
    expect(a.paginas).toBe(1);
    expect(a.texto).toMatch(/Gener[óo]|Elabor[óo]/);
    expect(a.texto).toContain('Alejandro');
    // 3. Comparación con el HTML idéntico + la capa retirada: mismas páginas y cada palabra nueva en la MISMA posición (solo faltan las de la leyenda y el pie).
    const html = (await preview.preview(familia, datos, undefined, { capaFinalizada: { ...INFO, responsables: RESPONSABLES }, tituloPdf: 'SINLEY' })).html;
    expect(html).not.toContain('marca-prueba');
    const anterior = await renderer.render(html.replace('</body>', () => `${CAPA_RETIRADA(INFO)}</body>`));
    expect(anterior.kind).toBe('OK');
    if (anterior.kind !== 'OK') return;
    const b = palabras(anterior.pdf, `${familia}-anterior`);
    expect(b.texto).toMatch(/NO V.LIDO PARA PRODUCCI.N/);                                  // (la réplica sí lo lleva: la comparación es válida)
    expect(b.paginas).toBe(a.paginas);
    const enAnterior = new Set(b.palabras.map(clave));
    const desplazadas = a.palabras.filter((p) => !enAnterior.has(clave(p)));
    expect(desplazadas, `palabras que cambiaron de posición: ${JSON.stringify(desplazadas.slice(0, 5))}`).toEqual([]);
    expect(b.palabras.length - a.palabras.length).toBeGreaterThan(5);                       // y las que faltan son las de la leyenda y el pie retirados
    const quitadas = b.palabras.filter((p) => !new Set(a.palabras.map(clave)).has(clave(p)));
    expect(quitadas.every((p) => p.y < 40 || p.y > 740)).toBe(true);                         // todas estaban en los márgenes superior e inferior
  }, 90_000);
});
