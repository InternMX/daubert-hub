// Límites de la carga de firmas de Manufactura, por separado: nginx (3 MB solo en la ruta exacta) y API (2 MB). SOLO réplicas/ensayos con usuarios sintéticos y PostgreSQL desechable.
//   ENSAYO_PASSWORD=… node limites-firmas.cjs <url> abierto|cerrado <contenedor-pg>
// abierto: firma PNG válida < 2 MB → nginx y API la aceptan (201, una fila nueva); 2,8 MB → pasa nginx y la RECHAZA la API (JSON, sin fila); > 3 MB → la rechaza nginx (413 HTML, sin fila);
//          las demás rutas conservan 1 MB.     cerrado: toda escritura → 503 de la ventana y ninguna tabla de manufactura cambia.
const { spawnSync } = require('node:child_process'); const zlib = require('node:zlib'); const crypto = require('node:crypto');
const [base, modo, PG] = process.argv.slice(2); const PW = process.env.ENSAYO_PASSWORD;
if (!base || !['abierto', 'cerrado'].includes(modo) || !PG || !PW) { console.error('Uso: ENSAYO_PASSWORD=… node limites-firmas.cjs <url> abierto|cerrado <contenedor-pg>'); process.exit(2); }
if (!/^ens\d+-pg/.test(PG)) { console.error('El contenedor de PostgreSQL debe ser de ensayo (ensNN-pg…).'); process.exit(2); }
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + String(x).replace(/\s+/g, ' ').slice(0, 200))); if (!c) fails++; };
const sql = (q) => { const r = spawnSync('docker', ['exec', PG, 'psql', '-U', 'postgres', '-d', 'daubert_global', '-X', '-At', '-c', q], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const TABLAS = ['cliente_abreviaturas', 'confirmaciones_revision', 'documentos', 'firma_autorizaciones', 'firmas', 'pdf_contenidos', 'pdfs', 'revision_responsables', 'revisiones'];
const huella = () => sql('SELECT ' + TABLAS.map((t) => `(SELECT count(*) || ':' || coalesce(max(xmin::text::bigint), 0) FROM manufactura.${t})`).join(" || ',' || "));
const firmas = () => Number(sql('SELECT count(*) FROM manufactura.firmas'));
function png(n) {   // PNG válido de ~n bytes (ruido sin comprimir)
  const tabla = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tabla[i] = c >>> 0; }
  const crc = (b) => { let r = 0xffffffff; for (const x of b) r = tabla[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const w = 600, h = Math.ceil(n / (w * 3)); const raw = Buffer.alloc((w * 3 + 1) * h); crypto.randomFillSync(raw); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw, { level: 0 })), ch('IEND', Buffer.alloc(0))]);
}
const MB = 1024 * 1024; const F = '/api/manufacturing-sheets/documents/signatures';
(async () => {
  const l = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.ENSAYO_ADMIN || 'admin1@example.invalid', password: PW }) });
  const cookie = (l.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')) ?? '').split(';')[0];
  ok(l.status === 200 && Boolean(cookie), `inicio de sesión ADMIN (${l.status})`);
  const subir = async (ruta, bytes) => {
    const img = png(bytes); const fd = new FormData(); fd.append('archivo', new Blob([img], { type: 'image/png' }), 'firma.png');
    try { const r = await fetch(base + ruta, { method: 'POST', headers: { cookie }, body: fd }); const t = await r.text(); return { s: r.status, bytes: img.length, nginx: /<html/i.test(t), ventana: r.headers.get('x-hub-window'), t }; }
    catch (e) { return { s: 0, bytes: img.length, nginx: true, ventana: null, t: 'conexión cortada: ' + (e.cause?.code ?? e.message) }; }
  };
  const mb = (b) => (b / MB).toFixed(2) + ' MB';
  if (modo === 'abierto') {
    for (const tam of [0.2, 1.0, 1.9]) {
      const antes = firmas(); const r = await subir(F, tam * MB);
      ok(r.s === 201 && firmas() === antes + 1, `firma válida de ${mb(r.bytes)} (< 2 MB): nginx y API la ACEPTAN (${r.s}) y se registra una firma`, r.t);
    }
    { const antes = firmas(); const r = await subir(F, 2.8 * MB);
      ok(r.s !== 0 && !r.nginx && r.s >= 400 && r.s < 500 && firmas() === antes, `firma de ${mb(r.bytes)}: ATRAVIESA nginx y la RECHAZA la API (${r.s}, JSON) sin registrar nada`, r.t);
      console.log('INFO respuesta de la API: ' + r.t.replace(/\s+/g, ' ').slice(0, 160)); }
    { const antes = firmas(); const r = await subir(F, 2.05 * MB);
      ok(r.s !== 0 && !r.nginx && r.s >= 400 && r.s < 500 && firmas() === antes, `firma de ${mb(r.bytes)} (apenas sobre 2 MB): la rechaza la API (${r.s}) sin registrar nada`, r.t); }
    for (const tam of [3.2, 5]) {
      const antes = firmas(); const r = await subir(F, tam * MB);
      ok(((r.s === 413 && r.nginx) || r.s === 0) && firmas() === antes, `solicitud de ${mb(r.bytes)} (> 3 MB): la rechaza NGINX (${r.s === 0 ? 'conexión cortada' : r.s + ' HTML'}) sin llegar a la API`, r.t);
    }
    for (const ruta of ['/api/manufacturing-sheets/documents/signatures/', '/api/manufacturing-sheets/documents/signatures/0/authorize', '/api/manufacturing-sheets/documents/drafts', '/api/manufacturing-sheets/client-abbreviations',
      '/api/manufacturing-sheets/previews', '/api/clients', '/api/companies/0/aliases', '/api/auth/login', '/api/automations/payment-notifications/0/reprocess']) {
      const r = await subir(ruta, 1.5 * MB); ok((r.s === 413 && r.nginx) || r.s === 0, `otra ruta conserva el límite de 1 MB: ${ruta} con ${mb(r.bytes)} → nginx 413 (${r.s || 'conexión cortada'})`, r.t);
    }
    { const r = await subir('/api/manufacturing-sheets/documents/drafts', 0.5 * MB); ok(r.s !== 413 && r.s !== 0 && !r.nginx, `otra ruta bajo 1 MB sigue llegando a la API (${r.s})`, r.t); }
  } else {
    const antes = huella();
    for (const tam of [0.2, 1.9, 2.8, 3.5]) { const r = await subir(F, tam * MB); ok(r.s === 503 && r.ventana === 'closed-v1', `cerrado: firma de ${mb(r.bytes)} → 503 de la ventana (${r.s || r.t})`, r.t); }
    const escrituras = [['POST', '/api/manufacturing-sheets/documents/drafts', { codigo: 'CERRADO001', familia: 'BOLSA_PLANA_1', datos: { codigo: 'CERRADO001' } }], ['POST', '/api/manufacturing-sheets/client-abbreviations', { abreviatura: 'ZZZ' }],
      ['PATCH', '/api/manufacturing-sheets/documents/revisions/00000000-0000-0000-0000-000000000000', { version: 1 }], ['POST', '/api/manufacturing-sheets/documents/revisions/00000000-0000-0000-0000-000000000000/finalize', { version: 1 }],
      ['POST', '/api/manufacturing-sheets/previews/pdf', {}]];
    for (const [m, p, b] of escrituras) { const r = await fetch(base + p, { method: m, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) }); ok(r.status === 503 && r.headers.get('x-hub-window') === 'closed-v1', `cerrado: ${m} ${p.slice(0, 70)} → 503 (${r.status})`); }
    const lee = await fetch(base + '/api/manufacturing-sheets/documents/open', { headers: { cookie } }); ok(lee.status === 200, `cerrado: la lectura sigue disponible (${lee.status})`);
    const despues = huella(); ok(antes === despues, 'cerrado: NINGUNA tabla de manufactura cambió (mismas filas y misma última transacción en las 9 tablas)', antes + ' -> ' + despues);
  }
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: todo PASS'); process.exit(fails ? 1 : 0);
})();
