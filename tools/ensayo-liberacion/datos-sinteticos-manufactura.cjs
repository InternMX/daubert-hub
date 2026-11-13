// Genera datos SINTÉTICOS representativos en Manufactura usando la API REAL (borradores, revisiones, PDF, firmas, responsables, finalizados, descartados, abreviaturas). Solo para réplicas desechables.
// Se ejecuta DENTRO del contenedor de la API:  docker exec -e ENSAYO_PASSWORD=... -e ENSAYO_CLIENTE_ID=121 ens-api node /x/datos-sinteticos-manufactura.cjs http://127.0.0.1:3000 [salida.json]
// Usuarios sintéticos esperados: ensayo.admin@example.invalid (ADMIN) y ensayo.general@example.invalid (GENERAL), sembrados por quien ejecuta (nunca cuentas reales).
const fs = require('node:fs'); const zlib = require('node:zlib'); const crypto = require('node:crypto');
const base = process.argv[2]; const salida = process.argv[3]; const PW = process.env.ENSAYO_PASSWORD; const CLIENTE = process.env.ENSAYO_CLIENTE_ID;
if (!PW || !CLIENTE) { console.error('Define ENSAYO_PASSWORD y ENSAYO_CLIENTE_ID (empresa con rol CLIENTE de la réplica).'); process.exit(2); }
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 240))); if (!c) fails++; };
const crc = (b) => { let c, t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const pngFirma = (w, h, semilla) => { const raw = Buffer.alloc((w * 3 + 1) * h, 255); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const v = ((x * 7 + y * 3 + semilla) % 53 < 4) ? 20 : 255; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; } } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); };
const SCHF = (codigo) => ({ codigo, descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.0428', cliente: 'Cliente sintético', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5' });
async function login(email) { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) }); const c = r.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')); if (!c) throw new Error('login ' + email + ' ' + r.status); return { cookie: c.split(';')[0] }; }
const call = async (w, m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: w.cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ } return { status: r.status, body: j }; };
const D = '/manufacturing-sheets/documents';
const subirFirma = async (w, png, extra = {}) => { const fd = new FormData(); fd.append('archivo', new Blob([png], { type: 'image/png' }), 'firma.png'); for (const [k, v] of Object.entries(extra)) fd.append(k, v); const r = await fetch(`${base}/api${D}/signatures`, { method: 'POST', headers: { cookie: w.cookie }, body: fd }); return { status: r.status, body: await r.json().catch(() => null) }; };

(async () => {
  const admin = await login('ensayo.admin@example.invalid'); const gen = await login('ensayo.general@example.invalid');
  const usuarios = (await call(admin, 'GET', '/users')).body; const lista = usuarios?.data ?? usuarios ?? [];
  const idGeneral = (Array.isArray(lista) ? lista : []).find((u) => u.email === 'ensayo.general@example.invalid')?.id;
  ok(Boolean(idGeneral), 'id de la cuenta GENERAL sintética', usuarios);

  if (process.env.SOLO_REVISION) {                      // complemento: revisor asignado + revisión registrada (confirmaciones) + finalización
    const d = await call(admin, 'POST', D + '/drafts', { codigo: 'ENS-H-REVISADO', familia: 'BOLSA_PLANA_1', datos: SCHF('ENS-H-REVISADO') }); ok(d.status === 201, 'borrador ENS-H-REVISADO', d.body);
    const p = await call(admin, 'PATCH', D + '/revisions/' + d.body.id, { version: d.body.version, cliente: { empresaId: String(CLIENTE) }, elaboroNombre: 'Elaboró Sintético', elaboroConfirmado: true }); ok(p.status === 200, 'cliente y Generó', p.body);
    const as = await call(admin, 'PUT', D + '/revisions/' + d.body.id + '/reviewer', { version: p.body.version, revisorUsuarioId: String(idGeneral) }); ok(as.status === 200, 'revisor asignado (GENERAL)', as.body);
    const rv = await call(gen, 'POST', D + '/revisions/' + d.body.id + '/review', { version: as.body.version ?? p.body.version }); ok(rv.status === 200, 'revisión registrada por el revisor (confirmación)', rv.body);
    const fin = await call(admin, 'POST', D + '/revisions/' + d.body.id + '/finalize', { version: rv.body.version ?? as.body.version }); ok(fin.status === 200, 'ENS-H-REVISADO FINALIZADA', fin.body);
    console.log(fails ? 'RESULTADO: ' + fails + ' FAIL' : 'RESULTADO: complemento generado (todo PASS)'); process.exit(fails ? 1 : 0);
  }
  // Firmas: una grande (~150 KB tras procesar) y una pequeña, de ADMIN; una de GENERAL; una de persona sin cuenta (custodia).
  const f1 = await subirFirma(admin, pngFirma(900, 300, 1)); ok(f1.status === 201, 'firma 1 (ADMIN) subida', f1);
  const f2 = await subirFirma(admin, pngFirma(300, 100, 2)); ok(f2.status === 201, 'firma 2 (ADMIN) subida', f2);
  const f3 = await subirFirma(gen, pngFirma(600, 200, 3)); ok(f3.status === 201, 'firma 3 (GENERAL) subida', f3);
  const f4 = await subirFirma(admin, pngFirma(450, 150, 4), { propietarioNombre: 'Persona Sin Cuenta Sintética' }); ok(f4.status === 201, 'firma 4 (sin cuenta, custodia ADMIN) subida', f4);
  const au = await call(admin, 'POST', `${D}/signatures/${f1.body?.id}/authorize`, { usuarioId: idGeneral }); ok(au.status === 200, 'autorización de uso de la firma 1 a GENERAL', au);

  const resumen = []; const finalizar = async (w, codigo, familia, datos, resp) => {
    const d = await call(w, 'POST', `${D}/drafts`, { codigo, familia, datos }); ok(d.status === 201, `borrador ${codigo} (${familia})`, d.body);
    const p = await call(w, 'PATCH', `${D}/revisions/${d.body.id}`, { version: d.body.version, cliente: { empresaId: String(CLIENTE) }, elaboroNombre: 'Elaboró Sintético', elaboroConfirmado: true, ...(resp ? { responsables: resp } : {}) });
    ok(p.status === 200, `${codigo}: cliente del catálogo, Generó y responsables`, p.body);
    const fin = await call(w, 'POST', `${D}/revisions/${d.body.id}/finalize`, { version: p.body.version }); ok(fin.status === 200, `${codigo}: FINALIZADA con PDF`, fin.body);
    resumen.push({ codigo, id: d.body.id, estado: fin.body?.estado }); return { id: d.body.id, documentoId: d.body.documentoId };
  };
  const docA = await finalizar(admin, 'ENS-A-PLANA', 'BOLSA_PLANA_1', SCHF('ENS-A-PLANA'), [{ funcion: 'GENERO', nombre: 'x', firmaId: f1.body.id }, { funcion: 'REVISO', nombre: 'x', firmaId: f2.body.id }, { funcion: 'APROBO', nombre: 'Aprobó Sin Firma' }]);
  await finalizar(admin, 'ENS-B-HOJAS', 'HOJA_PAQ', { ...SCHF('ENS-B-HOJAS'), modalidad: 'DOBLADA' });
  await finalizar(gen, 'ENS-C-FUELLE', 'BOLSA_FUELLE', { ...SCHF('ENS-C-FUELLE'), fuelleTotal: '48', fuelleDerecho: '24', fuelleIzquierdo: '24' }, [{ funcion: 'GENERO', nombre: 'x', firmaId: f3.body.id }]);
  await finalizar(admin, 'ENS-D-CUSTODIA', 'BOLSA_PLANA_1', SCHF('ENS-D-CUSTODIA'), [{ funcion: 'GENERO', nombre: 'Elaboró Sintético' }, { funcion: 'REVISO', nombre: 'x', firmaId: f4.body.id }]);
  // Borradores abiertos (uno de cada cuenta), un descartado y una revisión nueva a partir de un documento finalizado.
  const dBorr = await call(gen, 'POST', `${D}/drafts`, { codigo: 'ENS-E-BORRADOR', familia: 'BOLSA_PLANA_1', datos: SCHF('ENS-E-BORRADOR') }); ok(dBorr.status === 201, 'borrador abierto (GENERAL)', dBorr.body);
  const dBorr2 = await call(admin, 'POST', `${D}/drafts`, { codigo: 'ENS-F-BORRADOR', familia: 'HOJA_PAQ', datos: { ...SCHF('ENS-F-BORRADOR'), modalidad: 'DOBLADA' } }); ok(dBorr2.status === 201, 'borrador abierto (ADMIN)', dBorr2.body);
  const dDesc = await call(gen, 'POST', `${D}/drafts`, { codigo: 'ENS-G-DESCARTADO', familia: 'BOLSA_PLANA_1', datos: SCHF('ENS-G-DESCARTADO') });
  const desc = await call(gen, 'POST', `${D}/revisions/${dDesc.body?.id}/discard`, { version: dDesc.body?.version }); ok(desc.status === 200, 'borrador descartado', desc.body);
  const nueva = await call(admin, 'POST', `${D}/${docA.documentoId}/revisions`); ok(nueva.status === 201, 'revisión nueva (borrador) a partir de ENS-A-PLANA', nueva.body);
  // Abreviaturas de cliente (ADMIN).
  const ab = await call(admin, 'POST', '/manufacturing-sheets/client-abbreviations', { abreviatura: 'ENS', clienteId: String(CLIENTE), alcance: 'CONTEXTO', codigoPatron: 'ENSA' }); ok(ab.status === 201 || ab.status === 200, 'abreviatura de cliente creada', ab.body);
  // Todo lo creado es visible para la API (control mínimo antes de respaldar).
  const abiertas = await call(admin, 'GET', `${D}/open`); ok(abiertas.status === 200, 'lista de abiertos', abiertas.body && Object.keys(abiertas.body));
  console.log(JSON.stringify({ finalizadas: resumen.length }));
  if (salida) fs.writeFileSync(salida, JSON.stringify({ resumen }, null, 1));
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: datos sintéticos generados (todo PASS)'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
