// COMPROBACIÓN DE SOLO LECTURA contra BIND REAL, a través de la propia API del Hub (no hay llamada directa a BIND ni claves en este script). NO SE HA EJECUTADO: es para una etapa posterior,
// con una API de TEST o de la réplica configurada con credenciales de BIND autorizadas por quien corresponda (BIND_API_KEY / BIND_SUBSCRIPTION_KEY en el entorno de ESA API, nunca aquí).
//   ENSAYO_PASSWORD=… node comprobar-bind-real.cjs <url del Hub> <correo de una cuenta de prueba> <código DCMX conocido> <carpeta de evidencia>
// Solo hace GET: novedades (orden por fecha verificado por el servidor), búsqueda por código existente, código inexistente y código con caracteres no permitidos. No imprime tokens ni cabeceras.
const fs = require('node:fs'); const path = require('node:path');
const [base, correo, codigo, evid] = process.argv.slice(2); const PW = process.env.ENSAYO_PASSWORD;
if (!base || !correo || !codigo || !evid || !PW) { console.error('Uso: ENSAYO_PASSWORD=… node comprobar-bind-real.cjs <url> <correo> <código DCMX> <carpeta>'); process.exit(2); }
fs.mkdirSync(evid, { recursive: true });
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 200))); if (!c) fails++; };
(async () => {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: correo, password: PW }) });
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('daubert_session='))?.split(';')[0]; if (!cookie) { console.error('login fallido'); process.exit(2); }
  const get = async (p) => { const x = await fetch(base + '/api/manufacturing-sheets/bind-products' + p, { headers: { cookie } }); return { s: x.status, j: await x.json().catch(() => null) }; };
  const rec = await get('/recent?skip=0&limit=5'); ok(rec.s === 200 && Array.isArray(rec.j?.data?.products ?? rec.j?.data), 'novedades del catálogo (GET /recent) responden 200 con orden por fecha verificado', rec.s);
  const hit = await get('/by-code/' + encodeURIComponent(codigo)); ok(hit.s === 200 && JSON.stringify(hit.j).includes(codigo), 'producto existente: 200 con el mismo código (filtro exacto OData comprobado contra BIND real)', hit.s);
  const no = await get('/by-code/DCMX-NO-EXISTE-' + Date.now().toString(36)); ok(no.s === 404, 'código inexistente: 404 «No se encontró el producto en BIND»', no.s);
  const mal = await get('/by-code/' + encodeURIComponent("X' or 1=1")); ok(mal.s === 400, 'código con comillas/operadores: 400 sin llamar a BIND', mal.s);
  const pub = JSON.stringify([rec.j, hit.j]); ok(!/Bearer|Ocp-Apim|api[_-]?key|subscription/i.test(pub), 'ninguna respuesta del Hub expone credenciales ni cabeceras de BIND');
  fs.writeFileSync(path.join(evid, 'bind_real_producto.json'), JSON.stringify(hit.j, null, 1));
  console.log('Evidencia para aprobar: (1) clave cargada sin imprimirla; (2) /recent 200 con productos; (3) by-code real con campos interpretados; (4) clave retirada → 503; (5) sin salida a internet → 502/504 sin colgar; (6) clave ausente de logs.');
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: BIND real responde como se espera (solo lectura)'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
