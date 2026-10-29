/**
 * Genera, con el servicio COMPILADO (dist) y el renderizador real, los PDF de borrador de los casos simulados del prototipo (casos.json) y, para compararlos, el PDF de la MISMA composición sin la
 * capa de borrador (la vista previa). Solo fixtures simulados: no consulta BIND ni PostgreSQL y no escribe fuera de la carpeta indicada.
 * Uso (desde apps/api, tras `npm run build`): node test/manufacturing-sheets/prototype/generar_pdfs_borrador.cjs CARPETA_SALIDA
 */
const fs = require('node:fs');
const path = require('node:path');
const { SheetPreviewService } = require('../../../dist/src/manufacturing-sheets/preview/sheet-preview.service');
const { SheetPdfRenderer, DEFAULT_PDF_RENDERER_OPTIONS, resolveChromePath } = require('../../../dist/src/manufacturing-sheets/preview/sheet-pdf.renderer');
const { SheetPdfService } = require('../../../dist/src/manufacturing-sheets/preview/sheet-pdf.service');

const salida = path.resolve(process.argv[2] ?? path.join(__dirname, 'test-results/pdf-borrador'));
fs.mkdirSync(salida, { recursive: true });
const chromePath = resolveChromePath();
if (!chromePath) { console.error('No hay Chrome disponible (MANUFACTURING_PDF_CHROME_PATH).'); process.exit(2); }
const opciones = { ...DEFAULT_PDF_RENDERER_OPTIONS, chromePath, maxConcurrent: 1 };
const casos = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos.json'), 'utf8'));

(async () => {
  const preview = new SheetPreviewService();
  const pdf = new SheetPdfService(preview, opciones);
  const renderer = new SheetPdfRenderer(opciones);
  const resumen = [];
  const incompleto = { ...casos.find((c) => c.id === 'hojas-doblada'), id: 'incompleto-sin-peso' };
  incompleto.datos = { ...incompleto.datos, pesoLb: '', calibre: '' };
  const personalizado = { ...casos.find((c) => c.id === 'bolsa-fuelle'), id: 'color-personalizado' };
  personalizado.datos = { ...personalizado.datos, colorNombre: 'AZUL ESPECIAL CLIENTE', colorHex: '#3778C8' };     // color personalizado (nombre + HEX) de la familia Bolsa Fuelle
  for (const caso of [...casos, incompleto, personalizado]) {
    const borrador = await pdf.generarBorrador(caso.familia, caso.datos);
    fs.writeFileSync(path.join(salida, `${caso.id}.pdf`), borrador.pdf);
    const vista = await preview.preview(caso.familia, caso.datos);                       // misma composición, sin la capa de borrador
    const r = await renderer.render(vista.html);
    if (r.kind !== 'OK') throw new Error(`Vista sin capa no generada: ${caso.id} (${r.kind})`);
    fs.writeFileSync(path.join(salida, `${caso.id}.sin-capa.pdf`), r.pdf);
    resumen.push({ id: caso.id, familia: caso.familia, archivo: borrador.filename, completo: borrador.completo, bytes: borrador.pdf.length, datos: caso.datos });
    console.log(`OK ${caso.id} → ${borrador.filename} (${borrador.pdf.length} B, completo=${borrador.completo})`);
  }
  fs.writeFileSync(path.join(salida, 'resumen.json'), JSON.stringify(resumen, null, 2));
})().catch((e) => { console.error(e); process.exitCode = 1; });
