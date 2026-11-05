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
import { pngFirma } from '../imagenes-firma';

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
  it.skipIf(!chromePath)('borrador → Elaboró → finalizar → REV01 → PDF descargable SIN leyendas del sistema → reapertura desde el historial', async () => {
    const b = await service.crearBorrador(actor(2), { codigo: 'SCHFPMG001', familia: 'BOLSA_PLANA_1', datos: DATOS, cliente: { nombre: 'SCHAEFFLER' } } as never) as Vista;
    expect(b).toMatchObject({ estado: 'BORRADOR', cliente: { nombre: 'SCHAEFFLER', verificado: false } });

    // Sin casilla de confirmación: pulsar «Finalizar» confirma el nombre de «Generó» (con la sesión y la versión vigente, en la misma transacción).
    expect(b.elaboro).toMatchObject({ confirmado: false });
    const fin = await service.finalizar(actor(2), b.id, b.version) as Vista;
    expect(fin).toMatchObject({ estado: 'FINALIZADA', revision: 1, entorno: 'PRUEBA', elaboro: { confirmado: true, nombre: 'General Dos' } });
    expect(fin.pdf.nombre).toBe('SCHFPMG001_REV01.pdf');
    expect(fin.especificacion.datos.colorConcentracion).toBe('3');

    // Descarga del PDF almacenado: contenido y datos impresos (sin leyendas del sistema).
    const d = await service.descargarPdf(actor(2), b.id);
    expect(d.contenido.subarray(0, 5).toString()).toBe('%PDF-');
    expect(d.nombre).toBe('SCHFPMG001_REV01.pdf');
    const texto = textoDelPdf(d.contenido);
    expect(texto, 'pdftotext debe estar disponible para verificar el contenido impreso').not.toBeNull();
    if (texto !== null) {
      expect(texto).not.toMatch(/PRUEBA|NO V.LIDO PARA PRODUCCI.N|Finalizada en TEST|No implica aprobaci.n|Huella/);   // la plantilla original, sin leyendas ni pie del sistema
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

describe('SCHFPMG001 · responsables y firmas en el PDF finalizado (Chrome real)', () => {
  const imagenes = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;

  it.skipIf(!chromePath)('tres responsables con funciones repetidas e imágenes: el PDF las imprime; REV01 no cambia al retirar la firma; REV02 no hereda imágenes; la hoja sin responsables se genera como antes', async () => {
    const f1 = await service.subirFirma(actor(2), pngFirma(500, 160), undefined, undefined);
    const f2 = await service.subirFirma(actor(2), pngFirma(300, 120, { fondo: 'blanco' }), undefined, undefined);
    const codigo = `FIRMAS${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
    const b = await service.crearBorrador(actor(2), { codigo, familia: 'BOLSA_PLANA_1', datos: { ...DATOS, codigo }, cliente: { nombre: 'SCHAEFFLER' },
      responsables: [{ funcion: 'GENERO', nombre: 'Se sustituye por la propietaria', firmaId: f1.id }, { funcion: 'GENERO', nombre: 'Segundo Generó', firmaId: f2.id }, { funcion: 'REVISO', nombre: 'Persona Sin Imagen' }] } as never) as Vista;
    expect(b.responsables.map((r: Vista) => [r.posicion, r.funcion, r.nombre, r.conFirma])).toEqual([[1, 'GENERO', 'General Dos', true], [2, 'GENERO', 'General Dos', true], [3, 'REVISO', 'Persona Sin Imagen', false]]);

    const fin = await service.finalizar(actor(2), b.id, b.version) as Vista;
    expect(fin).toMatchObject({ estado: 'FINALIZADA', revision: 1, elaboro: { confirmado: true, nombre: 'General Dos' } });
    const pdf = (await service.descargarPdf(actor(2), b.id)).contenido;
    const texto = textoDelPdf(pdf) ?? '';
    expect(texto).not.toMatch(/NO V.LIDO PARA PRODUCCI.N|Finalizada en TEST|No implica aprobaci.n|Huella/);            // sin leyendas ni pie del sistema; los nombres salen en los recuadros de la plantilla
    expect(texto).toContain('Persona Sin Imagen');
    expect(texto).toContain('General Dos');                                         // con imagen, el nombre impreso es el de su propietaria
    expect(texto).not.toContain('Se sustituye por la propietaria');                 // el nombre escrito a mano no se imprime junto a una firma ajena
    expect((texto.match(/Gener./g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(texto).toMatch(/Revis./);

    // Sin responsables agregados (solo «Generó» con el nombre documental): mismo documento sin imágenes de firma y sin texto sustituto.
    const codigoB = `SINFIRMA${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
    const sin = await service.crearBorrador(actor(2), { codigo: codigoB, familia: 'BOLSA_PLANA_1', datos: { ...DATOS, codigo: codigoB }, cliente: { nombre: 'SCHAEFFLER' } } as never) as Vista;
    await service.finalizar(actor(2), sin.id, sin.version);
    const pdfSin = (await service.descargarPdf(actor(2), sin.id)).contenido;
    expect(imagenes(pdf)).toBeGreaterThan(imagenes(pdfSin));                       // las dos imágenes de firma están en el PDF
    expect(textoDelPdf(pdfSin) ?? '').not.toMatch(/SIN FIRMA/);                    // sin imagen el espacio queda vacío para firmar a mano
    expect(textoDelPdf(pdf) ?? '').not.toMatch(/SIN FIRMA/);

    // El catálogo cambia: la firma se retira. REV01 y su PDF almacenado no cambian.
    const sha = (await service.obtener(actor(2), b.id) as Vista).pdf.sha256;
    await service.retirarFirma(actor(2), f1.id);
    expect(((await service.obtener(actor(2), b.id) as Vista).pdf.sha256)).toBe(sha);
    expect((await service.descargarPdf(actor(2), b.id)).contenido.equals(pdf)).toBe(true);
    expect((await service.obtener(actor(2), b.id) as Vista).responsables[0]).toMatchObject({ conFirma: true });

    // REV02: nombres y funciones como referencia editable; sin imágenes.
    const rev2 = await service.crearRevisionNueva(actor(2), fin.documentoId) as Vista;
    expect(rev2.responsables.map((r: Vista) => [r.posicion, r.funcion, r.nombre, r.conFirma])).toEqual([[1, 'GENERO', 'General Dos', false], [2, 'GENERO', 'General Dos', false], [3, 'REVISO', 'Persona Sin Imagen', false]]);
  }, 120_000);
});
