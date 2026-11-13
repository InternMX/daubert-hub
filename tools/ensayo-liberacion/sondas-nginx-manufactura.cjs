// Sondas de nginx para Manufactura (Fase 6C.3). SOLO réplicas/ensayos: envía escrituras SIN sesión (el API responde 401 y no escribe nada) y, con ENSAYO_PASSWORD, lecturas autenticadas.
//   node sondas-nginx-manufactura.cjs <url> abierto|cerrado [idRevisionFinalizada]
// abierto: el límite de 3 MB aplica SOLO a la ruta exacta POST /api/manufacturing-sheets/documents/signatures; todo lo demás conserva 1 MB (413 de nginx).
// cerrado: toda escritura bajo /api/manufacturing-sheets responde 503 con X-Hub-Window: closed-v1 ANTES de leer el cuerpo (ni 413 ni llega al API); las lecturas siguen disponibles.
const base = process.argv[2]; const modo = process.argv[3]; const REV = process.argv[4]; const PW = process.env.ENSAYO_PASSWORD;
if (!base || !['abierto', 'cerrado'].includes(modo)) { console.error('Uso: node sondas-nginx-manufactura.cjs <url> abierto|cerrado [revision]'); process.exit(2); }
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + String(x).replace(/\s+/g, ' ').slice(0, 160))); if (!c) fails++; };
const M = '/api/manufacturing-sheets';
async function envio(method, ruta, bytes, extra = {}) {
  const headers = { ...extra }; let body;
  if (bytes) { const fd = new FormData(); fd.append('archivo', new Blob([Buffer.alloc(bytes, 97)], { type: 'image/png' }), 'firma.png'); body = fd; }
  else if (method !== 'GET' && method !== 'HEAD') { headers['content-type'] = 'application/json'; body = '{}'; }
  try {
    const r = await fetch(base + ruta, { method, headers, body }); const t = method === 'HEAD' ? '' : await r.text();
    return { s: r.status, nginx413: r.status === 413 && /<html/i.test(t), ventana: r.headers.get('x-hub-window'), t };
  } catch (e) { return { s: 0, nginx413: false, ventana: null, t: 'ERROR ' + (e.cause?.code ?? e.message) }; }
}
const MB = 1024 * 1024;
(async () => {
  if (modo === 'abierto') {
    const pasa = async (n, ruta, bytes) => { const r = await envio('POST', ruta, bytes); ok(r.s !== 0 && r.s !== 413 && r.s !== 503, `${n}: nginx la deja pasar al API (${r.s})`, r.t); };
    const corta = async (n, ruta, bytes) => { const r = await envio('POST', ruta, bytes); ok(r.nginx413 || r.s === 0, `${n}: nginx la rechaza por tamaño (${r.s === 0 ? 'conexión cortada' : r.s})`, r.t); };
    await pasa('firma de 0,5 MB en la ruta de firmas', `${M}/documents/signatures`, 0.5 * MB);
    await pasa('firma de 1,5 MB en la ruta de firmas', `${M}/documents/signatures`, 1.5 * MB);
    await pasa('firma de 2,8 MB en la ruta de firmas (bajo el límite de nginx; el API aplica su propio tope de 2 MB)', `${M}/documents/signatures`, 2.8 * MB);
    await corta('firma de 3,5 MB en la ruta de firmas', `${M}/documents/signatures`, 3.5 * MB);
    await corta('1,5 MB en /signatures/ (con barra final: no es la ruta exacta)', `${M}/documents/signatures/`, 1.5 * MB);
    await corta('1,5 MB en /signatures/0/authorize', `${M}/documents/signatures/0/authorize`, 1.5 * MB);
    await corta('1,5 MB en /documents/drafts', `${M}/documents/drafts`, 1.5 * MB);
    await corta('1,5 MB en /client-abbreviations', `${M}/client-abbreviations`, 1.5 * MB);
    await corta('1,5 MB en /previews/pdf', `${M}/previews/pdf`, 1.5 * MB);
    await corta('1,5 MB en /api/clients (otro módulo)', '/api/clients', 1.5 * MB);
    await corta('1,5 MB en /api/auth/login', '/api/auth/login', 1.5 * MB);
    await pasa('0,5 MB en /documents/drafts (bajo el límite general de 1 MB)', `${M}/documents/drafts`, 0.5 * MB);
    const w = await envio('POST', `${M}/documents/drafts`); ok(w.s !== 503 && !w.ventana, `ventana abierta: una escritura de Manufactura no recibe 503 ni cabecera de cierre (${w.s})`);
  } else {
    const escrituras = [['POST', `${M}/documents/drafts`], ['PATCH', `${M}/documents/revisions/0`], ['POST', `${M}/documents/revisions/0/finalize`], ['POST', `${M}/documents/revisions/0/discard`], ['PUT', `${M}/documents/revisions/0/reviewer`],
      ['POST', `${M}/documents/revisions/0/review`], ['POST', `${M}/documents/revisions/0/cancel-finalization`], ['POST', `${M}/documents/0/revisions`], ['POST', `${M}/documents/signatures`], ['POST', `${M}/documents/signatures/0/authorize`],
      ['POST', `${M}/documents/signatures/0/revoke`], ['POST', `${M}/documents/signatures/0/retire`], ['POST', `${M}/client-abbreviations`], ['POST', `${M}/client-abbreviations/0/resolve`], ['POST', `${M}/previews`], ['POST', `${M}/previews/pdf`],
      ['DELETE', `${M}/documents/revisions/0`], ['POST', '/API/Manufacturing-Sheets/Documents/Drafts'], ['POST', M]];
    for (const [m, p] of escrituras) { const r = await envio(m, p); ok(r.s === 503 && r.ventana === 'closed-v1', `cerrado: ${m} ${p} → 503 de la ventana (${r.s})`, r.t); }
    for (const mb of [0.5, 1.5, 3.5]) { const r = await envio('POST', `${M}/documents/signatures`, mb * MB); ok(r.s === 503 && r.ventana === 'closed-v1', `cerrado: carga de firma de ${mb} MB → 503 (ni 413 ni llega al API) (${r.s || r.t})`, r.t); }
    const sonda = await envio('GET', `${M}/documents/drafts`, 0, { 'x-hub-window-probe': 'POST' }); ok(sonda.s === 503, `cerrado: sonda GET + X-Hub-Window-Probe: POST → 503 (${sonda.s})`);
    const lee = await envio('GET', `${M}/documents/open`); ok(lee.s !== 503 && lee.s !== 0, `cerrado: una LECTURA de Manufactura no se bloquea (${lee.s})`);
    const salud = await envio('GET', '/api/health'); ok(salud.s === 200, `cerrado: /api/health 200 (${salud.s})`);
    const login = await envio('POST', '/api/auth/login'); ok(login.s !== 503 && login.s !== 0, `cerrado: el inicio de sesión no se bloquea (${login.s})`);
    const pago = await envio('POST', '/api/automations/payment-notifications/0/reprocess'); ok(pago.s === 503, `cerrado: las escrituras de Pagos siguen bloqueadas (${pago.s})`);
  }
  if (PW) {
    const l = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.ENSAYO_ADMIN || 'admin1@example.invalid', password: PW }) });
    const cookie = (l.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')) ?? '').split(';')[0];
    ok(l.status === 200 && Boolean(cookie), `con sesión (${modo}): inicio de sesión 200 (${l.status})`);
    const g = async (p) => { const r = await fetch(base + p, { headers: { cookie } }); const b = Buffer.from(await r.arrayBuffer()); return { s: r.status, b, tipo: r.headers.get('content-type') ?? '' }; };
    const ab = await g(`${M}/documents/open`); ok(ab.s === 200, `con sesión (${modo}): GET documents/open 200 (${ab.s})`);
    const cl = await g('/api/clients'); ok(cl.s === 200, `con sesión (${modo}): GET /api/clients 200 (${cl.s})`);
    if (REV) { const p = await g(`${M}/documents/revisions/${REV}/pdf`); ok(p.s === 200 && /pdf/.test(p.tipo) && p.b.slice(0, 5).toString() === '%PDF-', `con sesión (${modo}): el PDF de una hoja FINALIZADA se descarga (${p.s}, ${p.b.length} bytes)`); }
    const fd = new FormData(); fd.append('archivo', new Blob([Buffer.alloc(200_000, 97)], { type: 'image/png' }), 'firma.png');
    const w = await fetch(base + `${M}/documents/drafts`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    if (modo === 'cerrado') ok(w.status === 503, `con sesión (cerrado): crear borrador → 503 (${w.status})`); else ok(w.status !== 503, `con sesión (abierto): crear borrador llega al API (${w.status})`);
    const s = await fetch(base + `${M}/documents/signatures`, { method: 'POST', headers: { cookie }, body: fd });
    if (modo === 'cerrado') ok(s.status === 503, `con sesión (cerrado): carga de firma → 503 (${s.status})`); else ok(s.status !== 503 && s.status !== 413, `con sesión (abierto): la carga de firma llega al API (${s.status})`);
  }
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: todo PASS'); process.exit(fails ? 1 : 0);
})();
