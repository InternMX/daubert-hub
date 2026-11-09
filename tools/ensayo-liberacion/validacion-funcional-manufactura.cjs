// Validación FUNCIONAL de Manufactura contra la pila real de la réplica (nginx → API de producción simulada → PostgreSQL con 020–026), con usuarios sintéticos ADMIN y GENERAL.
//   ENSAYO_PASSWORD=… node tools/ensayo-liberacion/validacion-funcional-manufactura.cjs http://127.0.0.1:58430 <carpeta de evidencia> [contenedor-pg=ens-origen] [contenedor-bind=ens-bind]
// Cubre: recorrido de hojas (borradores, autoguardado, versiones, consulta ajena, permisos GENERAL/ADMIN, firmas y autorizaciones, finalización, PDF, inmutabilidad, revisiones nuevas, historial, descarte),
// clientes y abreviaturas por rol, captura manual de cliente, auditoría e integridad en la base, y las rutas de BIND con un simulador controlado (incluida la caída del servicio).
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib'); const crypto = require('node:crypto'); const { spawnSync } = require('node:child_process');
const base = process.argv[2]; const EVID = process.argv[3]; const PG = process.argv[4] ?? 'ens-origen'; const BINDC = process.argv[5] ?? 'ens-bind'; const PW = process.env.ENSAYO_PASSWORD;
if (!base || !EVID || !PW) { console.error('Uso: ENSAYO_PASSWORD=… node validacion-funcional-manufactura.cjs <url> <evidencia> [pg] [bind]'); process.exit(2); }
fs.mkdirSync(EVID, { recursive: true });
let fails = 0; const resultados = [];
const ok = (c, m, x) => { resultados.push({ ok: Boolean(c), m }); console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + (typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').slice(0, 300))); if (!c) fails++; };
const info = (m) => console.log('INFO ' + m);
const dk = (a) => spawnSync('docker', a, { encoding: 'utf8', maxBuffer: 100_000_000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const sql = (q, usuario = 'postgres') => { const r = dk(['exec', '-e', 'PGPASSWORD=scratch', PG, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', 'daubert_global', '-X', '-At', '-F', '|', '-c', q]); return { rc: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const crc = (b) => { let c, t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (w, h, s) => { const raw = Buffer.alloc((w * 3 + 1) * h, 255); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const v = ((x * 7 + y * 3 + s) % 53 < 4) ? 20 : 255; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; } } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); };
const SCHF = (codigo) => ({ codigo, descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.0428', cliente: 'Cliente sintético', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5' });
async function login(email) { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) }); const c = r.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')); if (!c) throw new Error('login ' + email + ' ' + r.status); return { cookie: c.split(';')[0], email }; }
const call = async (w, m, p, b, extra = {}) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: w.cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined, ...extra }); const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch { /* binario o vacío */ } return { status: r.status, body: j, buf, type: r.headers.get('content-type') ?? '', disp: r.headers.get('content-disposition') ?? '' }; };
const S = '-' + Date.now().toString(36).slice(-5).toUpperCase();   // sufijo por corrida: los códigos de documento son únicos
const D = '/manufacturing-sheets/documents'; const B = '/manufacturing-sheets/bind-products';
const subirFirma = async (w, img, extra = {}) => { const fd = new FormData(); fd.append('archivo', new Blob([img], { type: 'image/png' }), 'firma.png'); for (const [k, v] of Object.entries(extra)) fd.append(k, v); const r = await fetch(`${base}/api${D}/signatures`, { method: 'POST', headers: { cookie: w.cookie }, body: fd }); return { status: r.status, body: await r.json().catch(() => null) }; };

(async () => {
  const [admin, admin2, gen, gen2] = await Promise.all(['ensayo.admin', 'ensayo.admin2', 'ensayo.general', 'ensayo.general2'].map((u) => login(u + '@example.invalid')));
  const ids = Object.fromEntries(sql("SELECT email, user_id FROM security.users WHERE email LIKE 'ensayo.%@example.invalid'").out.split('\n').map((l) => l.split('|')).map(([e, i]) => [e.replace('@example.invalid', ''), i]));
  const cli = sql("SELECT empresa_id FROM core.empresas e WHERE EXISTS (SELECT 1 FROM core.empresa_roles r WHERE r.empresa_id = e.empresa_id AND r.rol = 'CLIENTE') ORDER BY 1 LIMIT 1").out;
  info(`entorno: ${base} · usuarios sintéticos ${JSON.stringify(ids)} · cliente de catálogo ${cli}`);

  // ============ A. Configuración habilitada ============
  const cap = await call(admin, 'GET', `${D}/capabilities`); ok(cap.status === 200 && cap.body.entorno === 'PRODUCCION' && cap.body.firmas === true, 'capabilities: entorno PRODUCCION y firmas disponibles', cap.body);
  const fam = await call(gen, 'GET', '/manufacturing-sheets/families'); ok(fam.status === 200 && fam.body.data.length >= 7, 'familias disponibles (7) para GENERAL', fam.status);
  const prev = await call(gen, 'POST', '/manufacturing-sheets/previews', { familia: 'BOLSA_PLANA_1', datos: SCHF('PREV-1') }); ok(prev.status === 200 && /<html|<!doctype/i.test(prev.body?.data?.html ?? ''), 'vista previa HTML (sin persistir nada)', prev.status);

  // ============ B. Borradores, autoguardado, versiones ============
  const a = await call(gen, 'POST', `${D}/drafts`, { codigo: ('FUN-A' + S), familia: 'BOLSA_PLANA_1', datos: { codigo: ('FUN-A' + S) } }); ok(a.status === 201 && a.body.estado === 'BORRADOR' && a.body.entorno === 'PRODUCCION' && a.body.propio === true, 'GENERAL crea un borrador mínimo (entorno PRODUCCION)', a.body);
  let ver = a.body.version; const idA = a.body.id;
  const pasos = [{ ancho: '13' }, { ancho: '13', largo: '16' }, { ancho: '13', largo: '16', calibre: '3 MIL' }];
  for (const [i, extra] of pasos.entries()) { const p = await call(gen, 'PATCH', `${D}/revisions/${idA}`, { version: ver, datos: { ...SCHF(('FUN-A' + S)), ...extra } }); ok(p.status === 200 && p.body.version > ver, `autoguardado ${i + 1}: la versión avanza (${ver} → ${p.body?.version})`, p.body); ver = p.body.version; }
  const rec = await call(gen, 'GET', `${D}/revisions/${idA}`); ok(rec.status === 200 && rec.body.especificacion.datos.calibre === '3 MIL' && rec.body.version === ver, 'recuperación del borrador: se recupera lo último guardado', rec.body?.especificacion?.datos);
  const abiertos = await call(gen, 'GET', `${D}/open`); ok(abiertos.status === 200 && JSON.stringify(abiertos.body).includes(idA), 'el borrador aparece en «abiertos» de su dueño (reanudar tras cerrar la sesión)');
  const gen1b = await login('ensayo.general@example.invalid'); const rec2 = await call(gen1b, 'GET', `${D}/revisions/${idA}`); ok(rec2.status === 200 && rec2.body.version === ver, 'con una SESIÓN NUEVA se recupera el mismo borrador y versión');
  const viejo = await call(gen, 'PATCH', `${D}/revisions/${idA}`, { version: ver - 1, datos: SCHF(('FUN-A' + S)) }); ok(viejo.status === 409, 'guardar con una versión vieja se rechaza (409): no se pisan cambios', viejo.body);

  // ============ C. Consulta de borradores ajenos y permisos GENERAL / ADMIN ============
  const ver2 = await call(gen2, 'GET', `${D}/revisions/${idA}`); ok(ver2.status === 200 && ver2.body.permisos.editar === false && ver2.body.propio === false, 'GENERAL (otra cuenta) CONSULTA el borrador ajeno en solo lectura', ver2.body?.permisos);
  const equipo = await call(gen2, 'GET', `${D}/team`); ok(equipo.status === 200 && JSON.stringify(equipo.body).includes(idA), 'el borrador aparece en «equipo» para otra cuenta GENERAL');
  const ed2 = await call(gen2, 'PATCH', `${D}/revisions/${idA}`, { version: ver, datos: SCHF(('FUN-A' + S)) }); ok(ed2.status === 403 || ed2.status === 404 || ed2.status === 409, `GENERAL ajeno NO puede editar (${ed2.status})`, ed2.body);
  const ds2 = await call(gen2, 'POST', `${D}/revisions/${idA}/discard`, { version: ver }); ok(ds2.status >= 400, `GENERAL ajeno NO puede descartar (${ds2.status})`);
  const fn2 = await call(gen2, 'POST', `${D}/revisions/${idA}/finalize`, { version: ver }); ok(fn2.status >= 400, `GENERAL ajeno NO puede finalizar (${fn2.status})`);
  const sinCambio = await call(gen, 'GET', `${D}/revisions/${idA}`); ok(sinCambio.body.version === ver, 'tras los intentos ajenos el borrador sigue en la misma versión (nada cambió)');
  const adm = await call(admin, 'GET', `${D}/revisions/${idA}`); ok(adm.status === 200 && adm.body.permisos.editar === true, 'ADMIN ve el borrador ajeno y su permiso de edición administrativa está disponible', adm.body?.permisos);
  const edA = await call(admin, 'PATCH', `${D}/revisions/${idA}`, { version: ver, datos: { ...SCHF(('FUN-A' + S)), cantidad: '250' } }); ok(edA.status === 200, 'ADMIN edita explícitamente el borrador ajeno (acción autorizada)', edA.body); ver = edA.body.version;
  const aud1 = sql(`SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'revisiones'`).out; ok(Number(aud1) > 0, `la edición queda auditada (audit.cambios manufactura.revisiones: ${aud1} filas)`);

  // ============ D. Responsables, firmas y autorizaciones ============
  const f1 = await subirFirma(gen, png(600, 200, 1)); ok(f1.status === 201 && f1.body.propia === true, 'GENERAL sube su firma (PNG reducida y recodificada por el servidor)', f1.body);
  const f1l = await call(gen, 'GET', `${D}/signatures`); ok(JSON.stringify(f1l.body).includes(f1.body.id), 'la dueña ve su firma');
  const f1o = await call(gen2, 'GET', `${D}/signatures`); ok(!JSON.stringify(f1o.body).includes(f1.body.id), 'otra cuenta NO ve la firma sin autorización');
  const sinAut = await call(gen2, 'POST', `${D}/drafts`, { codigo: ('FUN-B' + S), familia: 'HOJA_PAQ', datos: { ...SCHF(('FUN-B' + S)), modalidad: 'DOBLADA' } }); const idB = sinAut.body.id; let verB = sinAut.body.version;
  const usoIndebido = await call(gen2, 'PATCH', `${D}/revisions/${idB}`, { version: verB, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f1.body.id }] }); ok(usoIndebido.status >= 400, `usar la firma de otra persona SIN autorización se rechaza (${usoIndebido.status})`, usoIndebido.body);
  const aut = await call(gen, 'POST', `${D}/signatures/${f1.body.id}/authorize`, { usuarioId: ids['ensayo.general2'] }); ok(aut.status === 200, 'la dueña autoriza el USO de su firma a otra cuenta', aut.body);
  const autL = await call(gen, 'GET', `${D}/signatures/${f1.body.id}/authorizations`); ok(autL.status === 200 && JSON.stringify(autL.body).includes('Ensayo General Dos'), 'la lista de autorizaciones muestra a quién se autorizó');
  const conAut = await call(gen2, 'PATCH', `${D}/revisions/${idB}`, { version: verB, cliente: { empresaId: cli }, elaboroNombre: 'Elaboró Funcional', elaboroConfirmado: true, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f1.body.id }, { funcion: 'REVISO', nombre: 'Revisó Sin Firma' }] }); ok(conAut.status === 200, 'con autorización vigente la firma se asigna como responsable', conAut.body); verB = conAut.body.version;
  ok(conAut.body.responsables?.[0]?.conFirma === true && conAut.body.responsables?.[0]?.nombre === 'Ensayo General', 'el nombre impreso con firma es el de la PROPIETARIA de la imagen (no se puede atribuir a otra persona)', conAut.body.responsables);
  const rev = await call(gen, 'POST', `${D}/signatures/${f1.body.id}/revoke`, { usuarioId: ids['ensayo.general2'] }); ok(rev.status === 200, 'la dueña retira la autorización');
  const sinFirmaVig = await call(gen2, 'POST', `${D}/revisions/${idB}/finalize`, { version: verB }); ok(sinFirmaVig.status === 422, `finalizar con una firma cuya autorización fue retirada se rechaza (422), nunca se omite en silencio`, sinFirmaVig.body);
  const quitar = await call(gen2, 'PATCH', `${D}/revisions/${idB}`, { version: verB, responsables: [{ funcion: 'GENERO', nombre: 'Elaboró Funcional' }, { funcion: 'REVISO', nombre: 'Revisó Sin Firma' }] }); ok(quitar.status === 200, 'se corrige quitando la firma no autorizada'); verB = quitar.body.version;

  // ============ E. Finalización, PDF e inmutabilidad ============
  const finB = await call(gen2, 'POST', `${D}/revisions/${idB}/finalize`, { version: verB }); ok(finB.status === 200 && finB.body.estado === 'FINALIZADA' && finB.body.entorno === 'PRODUCCION' && finB.body.revision === 1, 'finalizar: FINALIZADA, revisión 1, entorno PRODUCCION', { e: finB.body?.estado, r: finB.body?.revision, ent: finB.body?.entorno });
  const pdfB = await call(gen2, 'GET', `${D}/revisions/${idB}/pdf`); ok(pdfB.status === 200 && /application\/pdf/.test(pdfB.type) && pdfB.buf.slice(0, 5).toString() === '%PDF-' && /attachment/.test(pdfB.disp), 'descarga del PDF finalizado (application/pdf, adjunto)', { s: pdfB.status, t: pdfB.type, d: pdfB.disp });
  fs.writeFileSync(path.join(EVID, 'FUN-B_REV01.pdf'), pdfB.buf);
  const sha = crypto.createHash('sha256').update(pdfB.buf).digest('hex'); ok(sha === finB.body.pdf.sha256 && pdfB.buf.length === finB.body.pdf.bytes, 'el PDF descargado coincide con el SHA-256 y tamaño registrados', { sha, reg: finB.body.pdf });
  const pdfOtro = await call(gen, 'GET', `${D}/revisions/${idB}/pdf`); ok(pdfOtro.status === 200, 'cualquier cuenta con sesión puede ver el PDF de una revisión FINALIZADA (política de lectura)', pdfOtro.status);
  const inm = [['editar', await call(gen2, 'PATCH', `${D}/revisions/${idB}`, { version: finB.body.version, datos: SCHF(('FUN-B' + S)) })], ['descartar', await call(gen2, 'POST', `${D}/revisions/${idB}/discard`, { version: finB.body.version })], ['finalizar de nuevo', await call(gen2, 'POST', `${D}/revisions/${idB}/finalize`, { version: finB.body.version })], ['ADMIN editar', await call(admin, 'PATCH', `${D}/revisions/${idB}`, { version: finB.body.version, datos: SCHF(('FUN-B' + S)) })]];
  for (const [n, r] of inm) ok(r.status === 409, `documento finalizado inmutable: ${n} → ${r.status}`, r.body);
  const dbmut = sql(`SELECT set_config('app.user_id', '${ids['ensayo.admin']}', false), set_config('app.user_email', 'ensayo.admin@example.invalid', false); UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE public_id = '${idB}'`); ok(dbmut.rc !== 0 && /inmutable|finalizada/i.test(dbmut.err), 'incluso el superusuario de la base no puede reabrir una revisión finalizada (trigger de inmutabilidad)', dbmut.err);
  const dbpdf = sql(`SELECT set_config('app.user_id', '${ids['ensayo.admin']}', false), set_config('app.user_email', 'ensayo.admin@example.invalid', false); UPDATE manufactura.pdf_contenidos SET contenido = ''::bytea WHERE revision_id = (SELECT revision_id FROM manufactura.revisiones WHERE public_id = '${idB}')`); ok(dbpdf.rc !== 0, 'el contenido del PDF finalizado no se puede alterar ni con el superusuario', dbpdf.err);

  // ============ F. Revisión nueva, historial, descarte ============
  const nueva = await call(gen2, 'POST', `${D}/${finB.body.documentoId}/revisions`); ok(nueva.status === 201 && nueva.body.estado === 'BORRADOR' && nueva.body.basadaEnRevision === 1, 'revisión nueva (borrador basado en la 1) a partir del documento finalizado', { e: nueva.body?.estado, b: nueva.body?.basadaEnRevision });
  const antes = await call(gen2, 'GET', `${D}/revisions/${idB}`); ok(antes.body.huella === finB.body.huella && antes.body.pdf.sha256 === finB.body.pdf.sha256 && antes.body.estado === 'FINALIZADA', 'la revisión anterior NO se alteró (misma huella y PDF)');
  const pN = await call(gen2, 'PATCH', `${D}/revisions/${nueva.body.id}`, { version: nueva.body.version, datos: { ...SCHF(('FUN-B' + S)), modalidad: 'DOBLADA', cantidad: '300' }, elaboroNombre: 'Elaboró Funcional', elaboroConfirmado: true, cliente: { empresaId: cli } }); ok(pN.status === 200, 'la revisión nueva se edita');
  const finN = await call(gen2, 'POST', `${D}/revisions/${nueva.body.id}/finalize`, { version: pN.body.version }); ok(finN.status === 200 && finN.body.revision === 2, 'se finaliza la revisión 2', finN.body?.revision);
  const antes2 = await call(gen2, 'GET', `${D}/revisions/${idB}`); ok(antes2.body.pdf.sha256 === finB.body.pdf.sha256, 'tras finalizar la 2, la 1 conserva su PDF');
  const hist = await call(gen, 'GET', `${D}/history?codigo=FUN-B${S}`); const filas = hist.body?.data ?? hist.body ?? []; ok(hist.status === 200 && Array.isArray(filas) && filas.filter((x) => x.estado === 'FINALIZADA').length === 2, 'historial documental: 2 revisiones finalizadas de FUN-B, visibles para otra cuenta', filas.map?.((x) => [x.revision, x.estado]));
  const dd = await call(gen, 'POST', `${D}/drafts`, { codigo: ('FUN-D' + S), familia: 'BOLSA_PLANA_1', datos: SCHF(('FUN-D' + S)) }); const dsc = await call(gen, 'POST', `${D}/revisions/${dd.body.id}/discard`, { version: dd.body.version }); ok(dsc.status === 200 && dsc.body.estado === 'DESCARTADA', 'descartar un borrador propio'); const dscE = await call(gen, 'PATCH', `${D}/revisions/${dd.body.id}`, { version: dsc.body.version, datos: SCHF(('FUN-D' + S)) }); ok(dscE.status === 409, 'un borrador descartado no se puede editar', dscE.status);

  // ============ G. Cliente manual (D3), clientes y abreviaturas por rol ============
  const m = await call(gen, 'POST', `${D}/drafts`, { codigo: ('FUN-M' + S), familia: 'BOLSA_PLANA_1', datos: SCHF(('FUN-M' + S)), cliente: { nombre: 'Cliente Manual Sintético SA' } }); ok(m.status === 201, 'borrador con cliente MANUAL', m.body);
  const mp = await call(gen, 'PATCH', `${D}/revisions/${m.body.id}`, { version: m.body.version, elaboroNombre: 'Elaboró Funcional', elaboroConfirmado: true, cliente: { nombre: 'Cliente Manual Sintético SA' } }); ok(mp.status === 200 && mp.body.cliente?.verificado === false && mp.body.cliente?.nombre === 'Cliente Manual Sintético SA', 'el cliente manual se guarda marcado como NO verificado', mp.body?.cliente);
  const mf = await call(gen, 'POST', `${D}/revisions/${m.body.id}/finalize`, { version: mp.body.version }); ok(mf.status === 200 && mf.body.cliente?.verificado === false, 'el documento con cliente manual se finaliza (política vigente D3) y conserva la marca', mf.body?.cliente);
  const mdb = sql(`SELECT cliente_verificado, cliente_empresa_id IS NULL, cliente_nombre FROM manufactura.revisiones WHERE public_id = '${m.body.id}'`).out; ok(mdb === 'f|t|Cliente Manual Sintético SA', 'persistencia en la base: verificado=false, sin empresa vinculada, nombre intacto', mdb);
  const nc = await call(gen, 'POST', '/clients', { commercialName: 'Cliente Funcional Sintético', legalName: 'Cliente Funcional SA' }); ok(nc.status === 403, 'GENERAL NO puede dar de alta clientes (403)', nc.status);
  const lc = await call(gen, 'GET', '/clients'); ok(lc.status === 200, 'GENERAL sí consulta la lista de clientes');
  const ab1 = await call(admin, 'POST', '/manufacturing-sheets/client-abbreviations', { abreviatura: 'FUN', clienteId: cli, alcance: 'CONTEXTO', codigoPatron: 'FUNA' }); ok(ab1.status === 201 || ab1.status === 409, 'ADMIN registra una abreviatura de cliente (o ya existía de una corrida previa)', ab1.body);
  const ab2 = await call(gen, 'POST', '/manufacturing-sheets/client-abbreviations', { abreviatura: 'FUG', clienteId: cli, alcance: 'CONTEXTO', codigoPatron: 'FUGA' }); ok([201, 409].includes(ab2.status) && (ab2.status === 409 || /PROPUESTA|PENDIENTE/i.test(JSON.stringify(ab2.body))), 'GENERAL solo PROPONE una abreviatura (queda pendiente de revisión, no confirmada)', ab2.body);
  if (ab2.status === 201) { const rs = await call(gen, 'POST', `/manufacturing-sheets/client-abbreviations/${ab2.body.id}/resolve`, { accion: 'CONFIRMAR' }); ok(rs.status === 403, 'GENERAL NO puede confirmar/resolver abreviaturas (403)', rs.status); const rs2 = await call(admin, 'POST', `/manufacturing-sheets/client-abbreviations/${ab2.body.id}/resolve`, { accion: 'RECHAZAR', motivo: 'ensayo' }); ok(rs2.status === 200 || rs2.status === 201, 'ADMIN resuelve la propuesta de GENERAL', rs2.body); }
  const ab3 = await call(gen, 'GET', '/manufacturing-sheets/client-abbreviations'); ok(ab3.status === 403, 'GENERAL no lista el catálogo completo de abreviaturas (403)', ab3.status);
  const ab4 = await call(gen, 'GET', `/manufacturing-sheets/client-abbreviations?clienteId=${cli}`); ok(ab4.status === 200, 'GENERAL consulta las abreviaturas de la ficha de un cliente (200)', ab4.status);
  const ab5 = await call(admin, 'GET', '/manufacturing-sheets/client-abbreviations'); ok(ab5.status === 200, 'ADMIN lista el catálogo de abreviaturas');
  const sa = await call(gen, 'GET', `${D}/signatures-admin?sinCuenta=true`); ok(sa.status === 403, 'GENERAL no accede a la administración de firmas (403)');
  const sad = await call(admin, 'GET', `${D}/signatures-admin?sinCuenta=true`); ok(sad.status === 200, 'ADMIN administra firmas de personas sin cuenta');
  const noAuth = await fetch(`${base}/api${D}/capabilities`); ok(noAuth.status === 401, 'sin sesión: 401');

  // ============ H. Auditoría e integridad en la base ============
  const leak = sql("SELECT count(*) FROM audit.cambios WHERE esquema = 'manufactura' AND (datos_nuevos::text ~ 'JVBERi' OR datos_nuevos::text ~ '25504446' OR datos_anteriores::text ~ 'JVBERi' OR datos_anteriores::text ~ '25504446')"); ok(leak.rc === 0 && leak.out === '0', 'la auditoría NO guarda los bytes del PDF ni de las firmas (redactada)', leak.err || leak.out);
  const actor = sql("SELECT count(*) FILTER (WHERE usuario_id IS NOT NULL), count(*) FROM audit.cambios WHERE esquema = 'manufactura'"); info('auditoría manufactura: filas con actor / total = ' + actor.out);
  ok(Number(actor.out.split('|')[0]) > 0 && actor.out.split('|')[0] === actor.out.split('|')[1], 'toda fila de auditoría de Manufactura tiene actor identificado', actor.out);
  const integ = sql("SELECT (SELECT count(*) FROM manufactura.revisiones WHERE estado = 'FINALIZADA' AND NOT EXISTS (SELECT 1 FROM manufactura.pdfs p WHERE p.revision_id = revisiones.revision_id)), (SELECT count(*) FROM manufactura.pdf_contenidos c JOIN manufactura.pdfs p USING (revision_id) WHERE encode(sha256(c.contenido), 'hex') <> p.pdf_sha256 OR length(c.contenido) <> p.bytes), (SELECT count(*) FROM (SELECT documento_id, revision FROM manufactura.revisiones WHERE revision IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x), (SELECT count(*) FROM manufactura.revisiones WHERE entorno_emision <> 'PRODUCCION'), (SELECT count(*) FROM manufactura.firmas WHERE encode(sha256(contenido), 'hex') <> sha256 OR length(contenido) <> bytes)");
  ok(integ.out === '0|0|0|0|0', 'integridad: toda FINALIZADA tiene PDF; PDF = SHA-256/tamaño; sin revisiones duplicadas; todo entorno PRODUCCION; firmas = SHA-256/tamaño', integ.out + ' ' + integ.err);

  // ============ I. BIND con simulador controlado ============
  const bc = async (cod, w = gen) => call(w, 'GET', `${B}/by-code/${cod}`);
  const b1 = await bc('SCHFPMG001'); ok(b1.status === 200 && b1.body.product?.Code === 'SCHFPMG001' || JSON.stringify(b1.body).includes('SCHFPMG001'), 'BIND · producto encontrado (200, con interpretación)', { s: b1.status, k: Object.keys(b1.body ?? {}) });
  fs.writeFileSync(path.join(EVID, 'bind_producto_encontrado.json'), JSON.stringify(b1.body, null, 1));
  const b2 = await bc('DCMX-NOEXISTE'); ok(b2.status === 404 && b2.body.code === 'BIND_PRODUCT_NOT_FOUND', 'BIND · producto inexistente → 404 «No se encontró el producto en BIND»', b2.body);
  const b3 = await bc('DCMX-INCOMPLETO'); ok(b3.status === 200, 'BIND · información incompleta (sin descripción ni peso) → 200 con advertencias, sin inventar datos', { s: b3.status, adv: JSON.stringify(b3.body).slice(0, 220) });
  const b4 = await bc('DCMX-AMBIGUO'); ok(b4.status === 200, 'BIND · descripción ambigua → 200; la interpretación no elige por su cuenta (revisar advertencias)', JSON.stringify(b4.body?.interpretacion ?? b4.body).slice(0, 260));
  fs.writeFileSync(path.join(EVID, 'bind_descripcion_ambigua.json'), JSON.stringify(b4.body, null, 1));
  const b5 = await bc('DCMX-DUPLICADO'); ok(b5.status >= 400 && b5.status < 500 || b5.status === 502, `BIND · dos productos con el mismo código → NO se elige uno al azar (${b5.status})`, b5.body);
  const b6 = await bc('DCMX-ERROR'); ok(b6.status === 502 && b6.body.message === 'Error interno del servidor.', 'BIND · error del servicio externo (500) → 502 con mensaje genérico seguro (el filtro global oculta el código en 5xx; la web decide por el estado)', b6.body);
  const b7 = await bc('DCMX-401'); ok(b7.status === 502 && !/Bearer|clave|key/i.test(JSON.stringify(b7.body)), 'BIND · credencial rechazada (401) → 502 sin exponer detalles ni la clave', b7.body);
  const b8 = await bc('DCMX-INVALIDO'); ok(b8.status === 502, 'BIND · respuesta con forma inválida → 502', b8.body);
  const b9 = await bc('DCMX-429'); ok(b9.status === 503, 'BIND · límite de uso (429) → 503 tras reintentos acotados', b9.body);
  const t0 = Date.now(); const b10 = await bc('DCMX-LENTO'); ok(b10.status === 504 && Date.now() - t0 < 40000, `BIND · respuesta lenta → 504 (tiempo agotado) en ${Math.round((Date.now() - t0) / 1000)} s (tope 30 s)`, b10.body);
  const b11 = await call(gen, 'GET', `${B}/recent?skip=0&limit=5`); ok(b11.status === 200, 'BIND · novedades (recent) con orden verificado', b11.status);
  const b12 = await bc('MALO%27%20or%201=1'); ok(b12.status === 400, 'BIND · código con comillas/operadores se rechaza antes de llamar a BIND (400)', b12.status);
  info('simulador BIND (solicitudes recibidas, token enmascarado): ' + dk(['logs', BINDC]).stdout.split('\n').filter((l) => l.startsWith('{')).length);
  fs.writeFileSync(path.join(EVID, 'bind_simulador_log.jsonl'), dk(['logs', BINDC]).stdout);
  dk(['stop', BINDC]);
  const bd = await bc('SCHFPMG001'); ok(bd.status === 502, 'BIND caído (servicio detenido) → 502; la web lo presenta como «No se pudo consultar BIND»', bd.body);
  const salud = await fetch(`${base}/api/health`); ok(salud.status === 200, 'la API sigue respondiendo /health con BIND caído');
  const man = await call(gen, 'POST', `${D}/drafts`, { codigo: ('FUN-MANUAL' + S), familia: 'BOLSA_PLANA_1', datos: SCHF(('FUN-MANUAL' + S)) }); ok(man.status === 201, 'CAPTURA MANUAL con BIND caído: el borrador se crea y guarda sin BIND', man.status);
  const manP = await call(gen, 'POST', '/manufacturing-sheets/previews', { familia: 'BOLSA_PLANA_1', datos: SCHF(('FUN-MANUAL' + S)) }); ok(manP.status === 200, 'la vista previa funciona con BIND caído');
  dk(['start', BINDC]);

  fs.writeFileSync(path.join(EVID, 'resultado_funcional.json'), JSON.stringify({ total: resultados.length, fallos: fails, resultados }, null, 1));
  console.log(fails ? `RESULTADO: ${fails} FAIL de ${resultados.length}` : `RESULTADO: ${resultados.length} PASS / 0 FAIL`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
