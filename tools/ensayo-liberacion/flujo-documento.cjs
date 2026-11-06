const base = process.argv[2]; const PW = process.env.ENSAYO_PASSWORD;
if (!PW) { console.error('Define ENSAYO_PASSWORD (contrasena de los usuarios sinteticos de la replica).'); process.exit(2); }
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 300))); if (!c) fails++; };
const SCHF = { codigo: 'SCHFPMG001', descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.0428', cliente: 'Schneider Electric', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5' };
async function login(email) { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) }); return { cookie: r.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')).split(';')[0] }; }
const call = async (w, m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: w.cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch {} return { status: r.status, body: j, buf, type: r.headers.get('content-type') }; };
const png = (n) => { /* PNG sintético de ~n bytes (ruido) */ const zlib = require('node:zlib'); const crc = (b) => { let c, t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; }; const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }; const w = 600, h = Math.ceil(n / (w * 3)); const raw = Buffer.alloc((w * 3 + 1) * h); require('node:crypto').randomFillSync(raw); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw, { level: 0 })), ch('IEND', Buffer.alloc(0))]); };
(async () => {
  const admin = await login('admin1@example.invalid');
  const d = await call(admin, 'POST', '/manufacturing-sheets/documents/drafts', { codigo: 'SCHFPMG001', familia: 'BOLSA_PLANA_1', datos: SCHF });
  ok(d.status === 201 || d.status === 409, `borrador SCHFPMG001 (${d.status})`, d.body);
  let id = d.body?.id ?? d.body?.data?.id; let ver = d.body?.version ?? d.body?.data?.version;
  if (!id) { const o = await call(admin, 'GET', '/manufacturing-sheets/documents/open'); const f = (o.body?.data ?? o.body ?? []).find?.((x) => x.codigo === 'SCHFPMG001'); id = f?.id; ver = f?.version; }
  ok(Boolean(id), 'id de borrador', d.body);
  const pa = await call(admin, 'PATCH', `/manufacturing-sheets/documents/revisions/${id}`, { version: ver, cliente: { empresaId: '1' }, elaboroNombre: 'Admin Uno', elaboroConfirmado: true });
  ok(pa.status === 200, `completar cliente del catálogo y Generó (${pa.status})`, pa.body); ver = (pa.body?.version ?? pa.body?.data?.version ?? ver);
  const fin = await call(admin, 'POST', `/manufacturing-sheets/documents/revisions/${id}/finalize`, { version: ver });
  ok(fin.status === 200, `finalizar → 200 (fue ${fin.status})`, fin.body);
  const doc = await call(admin, 'GET', `/manufacturing-sheets/documents/revisions/${id}`);
  const v = doc.body?.data ?? doc.body;
  ok(v?.entorno === 'PRODUCCION', `documento finalizado con entorno_emision = PRODUCCION (${v?.entorno})`, v);
  ok(v?.estado === 'FINALIZADA' || v?.estado === 'FINALIZADO', `estado finalizado (${v?.estado})`);
  const pdf = await call(admin, 'GET', `/manufacturing-sheets/documents/revisions/${id}/pdf`);
  ok(pdf.status === 200 && /pdf/.test(pdf.type ?? '') && pdf.buf.slice(0, 5).toString() === '%PDF-', `PDF final generado con Chromium del contenedor (${pdf.status}, ${pdf.type}, ${pdf.buf.length} bytes)`);
  require('node:fs').writeFileSync(process.argv[3] ?? 'documento-final.pdf', pdf.buf);
  const ed = await call(admin, 'PATCH', `/manufacturing-sheets/documents/revisions/${id}`, { version: ver + 1, datos: { ...SCHF, ancho: '14' } });
  ok(ed.status >= 400 && ed.status < 500, `documento finalizado inmutable: PATCH rechazado (${ed.status})`, ed.body);
  // firmas: subida por la vía indicada (base puede ser el API directo o nginx)
  const fd = new FormData(); fd.append('archivo', new Blob([png(1_500_000)], { type: 'image/png' }), 'firma.png');
  const up = await fetch(base + '/api/manufacturing-sheets/documents/signatures', { method: 'POST', headers: { cookie: admin.cookie }, body: fd });
  const upb = await up.text();
  ok(up.status !== 413, `firma de ~1.5 MB no se rechaza por tamaño del proxy (${up.status})`, upb.slice(0, 200));
  console.log('firma_upload_status', up.status, upb.slice(0, 160));
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: todo PASS'); process.exit(fails ? 1 : 0);
})();
