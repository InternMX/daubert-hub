// Validación funcional corta de Manufactura en TEST (http://127.0.0.1:8081) con las cuentas de DEMOSTRACIÓN, y preparación de los documentos de la sesión.
//   node validacion-test-demo.cjs <credenciales.json fuera del repo> <carpeta de evidencia fuera del repo>
// Solo habla con TEST por loopback. No imprime contraseñas ni cookies. Crea datos de demostración en daubert_hub_test (códigos DEMOFPMG101/102); no modifica ni borra datos existentes.
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib');
const [credFile, evid] = process.argv.slice(2);
if (!credFile || !evid) { console.error('Uso: node validacion-test-demo.cjs <credenciales.json> <carpeta>'); process.exit(2); }
const BASE = 'http://127.0.0.1:8081'; const D = '/manufacturing-sheets/documents';
if (!/^http:\/\/127\.0\.0\.1:8081$/.test(BASE)) process.exit(2);
fs.mkdirSync(evid, { recursive: true });
const C = JSON.parse(fs.readFileSync(credFile, 'utf8'));
let fails = 0; const res = [];
const ok = (c, m, x) => { res.push({ ok: !!c, m }); console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 220))); if (!c) fails++; };
const info = (m) => console.log('INFO ' + m);
const tabla = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tabla[i] = c >>> 0; }
const crc = (b) => { let r = 0xffffffff; for (const x of b) r = tabla[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (w, h, s) => { const raw = Buffer.alloc((w * 3 + 1) * h, 255); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const v = ((x * 7 + y * 3 + s) % 53 < 4) ? 20 : 255; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; } } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); };
const datos = (codigo, extra = {}) => ({ codigo, descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS (DEMOSTRACIÓN)', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.0428', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', ...extra });
async function login(c) { const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) }); const j = await r.json().catch(() => null); const k = (r.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')) ?? '').split(';')[0]; return { status: r.status, cookie: k, user: j?.data?.user }; }
const call = async (w, m, p, b) => { const r = await fetch(BASE + '/api' + p, { method: m, headers: { ...(w ? { cookie: w.cookie } : {}), ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch { /* binario */ } return { status: r.status, body: j, buf, type: r.headers.get('content-type') ?? '', disp: r.headers.get('content-disposition') ?? '' }; };
const subirFirma = async (w, img) => { const fd = new FormData(); fd.append('archivo', new Blob([img], { type: 'image/png' }), 'firma.png'); const r = await fetch(`${BASE}/api${D}/signatures`, { method: 'POST', headers: { cookie: w.cookie }, body: fd }); return { status: r.status, body: await r.json().catch(() => null) }; };
const v = (x) => x?.data ?? x;

(async () => {
  // ---- Inicio de sesión
  const adm = await login(C.admin); const g1 = await login(C.general1); const g2 = await login(C.general2);
  ok(adm.status === 200 && adm.user?.role === 'ADMIN', `inicio de sesión ADMIN (${adm.status})`);
  ok(g1.status === 200 && g1.user?.role === 'GENERAL' && g2.status === 200 && g2.user?.role === 'GENERAL', `inicio de sesión de las dos GENERAL (${g1.status}, ${g2.status})`);
  // ---- Salud y módulos existentes
  const h = await (await fetch(BASE + '/api/health')).json(); ok(h.environment === 'TEST' && h.database === 'connected', `salud TEST (${h.environment}, ${h.commit})`);
  for (const p of ['/clients', '/automations/overview', '/recent-activity']) for (const [n, w] of [['ADMIN', adm], ['GENERAL', g1]]) { const r = await call(w, 'GET', p); ok(r.status === 200, `${n}: GET ${p} 200 (${r.status})`); }
  // ---- Permisos
  ok((await call(g1, 'GET', '/users')).status === 403, 'GENERAL no administra usuarios (403)');
  ok((await call(g1, 'POST', '/clients', { commercialName: 'No debe crearse' })).status === 403, 'GENERAL no da de alta clientes (403)');
  ok((await call(adm, 'GET', '/users')).status === 200, 'ADMIN administra usuarios (200)');
  ok((await call(null, 'GET', `${D}/open`)).status === 401, 'sin sesión: rutas de Manufactura 401');
  const cap = await call(g1, 'GET', `${D}/capabilities`); ok(cap.status === 200 && v(cap.body)?.entorno === 'PRUEBA', `capacidades: entorno de emisión PRUEBA (${JSON.stringify(v(cap.body))})`);
  // ---- BIND
  const bind = await call(g1, 'GET', '/manufacturing-sheets/bind-products/by-code/SCHFPMG001');
  info(`BIND: GET by-code → ${bind.status} ${JSON.stringify(bind.body)}`);
  ok(bind.status === 503, 'BIND sin credenciales en TEST: la consulta responde 503 «no configurado» y la hoja se captura a mano');
  // ---- Cliente del catálogo
  const cl = await call(adm, 'GET', '/clients'); const clientes = (v(cl.body) ?? []).filter((c) => c.status === 'ACTIVO' || c.status === 'ACTIVE');
  const cliente = clientes.find((c) => /AUDI/i.test(c.commercialName)) ?? clientes[0]; ok(Boolean(cliente), `cliente del catálogo para la demostración: ${cliente?.commercialName} (id ${cliente?.id}); clientes activos: ${clientes.map((c) => c.commercialName).join(', ')}`);
  // ---- Borrador (captura manual) y autoguardado
  const A = 'DEMOFPMG101';
  const d = await call(g1, 'POST', `${D}/drafts`, { codigo: A, familia: 'BOLSA_PLANA_1', datos: datos(A) });
  ok(d.status === 201, `GENERAL 1 crea el borrador ${A} con captura manual (${d.status})`, d.body);
  let rev = d.body; let ver = rev?.version;
  const a1 = await call(g1, 'PATCH', `${D}/revisions/${rev.id}`, { version: ver, datos: datos(A, { cantidad: '250' }) });
  ok(a1.status === 200 && a1.body.version === ver + 1, `autoguardado: cambio de cantidad guardado (versión ${ver} → ${a1.body?.version})`, a1.body); ver = a1.body.version;
  const leido = await call(g1, 'GET', `${D}/revisions/${rev.id}`); ok(JSON.stringify(leido.body).includes('"250"'), 'al volver a abrir, el borrador conserva el cambio');
  const vieja = await call(g1, 'PATCH', `${D}/revisions/${rev.id}`, { version: ver - 1, datos: datos(A, { cantidad: '300' }) }); ok(vieja.status === 409, `una versión desfasada no sobrescribe (409, ${vieja.status})`);
  // ---- Borradores del equipo
  const open2 = await call(g2, 'GET', `${D}/team`); ok(JSON.stringify(open2.body).includes(A), 'GENERAL 2 ve el borrador de GENERAL 1 en los borradores del equipo (GET team, consulta compartida)');
  const ver2 = await call(g2, 'GET', `${D}/revisions/${rev.id}`); ok(ver2.status === 200, `GENERAL 2 lo abre en consulta (${ver2.status})`);
  const ed2 = await call(g2, 'PATCH', `${D}/revisions/${rev.id}`, { version: ver, datos: datos(A, { cantidad: '999' }) }); ok(ed2.status >= 400, `GENERAL 2 NO puede modificarlo (${ed2.status})`);
  // ---- Firmas y autorizaciones
  const fG1 = await subirFirma(g1, png(600, 200, 1)); ok(fG1.status === 201 && fG1.body?.propia === true, `GENERAL 1 carga su firma (${fG1.status})`, fG1.body);
  const fAd = await subirFirma(adm, png(600, 200, 7)); ok(fAd.status === 201, `ADMIN carga su firma (${fAd.status})`, fAd.body);
  const usoSin = await call(g1, 'PATCH', `${D}/revisions/${rev.id}`, { version: ver, responsables: [{ funcion: 'REVISO', nombre: 'x', firmaId: fAd.body?.id }] }); ok(usoSin.status >= 400, `usar la firma de ADMIN sin autorización se rechaza (${usoSin.status})`);
  const aut = await call(adm, 'POST', `${D}/signatures/${fAd.body?.id}/authorize`, { usuarioId: g1.user.id }); ok(aut.status === 200, `ADMIN autoriza a GENERAL 1 a usar su firma (${aut.status})`, aut.body);
  const resp = await call(g1, 'PATCH', `${D}/revisions/${rev.id}`, { version: ver, cliente: { empresaId: cliente.id }, elaboroNombre: 'Demo General Uno', elaboroConfirmado: true,
    responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: fG1.body?.id }, { funcion: 'REVISO', nombre: 'x', firmaId: fAd.body?.id }, { funcion: 'APROBO', nombre: 'Aprobación Demo (sin firma)' }] });
  ok(resp.status === 200, `responsables Generó (firma propia), Revisó (firma autorizada de ADMIN) y Aprobó (sin firma) asignados (${resp.status})`, resp.body); ver = resp.body?.version;
  // ---- Finalización y PDF
  const fin = await call(g1, 'POST', `${D}/revisions/${rev.id}/finalize`, { version: ver });
  ok(fin.status === 200 && fin.body?.estado === 'FINALIZADA' && fin.body?.revision === 1 && fin.body?.entorno === 'PRUEBA', `finalización: FINALIZADA, REV01, entorno PRUEBA (${fin.status})`, fin.body);
  const pdf = await call(g1, 'GET', `${D}/revisions/${rev.id}/pdf`);
  ok(pdf.status === 200 && /application\/pdf/.test(pdf.type) && pdf.buf.slice(0, 5).toString() === '%PDF-', `descarga del PDF (${pdf.status}, ${pdf.buf.length} bytes, ${pdf.disp})`);
  fs.writeFileSync(path.join(evid, `${A}_REV01.pdf`), pdf.buf);
  const inm = await call(g1, 'PATCH', `${D}/revisions/${rev.id}`, { version: fin.body?.version ?? ver + 1, datos: datos(A, { cantidad: '1' }) }); ok(inm.status >= 400, `la hoja finalizada es inmutable (${inm.status})`);
  // ---- Nueva revisión (REV02) y su finalización
  const g2nueva = await call(g2, 'POST', `${D}/${fin.body.documentoId}/revisions`); ok(g2nueva.status === 403, `GENERAL 2 (no autora) no abre una nueva revisión (${g2nueva.status})`);
  const nueva = await call(g1, 'POST', `${D}/${fin.body.documentoId}/revisions`); ok(nueva.status === 201 && nueva.body?.basadaEnRevision === 1, `GENERAL 1 abre la nueva revisión basada en REV01 (${nueva.status})`, nueva.body);
  const pN = await call(g1, 'PATCH', `${D}/revisions/${nueva.body.id}`, { version: nueva.body.version, datos: datos(A, { cantidad: '300' }), cliente: { empresaId: cliente.id }, elaboroNombre: 'Demo General Uno', elaboroConfirmado: true,
    responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: fG1.body?.id }, { funcion: 'REVISO', nombre: 'x', firmaId: fAd.body?.id }, { funcion: 'APROBO', nombre: 'Aprobación Demo (sin firma)' }] });
  ok(pN.status === 200, `REV02: cantidad cambiada a 300 (${pN.status})`, pN.body);
  const finN = await call(g1, 'POST', `${D}/revisions/${nueva.body.id}/finalize`, { version: pN.body?.version }); ok(finN.status === 200 && finN.body?.revision === 2, `REV02 finalizada (${finN.status})`, finN.body);
  const pdf2 = await call(g1, 'GET', `${D}/revisions/${nueva.body.id}/pdf`); ok(pdf2.status === 200, `PDF de REV02 (${pdf2.buf.length} bytes)`); fs.writeFileSync(path.join(evid, `${A}_REV02.pdf`), pdf2.buf);
  const pdf1 = await call(g2, 'GET', `${D}/revisions/${rev.id}/pdf`); ok(pdf1.status === 200 && pdf1.buf.equals(pdf.buf), 'la REV01 conserva su PDF y la puede descargar otra cuenta');
  const hist = await call(g2, 'GET', `${D}/history?codigo=${A}`); ok(JSON.stringify(hist.body).includes(A), 'el historial muestra el documento');
  // ---- Segunda hoja finalizada (otro formato) para mostrar el PDF sin esperar
  const B = 'DEMOFPMG102';
  const dB = await call(g2, 'POST', `${D}/drafts`, { codigo: B, familia: 'HOJA_PAQ', datos: datos(B, { modalidad: 'DOBLADA', producto: 'Hojas', descripcion: 'HOJAS VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 (DEMOSTRACIÓN)', cantidadUnidad: 'HOJAS' }) });
  ok(dB.status === 201, `GENERAL 2 crea ${B} (Hojas) (${dB.status})`, dB.body);
  const pB = await call(g2, 'PATCH', `${D}/revisions/${dB.body.id}`, { version: dB.body.version, cliente: { empresaId: cliente.id }, elaboroNombre: 'Demo General Dos', elaboroConfirmado: true });
  ok(pB.status === 200, `${B}: cliente y Generó (${pB.status})`, pB.body);
  const fB = await call(g2, 'POST', `${D}/revisions/${dB.body.id}/finalize`, { version: pB.body?.version }); ok(fB.status === 200 && fB.body?.estado === 'FINALIZADA', `${B} finalizada (${fB.status})`, fB.body);
  const pdfB = await call(g2, 'GET', `${D}/revisions/${dB.body.id}/pdf`); if (pdfB.status === 200) fs.writeFileSync(path.join(evid, `${B}_REV01.pdf`), pdfB.buf);
  // ---- Actividad reciente
  const act = await call(adm, 'GET', '/recent-activity?limit=20&category=AUTOMATION'); const items = (act.body?.data ?? []).filter((i) => i.entity === A || i.entity === B);
  info('Actividad reciente: ' + items.map((i) => `${i.entity} · ${i.title} · ${i.context}`).join(' | '));
  ok(items.some((i) => i.entity === A && i.type === 'MANUFACTURING_REVISION_FINALIZED' && /REV02/.test(i.context)) && items.some((i) => i.entity === A && i.type === 'MANUFACTURING_REVISION_CREATED') && items.some((i) => i.entity === B), 'Actividad reciente muestra creación, finalizaciones (REV01, REV02) y la nueva revisión, con enlace');
  ok(items.every((i) => typeof i.link === 'string' && i.link.startsWith('/automations/manufacturing-sheets?revision=')), 'cada evento enlaza a su hoja');
  fs.writeFileSync(path.join(evid, 'documentos-demo.json'), JSON.stringify({ cliente: { id: cliente.id, nombre: cliente.commercialName }, A: { codigo: A, rev01: rev.id, rev02: nueva.body.id, documentoId: fin.body.documentoId }, B: { codigo: B, rev01: dB.body.id }, firmas: { general1: fG1.body?.id, admin: fAd.body?.id } }, null, 1));
  console.log(fails ? `RESULTADO: ${fails} FAIL de ${res.length}` : `RESULTADO: todo PASS (${res.length})`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR ' + e.message); process.exit(1); });
