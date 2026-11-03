import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResponsableImpreso } from '../src/manufacturing-sheets/preview/draft-layer';
import { FAMILY_CODES } from '../src/manufacturing-sheets/preview/family-registry';
import { DEFAULT_PDF_RENDERER_OPTIONS, resolveChromePath } from '../src/manufacturing-sheets/preview/sheet-pdf.renderer';
import { SheetPdfService } from '../src/manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';
import { pngFirma } from './imagenes-firma';

// Verificación VISUAL opt-in: con VISUAL_FIRMAS=<carpeta> genera, con Chrome real, un PDF por familia con 1 y con 3 responsables (nombres largos y firmas de distinto tamaño) para revisarlos
// a simple vista (p. ej. `pdftoppm -r 110 -png`). Sin la variable se omite. Además comprueba siempre que el PDF sale en una sola página Carta.
const carpeta = process.env.VISUAL_FIRMAS;
const chrome = resolveChromePath();
const preview = new SheetPreviewService();
const pdf = new SheetPdfService(preview, { ...DEFAULT_PDF_RENDERER_OPTIONS, chromePath: chrome });
const firma = (ancho: number, alto: number) => ({ tipoMime: 'image/png', contenido: pngFirma(ancho, alto), sha256: 'a'.repeat(64) });
const BASE = { codigo: 'VIS-001', descripcion: 'Prueba visual de firmas', producto: 'Bolsa', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '61', largo: '70.9', unidadDimensiones: 'IN', calibre: '2.7', pesoLb: '1.285', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', etiqueta: 'BOLSA VCI PMG' };
const FUELLES = { fuelleTotal: '48', fuelleDerecho: '24', fuelleIzquierdo: '24' };
const DATOS: Record<(typeof FAMILY_CODES)[number], Record<string, string>> = {
  BOLSA_PLANA_1: BASE,
  HOJA_PAQ: { ...BASE, modalidad: 'DOBLADA' },
  BOLSA_FUELLE: { ...BASE, ...FUELLES },
  BOLSA_NATURAL: { ...BASE, ...FUELLES, composicion: 'CP5000', colorNombre: 'NATURAL', colorHex: '#FFF2CC', resinaVci: '' },
  ROLLO_CONTINUO: { codigo: 'RC-001', descripcion: 'Rollo VCI PMG doblado 58 x 4500" Cal. 3 mil', producto: 'ROLLO VCI', composicion: 'PMG', presentacion: 'ROLLO', modalidad: 'DOBLADA', ancho: '58', largo: '4500', unidadDimensiones: 'IN', anchoRollo: '30', calibre: '3 MIL', pesoLb: '8.25', colorNombre: 'ROJO', colorHex: '#C0504D' },
  TERMOENCOGIBLE: { codigo: 'TE-001', descripcion: 'Rollo VCI + UV termoencogible doblado 6 x 30 metros Cal. 8 mil', producto: 'ROLLO VCI + UV TERMOENCOGIBLE', composicion: 'PMG', presentacion: 'ROLLO', modalidad: 'DOBLADA', ancho: '6', largo: '30', unidadDimensiones: 'M', calibre: '8 MIL', pesoLb: '45.2', colorNombre: 'NATURAL', anchoDoblado: '1.60', medidaPliegue: '0.70', largoPresentacionFinal: '30', anchoPresentacionFinal: '1.60' },
  COEX: { codigo: 'COEX-001', descripcion: 'Bolsa COEX VCI PMG 51.2 x 23.6 x 31.5" Cal. 2.5 mil', producto: 'Bolsa Con Fuelle - 20% de material reciclado', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '150', cantidadUnidad: 'BOLSAS', ancho: '51.2', fuelleTotal: '23.6', fuelleDerecho: '11.8', fuelleIzquierdo: '11.8', largo: '31.5', unidadDimensiones: 'IN', calibre: '2.5 MIL', pesoLb: '0.3929', colorNombre: 'AZUL', coexVariante: 'AZUL', pesoCapaInterior: '0.13097', pesoCapaIntermedia: '0.13097', pesoCapaExterior: '0.13097', lbVciInterior: '0.005239', lbVciIntermedia: '0.002619', lbVciExterior: '0' }
};
const tres: ResponsableImpreso[] = [
  { posicion: 1, funcion: 'GENERO', nombre: 'Alejandro López Matamoros', firma: firma(600, 200) },
  { posicion: 2, funcion: 'REVISO', nombre: 'María de los Ángeles Hernández-Domínguez de la Garza', firma: firma(240, 120) },
  { posicion: 3, funcion: 'APROBO', nombre: 'Persona sin imagen', firma: null }
];
const sinImagen: ResponsableImpreso[] = [{ posicion: 1, funcion: 'GENERO', nombre: 'Solo Generó', firma: null }];
const mixto: ResponsableImpreso[] = [{ posicion: 1, funcion: 'GENERO', nombre: 'Con firma', firma: firma(400, 150) }, { posicion: 2, funcion: 'REVISO', nombre: 'Sin firma (a mano)', firma: null }, { posicion: 3, funcion: 'APROBO', nombre: 'Con firma', firma: firma(300, 100) }];

describe.skipIf(!chrome)('PDF finalizado con responsables y firmas (Chrome real)', () => {
  it.each(FAMILY_CODES)('%s: una sola página Carta con 1 y con 3 responsables', async (familia) => {
    for (const [etiqueta, responsables] of [['1', [tres[0] as ResponsableImpreso]], ['3', tres], ['0firma', sinImagen], ['mixto', mixto]] as const) {
      const r = await pdf.generarFinalizada(familia, DATOS[familia],
        undefined, { revision: 1, finalizadoEn: '2026-11-03', elaboro: 'Alejandro', huella: 'b'.repeat(64), responsables: [...responsables] }, null);
      expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect((r.pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
      expect(r.pdf.length).toBeGreaterThan(5000);
      if (carpeta) { mkdirSync(carpeta, { recursive: true }); writeFileSync(join(carpeta, `${familia}_${etiqueta}.pdf`), r.pdf); }
    }
  }, 60_000);
});
