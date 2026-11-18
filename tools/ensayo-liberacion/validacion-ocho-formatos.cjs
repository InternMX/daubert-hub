// Genera, con la pila REAL de la réplica (nginx → API → PostgreSQL), un documento FINALIZADO de cada uno de los ocho formatos (con responsables y firmas) y descarga su PDF.
//   ENSAYO_PASSWORD=… node tools/ensayo-liberacion/validacion-ocho-formatos.cjs http://127.0.0.1:58430 <carpeta> [contenedor-pg=ens-origen]
// Luego: python tools/ensayo-liberacion/analizar_formatos.py <carpeta>   (páginas, tamaño, texto, imágenes de firma, sin leyendas de prueba).
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib'); const { spawnSync } = require('node:child_process');
const base = process.argv[2]; const EVID = process.argv[3]; const PG = process.argv[4] ?? 'ens-origen'; const PW = process.env.ENSAYO_PASSWORD;
if (!base || !EVID || !PW) { console.error('Uso: ENSAYO_PASSWORD=… node validacion-ocho-formatos.cjs <url> <carpeta> [pg]'); process.exit(2); }
fs.mkdirSync(EVID, { recursive: true });
const dk = (a) => spawnSync('docker', a, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const sql = (q) => dk(['exec', '-e', 'PGPASSWORD=scratch', PG, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'daubert_global', '-X', '-At', '-F', '|', '-c', q]).stdout.trim();
const crc = (b) => { let c, t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (w, h, s) => { const raw = Buffer.alloc((w * 3 + 1) * h, 255); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const v = ((x * 7 + y * 3 + s) % 53 < 4) ? 20 : 255; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; } } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); };
const lineas = fs.readFileSync(path.join(__dirname, 'formatos.datos.txt'), 'utf8').replace(/const FORMATOS: Array<[^=]*= \[/, 'const FORMATOS = [').replace(/const (\w+) = \{/g, 'var $1 = {');
const FORMATOS = new Function(lineas + '; return FORMATOS;')();
const S = '-' + Date.now().toString(36).slice(-5).toUpperCase();
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 260))); if (!c) fails++; };
async function login(email) { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) }); return { cookie: r.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')).split(';')[0] }; }
const call = async (w, m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: w.cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch { /* binario */ } return { status: r.status, body: j, buf }; };
const D = '/manufacturing-sheets/documents';
(async () => {
  const admin = await login('ensayo.admin@example.invalid');
  const cli = sql("SELECT empresa_id FROM core.empresas e WHERE EXISTS (SELECT 1 FROM core.empresa_roles r WHERE r.empresa_id = e.empresa_id AND r.rol = 'CLIENTE') ORDER BY 1 LIMIT 1");
  const subir = async (img) => { const fd = new FormData(); fd.append('archivo', new Blob([img], { type: 'image/png' }), 'f.png'); const r = await fetch(`${base}/api${D}/signatures`, { method: 'POST', headers: { cookie: admin.cookie }, body: fd }); return (await r.json()).id; };
  const f1 = await subir(png(600, 200, 11)); const f2 = await subir(png(300, 100, 12));
  const resumen = [];
  for (const [nombre, familia, datos0] of FORMATOS) {
    const datos = familia === 'BOLSA_NATURAL' ? { ...datos0, composicion: 'NAT' } : datos0;   // con CP5000 la plantilla reconoce una CONTRADICCION (imprime NAT) que exige reconocimiento explícito; aquí se usa la composición del formato
    const codigo = String(datos.codigo) + '-' + nombre.replace(/[^A-Za-z0-9]+/g, '').slice(0, 8).toUpperCase() + S; const d = await call(admin, 'POST', `${D}/drafts`, { codigo, familia, datos: { ...datos, codigo }, ...(familia === 'COEX' && datos.coexVariante ? {} : {}) });
    ok(d.status === 201, `${nombre}: borrador (${familia})`, d.body);
    const p = await call(admin, 'PATCH', `${D}/revisions/${d.body.id}`, { version: d.body.version, cliente: { empresaId: cli }, elaboroNombre: 'Elaboró Formato', elaboroConfirmado: true, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f1 }, { funcion: 'REVISO', nombre: 'x', firmaId: f2 }, { funcion: 'APROBO', nombre: 'Aprobó Sin Firma Sintético' }] });
    ok(p.status === 200, `${nombre}: responsables y cliente`, p.body);
    const fin = await call(admin, 'POST', `${D}/revisions/${d.body.id}/finalize`, { version: p.body.version }); ok(fin.status === 200 && fin.body.estado === 'FINALIZADA', `${nombre}: FINALIZADA`, fin.body);
    const pdf = await call(admin, 'GET', `${D}/revisions/${d.body.id}/pdf`); ok(pdf.status === 200 && pdf.buf.slice(0, 5).toString() === '%PDF-', `${nombre}: PDF descargado dentro de la pila (${pdf.buf.length} bytes)`);
    const arch = nombre.replace(/ /g, '_') + '_REV' + String(fin.body.revision).padStart(2, '0') + '.pdf'; fs.writeFileSync(path.join(EVID, arch), pdf.buf);
    resumen.push({ nombre, familia, archivo: arch, codigo, id: d.body.id, revision: fin.body.revision, entorno: fin.body.entorno, estado: fin.body.estado, pdfNombre: fin.body.pdf?.nombre, sha256: fin.body.pdf?.sha256, bytes: fin.body.pdf?.bytes, cliente: fin.body.cliente });
  }
  fs.writeFileSync(path.join(EVID, 'formatos.json'), JSON.stringify(resumen, null, 1));
  ok(resumen.length === 8 && resumen.every((r) => r.entorno === 'PRODUCCION' && r.estado === 'FINALIZADA' && r.revision === 1), 'los 8 documentos: FINALIZADA, revisión 1, entorno_emision PRODUCCION', resumen.map((r) => [r.nombre, r.revision, r.entorno]));
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: 8 formatos generados (todo PASS)'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
