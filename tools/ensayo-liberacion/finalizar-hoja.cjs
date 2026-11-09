// Crea un borrador con el código indicado e intenta FINALIZARLO (genera el PDF con Chromium). SOLO réplicas/ensayos con usuarios sintéticos.
//   ENSAYO_PASSWORD=… ENSAYO_EMPRESA=<id cliente> node finalizar-hoja.cjs <url> <codigo> exito|fallo [pdf-existente:<idRevision>]
// exito: finaliza y el PDF se descarga.   fallo (Chromium inutilizado): finalizar NO devuelve 200, la revisión NO queda FINALIZADA ni a medias (sigue editable) y no hay PDF registrado;
// además, si se indica una revisión ya finalizada, su PDF almacenado se sigue descargando.
const [base, codigo, modo, existente] = process.argv.slice(2); const PW = process.env.ENSAYO_PASSWORD;
if (!base || !codigo || !['exito', 'fallo'].includes(modo) || !PW) { console.error('Uso: ENSAYO_PASSWORD=… node finalizar-hoja.cjs <url> <codigo> exito|fallo [idRevisionFinalizada]'); process.exit(2); }
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 220))); if (!c) fails++; };
const D = '/manufacturing-sheets/documents';
const datos = { codigo, descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.0428', cliente: 'Cliente de ensayo', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5' };
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.ENSAYO_ADMIN || 'admin1@example.invalid', password: PW }) });
  const cookie = (l.headers.getSetCookie().find((x) => x.startsWith('daubert_session=')) ?? '').split(';')[0];
  const call = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch {} return { s: r.status, j, buf, tipo: r.headers.get('content-type') ?? '' }; };
  const d = await call('POST', `${D}/drafts`, { codigo, familia: 'BOLSA_PLANA_1', datos });
  ok(d.s === 201, `borrador ${codigo} creado (${d.s})`, d.j); const id = d.j?.id ?? d.j?.data?.id; let ver = d.j?.version ?? d.j?.data?.version;
  const pa = await call('PATCH', `${D}/revisions/${id}`, { version: ver, cliente: { empresaId: process.env.ENSAYO_EMPRESA ?? '1' }, elaboroNombre: 'Admin Uno', elaboroConfirmado: true });
  ok(pa.s === 200, `cliente y Generó completos (${pa.s})`, pa.j); ver = pa.j?.version ?? pa.j?.data?.version ?? ver;
  const t0 = Date.now(); const fin = await call('POST', `${D}/revisions/${id}/finalize`, { version: ver }); const seg = ((Date.now() - t0) / 1000).toFixed(1);
  const rev = await call('GET', `${D}/revisions/${id}`); const v = rev.j?.data ?? rev.j; const pdf = await call('GET', `${D}/revisions/${id}/pdf`);
  console.log(`INFO finalizar → ${fin.s} en ${seg} s (${JSON.stringify(fin.j ?? {}).slice(0, 160)}) · estado ${v?.estado} · GET pdf ${pdf.s}`);
  if (modo === 'exito') {
    ok(fin.s === 200 && v?.estado === 'FINALIZADA', `finalizada (${fin.s}, ${v?.estado})`);
    ok(pdf.s === 200 && pdf.buf.slice(0, 5).toString() === '%PDF-', `PDF generado y descargable (${pdf.s}, ${pdf.buf.length} bytes)`);
  } else {
    ok(fin.s >= 500 || (fin.s >= 400 && fin.s !== 409), `con Chromium inutilizado finalizar NO responde 200 (${fin.s})`, fin.j);
    ok(v?.estado !== 'FINALIZADA', `la revisión NO queda FINALIZADA (${v?.estado})`);
    ok(pdf.s !== 200, `no hay PDF registrado para la revisión no finalizada (${pdf.s})`);
    const ed = await call('PATCH', `${D}/revisions/${id}`, { version: v?.version, datos: { ...datos, ancho: '14' } });
    ok(ed.s === 200 || v?.estado === 'FINALIZANDO', `la revisión sigue editable (no quedó bloqueada a medias): PATCH ${ed.s}, estado ${v?.estado}`, ed.j);
  }
  if (existente) { const p = await call('GET', `${D}/revisions/${existente}/pdf`); ok(p.s === 200 && p.buf.slice(0, 5).toString() === '%PDF-', `el PDF de la hoja YA finalizada se sigue descargando (${p.s}, ${p.buf.length} bytes)`); }
  console.log(`REVISION ${id}`); console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: todo PASS'); process.exit(fails ? 1 : 0);
})();
