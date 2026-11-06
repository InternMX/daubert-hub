// Genera el PDF FINALIZADO de los ocho formatos con el código compilado (dist) y el Chrome indicado. Uso: node _f6_gen.cjs <dist/src> <chrome> <salida> [sinSandbox]
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib');
const [dist, chrome, out, sandbox] = process.argv.slice(2);
const { SheetPreviewService } = require(path.join(dist, 'manufacturing-sheets/preview/sheet-preview.service'));
const { SheetPdfService } = require(path.join(dist, 'manufacturing-sheets/preview/sheet-pdf.service'));
const { DEFAULT_PDF_RENDERER_OPTIONS } = require(path.join(dist, 'manufacturing-sheets/preview/sheet-pdf.renderer'));
const crc = (b) => { let c, t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const pngFirma = (w, h) => { const raw = Buffer.alloc((w * 3 + 1) * h, 0); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const v = (x + y) % 40 < 3 ? 20 : 255; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); };
const firma = (w, h) => ({ tipoMime: 'image/png', contenido: pngFirma(w, h), sha256: 'a'.repeat(64) });
const RESPONSABLES = [{ posicion: 1, funcion: 'GENERO', nombre: 'Alejandro López Matamoros', firma: firma(600, 200) }, { posicion: 2, funcion: 'REVISO', nombre: 'María de los Ángeles Hernández-Domínguez de la Garza', firma: firma(240, 120) }, { posicion: 3, funcion: 'APROBO', nombre: 'Persona sin imagen', firma: null }];
const INFO = { revision: 3, finalizadoEn: '2026-11-05', elaboro: 'Alejandro López', huella: 'c'.repeat(64) };
const lineas = fs.readFileSync((process.env.FMT_LINES || require('node:path').join(__dirname, 'formatos.datos.txt')), 'utf8').replace(/const FORMATOS: Array<[^=]*= \[/, 'const FORMATOS = [').replace(/const (\w+) = \{/g, 'var $1 = {');
const FORMATOS = new Function(lineas + '; return FORMATOS;')();
(async () => {
  const preview = new SheetPreviewService();
  const pdf = new SheetPdfService(preview, { ...DEFAULT_PDF_RENDERER_OPTIONS, chromePath: chrome, sinSandbox: sandbox === 'true' });
  fs.mkdirSync(out, { recursive: true });
  for (const [nombre, familia, datos] of FORMATOS) {
    const r = await pdf.generarFinalizada(familia, datos, undefined, { ...INFO, responsables: RESPONSABLES }, null);
    fs.writeFileSync(path.join(out, nombre.replace(/ /g, '_') + '.pdf'), r.pdf);
    console.log('OK', nombre, r.pdf.length);
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
