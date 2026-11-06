const base = process.argv[2]; const mode = process.argv[3]; // 'disabled' | 'enabled'
const PW = process.env.ENSAYO_PASSWORD;
if (!PW) { console.error('Define ENSAYO_PASSWORD (contrasena de los usuarios sinteticos de la replica).'); process.exit(2); }
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function login(email) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const c = r.headers.getSetCookie().find((x) => x.startsWith('daubert_session='));
  return { status: r.status, cookie: c ? c.split(';')[0] : null };
}
const call = async (who, method, path, body) => { const r = await fetch(base + '/api' + path, { method, headers: { cookie: who.cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
(async () => {
  const admin = await login('admin1@example.invalid'); const gen = await login('g2@example.invalid');
  ok(admin.status === 200 && gen.status === 200, 'login ADMIN y GENERAL');
  for (const [n, w] of [['ADMIN', admin], ['GENERAL', gen]]) {
    ok((await call(w, 'GET', '/clients')).status === 200, `${n}: GET /clients (módulo existente) 200`);
    ok((await call(w, 'GET', '/automations/overview')).status === 200, `${n}: GET /automations/overview 200`);
    ok((await call(w, 'GET', '/recent-activity')).status === 200, `${n}: GET /recent-activity 200`);
    const rutas = [['GET', '/manufacturing-sheets/documents/capabilities'], ['GET', '/manufacturing-sheets/documents/open'], ['GET', '/manufacturing-sheets/client-abbreviations'], ['GET', '/manufacturing-sheets/families'], ['GET', '/manufacturing-sheets/bind-products/recent'], ['POST', '/manufacturing-sheets/previews', { familia: 'BOLSA_PLANA_1', datos: {} }], ['POST', '/manufacturing-sheets/documents/drafts', { codigo: 'DOC1', familia: 'BOLSA_PLANA_1', datos: { codigo: 'DOC1' } }]];
    for (const [m, p, b] of rutas) {
      const r = await call(w, m, p, b);
      if (mode === 'disabled') ok(r.status === 404, `${n}: ${m} ${p} → 404 con Manufactura deshabilitada (fue ${r.status})`);
      else ok(r.status !== 404, `${n}: ${m} ${p} responde (no 404) con Manufactura habilitada (fue ${r.status})`);
    }
  }
  if (mode === 'enabled') {
    const cap = await call(admin, 'GET', '/manufacturing-sheets/documents/capabilities');
    ok(cap.body?.entorno === 'PRODUCCION', `capabilities informa entorno PRODUCCION (${JSON.stringify(cap.body)})`);
    ok((await call(admin, 'GET', '/manufacturing-sheets/documents/signatures-admin?sinCuenta=true')).status === 200, 'ADMIN: signatures-admin 200');
    ok((await call(gen, 'GET', '/manufacturing-sheets/documents/signatures-admin?sinCuenta=true')).status === 403, 'GENERAL: signatures-admin 403');
    ok((await call(gen, 'GET', '/manufacturing-sheets/documents/signatures')).status === 200, 'GENERAL: sus firmas 200');
    const noAuth = await fetch(base + '/api/manufacturing-sheets/documents/capabilities');
    ok(noAuth.status === 401, `sin sesión → 401 aunque esté habilitado (fue ${noAuth.status})`);
  } else {
    const noAuth = await fetch(base + '/api/manufacturing-sheets/documents/capabilities');
    ok([401, 404].includes(noAuth.status), `sin sesión → ${noAuth.status}`);
  }
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: todo PASS'); process.exit(fails ? 1 : 0);
})();
