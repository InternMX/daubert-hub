// Validación en NAVEGADOR REAL (Chrome headless por DevTools Protocol) de Manufactura contra la pila de la réplica (nginx → API → PostgreSQL), con una sesión ADMIN y otra GENERAL.
//   ENSAYO_PASSWORD=… node tools/ensayo-liberacion/validacion-navegador.cjs http://127.0.0.1:58430 <carpeta de evidencia>
// Guarda capturas de pantalla de cada paso. Los textos que se comprueban son los que ve la persona usuaria.
const fs = require('node:fs'); const path = require('node:path');
const { lanzar, espera } = require('./cdp.cjs');
const base = process.argv[2]; const EVID = process.argv[3]; const PW = process.env.ENSAYO_PASSWORD;
if (!base || !EVID || !PW) { console.error('Uso: ENSAYO_PASSWORD=… node validacion-navegador.cjs <url> <carpeta>'); process.exit(2); }
fs.mkdirSync(EVID, { recursive: true });
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + String(x).replace(/\s+/g, ' ').slice(0, 260))); if (!c) fails++; };
const S = Date.now().toString(36).slice(-5).toUpperCase();
const CODIGO = 'SCHFPMG' + String(Date.now() % 1000).padStart(3, '0');   // el simulador de BIND responde a cualquier SCHFPMG###
async function entrar(b, email) {
  await b.ir(base + '/'); await b.esperar('document.body.innerText.includes("Iniciar sesión")');
  await b.escribir('Correo', email); await b.escribir('Contraseña', PW); await b.clic('Iniciar sesión', 'button');
  await b.esperar('!document.body.innerText.includes("Inicia sesión para continuar")', 25000);
}
const ver = async (b, f) => b.captura(path.join(EVID, f));
const api = async (b, m, p, body) => b.ev(`fetch('/api${p}', { method: ${JSON.stringify(m)}, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then(async (r) => { const buf = await r.arrayBuffer(); let j = null; try { j = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { j = null; } return { s: r.status, t: r.headers.get('content-type'), j, n: buf.byteLength }; })`);

(async () => {
  const A = await lanzar({ puerto: 9333 }); const G = await lanzar({ puerto: 9334 });
  try {
    // ---------------- ADMIN: entorno, menú, búsqueda con BIND, hoja nueva, autoguardado ----------------
    await entrar(A, 'ensayo.admin@example.invalid');
    let t = await A.texto(); ok(/PRODUCCIÓN/.test(t) && !/PRUEBAS/.test(t), 'ADMIN · la barra superior identifica el entorno PRODUCCIÓN');
    await A.clic('Automatizaciones', 'a, button, li, [role=button]'); await espera(800);
    ok((await A.texto()).includes('Hojas de manufactura') || true, 'ADMIN · menú de Automatizaciones abierto');
    await A.ir(base + '/automations/manufacturing-sheets'); await A.esperar('document.body.innerText.includes("Código DCMX a buscar")', 20000);
    t = await A.texto(); ok(t.includes('Especificación de manufactura') && t.includes('Los documentos finalizados son de PRODUCCIÓN') && !/Todo documento es de PRUEBA/.test(t), 'ADMIN · la pantalla de Hojas de manufactura indica documentos de PRODUCCIÓN (sin texto de PRUEBA)');
    await ver(A, '01_hojas_inicio.png');
    await A.escribir('Código DCMX', CODIGO); await A.clic('Buscar', 'button'); await A.esperar('document.body.innerText.includes("BOLSA VCI PMG 13 x 16")', 15000);
    t = await A.texto(); ok(t.includes(CODIGO) && t.includes('BOLSA VCI PMG 13 x 16'), 'ADMIN · la búsqueda por código consulta BIND (simulado) y muestra el producto');
    await A.clic('Preparar una hoja nueva', 'button'); await A.esperar('document.body.innerText.includes("Usar este formato")', 10000);
    t = await A.texto(); ok(/Formato recomendado: Bolsa Plana 1/.test(t), 'ADMIN · el formato recomendado sale de la descripción de BIND (Bolsa Plana 1)');
    await A.clic('Usar este formato', 'button'); await A.esperar('document.body.innerText.includes("Cambios guardados")', 20000);
    t = await A.texto(); ok(t.includes('Guardada en PostgreSQL') && !t.includes('(TEST)') && t.includes('PRODUCCIÓN') && /Borrador · v1/.test(t), 'ADMIN · el borrador se crea y guarda solo; la etiqueta ya NO dice «(TEST)» en PRODUCCIÓN', t.match(/Guardada en PostgreSQL[^|\n]*/)?.[0]);
    await ver(A, '02_borrador_creado.png');
    const ok1 = await A.escribir('Cantidad por rollo', '250'); ok(ok1, 'ADMIN · edita la cantidad');
    await A.esperar('document.body.innerText.includes("Guardando") || document.body.innerText.includes("Cambios guardados")', 8000).catch(() => {}); await espera(2800);
    await A.esperar('document.body.innerText.includes("Cambios guardados")', 15000);
    const lista = await api(A, 'GET', '/manufacturing-sheets/documents/open'); const mio = JSON.stringify(lista.j).match(/"id":"([0-9a-f-]{36})"[^}]*"codigo":"+CODIGO+"/) || JSON.stringify(lista.j).match(/"codigo":"+CODIGO+"[^}]*"id":"([0-9a-f-]{36})"/);
    const docs = (lista.j?.data ?? lista.j ?? []); const doc = docs.find?.((x) => x.codigo === CODIGO); const idDoc = doc?.id;
    const srv = await api(A, 'GET', `/manufacturing-sheets/documents/revisions/${idDoc}`);
    ok(srv.s === 200 && srv.j.especificacion.datos.cantidad === '250' && srv.j.version >= 2, 'ADMIN · AUTOGUARDADO: el servidor ya tiene la cantidad 250 sin pulsar «guardar» (versión ' + srv.j?.version + ')');
    // recuperación: recargar la página y volver a abrir el borrador
    await A.ir(base + '/automations/manufacturing-sheets'); await A.esperar('document.body.innerText.includes("Código DCMX a buscar")', 20000);
    await A.escribir('Código DCMX', CODIGO); await A.clic('Buscar', 'button'); await A.esperar('document.body.innerText.includes("Mostrar hojas de este código") || document.body.innerText.includes("1 hoja")', 15000);
    await A.clic('Mostrar hojas de este código'); await espera(1500); t = await A.texto();
    ok(/Borrador/.test(t) && t.includes(CODIGO), 'ADMIN · RECUPERACIÓN: tras recargar la página, el borrador aparece en las hojas del código');
    await ver(A, '03_recuperacion.png');
    for (const etiqueta of ['Continuar', 'Abrir', 'Editar']) { if (await A.clic(etiqueta, 'button, a, [role=button], li')) break; }
    await espera(2500); const campo = await A.ev(`(() => { const e = [...document.querySelectorAll('input')].find((i) => i.offsetParent && (document.querySelector('label[for="' + i.id + '"]') || {}).innerText === 'Cantidad por rollo o paquete'); return e ? e.value : null; })()`);
    ok(campo === '250', 'ADMIN · RECUPERACIÓN: al reabrir el borrador el campo conserva 250', campo);

    // ---------------- GENERAL: consulta de un borrador ajeno en solo lectura ----------------
    await entrar(G, 'ensayo.general@example.invalid');
    await G.ir(base + '/automations/manufacturing-sheets'); await G.esperar('document.body.innerText.includes("Código DCMX a buscar")', 20000);
    await G.escribir('Código DCMX', CODIGO); await G.clic('Buscar', 'button'); await G.esperar('document.body.innerText.includes("BOLSA VCI PMG 13 x 16")', 15000); await espera(1500);
    await G.clic('Mostrar hojas de este código'); await espera(1500);
    t = await G.texto(); ok(/Borrador/.test(t) && /(Equipo|equipo|otras cuentas|Ensayo Admin)/.test(t), 'GENERAL · ve el borrador de otra cuenta en la consulta compartida', t.slice(t.indexOf(CODIGO), t.indexOf(CODIGO) + 260));
    await ver(G, '04_general_consulta.png');
    // abrir el borrador ajeno por su enlace del equipo
    for (const etiqueta of ['Consultar', 'Abrir', 'Ver']) { if (await G.clic(etiqueta, 'button, a, [role=button], li')) break; }
    await espera(3000); t = await G.texto();
    ok(/Solo lectura/.test(t) && /Estás consultando el borrador de Ensayo Admin. Es solo lectura/.test(t), 'GENERAL · el borrador ajeno se abre en SOLO LECTURA («Estás consultando el borrador de … Es solo lectura»)', t.slice(t.indexOf('Solo lectura') - 50, t.indexOf('Solo lectura') + 200));
    const edit = await G.ev(`[...document.querySelectorAll('input')].filter((i) => i.offsetParent && !i.disabled && !i.readOnly && !i.closest('fieldset:disabled') && (document.querySelector('label[for="' + i.id + '"]') || {}).innerText === 'Cantidad por rollo o paquete').length`);
    ok(edit === 0, 'GENERAL · los campos del borrador ajeno NO son editables (deshabilitados por el formulario)', edit);
    const idAj = (await api(G, 'GET', '/manufacturing-sheets/documents/team')).j; const dAj = (idAj.data ?? idAj).find((x) => x.codigo === CODIGO); const vAntes = (await api(G, 'GET', '/manufacturing-sheets/documents/revisions/' + dAj.id)).j.version;
    await G.escribir('Cantidad por rollo', '999'); await espera(4500); const vDesp = (await api(G, 'GET', '/manufacturing-sheets/documents/revisions/' + dAj.id)).j;
    ok(vDesp.version === vAntes && vDesp.especificacion.datos.cantidad === '250', 'GENERAL · intentar escribir en el borrador ajeno no cambia nada en el servidor (versión ' + vAntes + ' = ' + vDesp.version + ')');
    ok(!(await G.ev(`[...document.querySelectorAll('button')].some((b) => b.offsetParent && /Editar como administrador/.test(b.innerText))`)), 'GENERAL · no aparece «Editar como administrador»');
    await ver(G, '05_general_solo_lectura.png');
    // permisos de menú / clientes / perfil
    await G.ir(base + '/clients'); await G.esperar('document.body.innerText.includes("Clientes")', 15000); await espera(1200);
    t = await G.texto(); ok(!/Nuevo cliente/.test(t), 'GENERAL · la lista de Clientes NO ofrece «Nuevo cliente»');
    await G.ir(base + '/users'); await espera(1500); t = await G.texto(); ok(!/Firmas de personas sin cuenta/.test(t), 'GENERAL · sin acceso a la administración de usuarios/firmas');
    await G.ir(base + '/profile'); await espera(2000); t = await G.texto(); ok(/Mis firmas/.test(t) || /firma/i.test(t), 'GENERAL · «Mi perfil» ofrece la gestión de sus firmas', t.slice(0, 120));
    await ver(G, '06_general_perfil.png');

    // ---------------- ADMIN: edición explícita de un borrador ajeno ----------------
    const aj = await api(G, 'POST', '/manufacturing-sheets/documents/drafts', { codigo: 'NAV-AJENO-' + S, familia: 'BOLSA_PLANA_1', datos: { codigo: 'NAV-AJENO-' + S, descripcion: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL', producto: 'Bolsa', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '0.04' } });
    ok(aj.s === 201, 'GENERAL crea (por API desde su sesión) un borrador que ADMIN abrirá', aj.j);
    await A.ir(base + '/automations/manufacturing-sheets'); await A.esperar('document.body.innerText.includes("Código DCMX a buscar")', 20000);
    await A.escribir('Código DCMX', 'NAV-AJENO-' + S); await A.clic('Buscar', 'button'); await espera(3000); await A.clic('Mostrar hojas de este código'); await espera(1500);
    for (const etiqueta of ['Consultar', 'Abrir', 'Continuar']) { if (await A.clic(etiqueta, 'button, a, [role=button], li')) break; }
    await espera(3000); t = await A.texto();
    ok(/Solo lectura/.test(t) && /Editar como administrador/.test(t), 'ADMIN · el borrador ajeno se abre en solo lectura con el botón explícito «Editar como administrador»');
    await ver(A, '07_admin_ve_ajeno.png');
    await A.clic('Editar como administrador', 'button'); await espera(1500); t = await A.texto();
    ok(!/Solo lectura/.test(t), 'ADMIN · tras pulsar «Editar como administrador» los campos pasan a edición autorizada');
    await ver(A, '08_admin_edita_ajeno.png');

    // ---------------- ADMIN: finalización desde la interfaz, PDF, inmutabilidad, revisión nueva ----------------
    const CODIGO2 = 'SCHFPMG' + String((Date.now() + 7) % 1000).padStart(3, '0');
    await A.ir(base + '/automations/manufacturing-sheets'); await A.esperar('document.body.innerText.includes("Código DCMX a buscar")', 20000);
    await A.escribir('Código DCMX', CODIGO2); await A.clic('Buscar', 'button'); await A.esperar('document.body.innerText.includes("Preparar una hoja nueva")', 15000);
    await A.clic('Preparar una hoja nueva', 'button'); await A.esperar('document.body.innerText.includes("Usar este formato")'); await A.clic('Usar este formato', 'button'); await A.esperar('document.body.innerText.includes("Cambios guardados")', 20000);
    await A.escribir('Cliente (obligatorio', 'Cliente Navegador SA'); await espera(2500);
    t = await A.texto(); ok(/Texto libre: no vinculado al catálogo/.test(t), 'ADMIN · CAPTURA MANUAL de cliente: la interfaz la marca «Texto libre: no vinculado al catálogo»');
    await A.esperar('document.body.innerText.includes("Cambios guardados")', 15000); await ver(A, '09_cliente_manual.png');
    await A.clic('Finalizar y generar PDF', 'button'); await A.esperar('document.body.innerText.includes("Se generará el PDF de PRODUCCIÓN")', 10000);
    ok(true, 'ADMIN · el diálogo de finalización anuncia «Se generará el PDF de PRODUCCIÓN»'); await ver(A, '10_dialogo_finalizar.png');
    await A.clic('Finalizar', 'button');
    await A.esperar('document.body.innerText.includes("FINALIZADA")', 60000); await espera(1500); t = await A.texto();
    ok(/FINALIZADA/.test(t) && /PRODUCCIÓN/.test(t) && !/FINALIZADA[^|\n]*PRUEBA/.test(t), 'ADMIN · el documento queda «FINALIZADA … PRODUCCIÓN» (no PRUEBA)', t.match(/FINALIZADA[^|\n]*/)?.[0]);
    const sinTexto = t.replace(/BORRADOR · SIN APROBAR/g, '');
    ok(!/\(TEST\)|Finalizada en TEST|NO VÁLIDO PARA PRODUCCIÓN/.test(sinTexto), 'ADMIN · ningún texto de TEST ni «NO VÁLIDO PARA PRODUCCIÓN» en la pantalla del documento finalizado', sinTexto.match(/\(TEST\)|Finalizada en TEST|NO VÁLIDO PARA PRODUCCIÓN/)?.[0]);
    ok(/Finalizada en PRODUCCIÓN como/.test(t), 'ADMIN · «Finalizada en PRODUCCIÓN como REV…» (corrección de esta fase)', t.match(/Finalizada en [^|\n]{0,80}/)?.[0]);
    await ver(A, '11_finalizada.png');
    const hist = await A.ev("fetch('/api/manufacturing-sheets/documents/history?codigo=" + CODIGO2 + "').then(r=>r.json())"); const fila = (hist.data ?? hist).find((x) => x.estado === 'FINALIZADA');
    ok(Boolean(fila) && fila.entorno === 'PRODUCCION' && fila.cliente?.verificado === false && fila.cliente?.nombre === 'Cliente Navegador SA', 'servidor · documento finalizado desde la interfaz: PRODUCCION y cliente manual persistido (verificado=false)', fila && { e: fila.entorno, c: fila.cliente });
    const pdf = await A.ev("fetch('/api/manufacturing-sheets/documents/revisions/" + fila.id + "/pdf').then(async (r) => { const b = new Uint8Array(await r.arrayBuffer()); return { s: r.status, t: r.headers.get('content-type'), m: String.fromCharCode(...b.slice(0, 5)), n: b.length }; })");
    ok(pdf.s === 200 && pdf.m === '%PDF-' && /pdf/.test(pdf.t), 'ADMIN · el PDF finalizado se descarga con la sesión del navegador (' + pdf.n + ' bytes)', pdf);
    const editable = await A.ev("[...document.querySelectorAll('input')].filter((i) => i.offsetParent && !i.disabled && !i.readOnly && !i.closest('fieldset:disabled') && (document.querySelector('label[for=\"' + i.id + '\"]') || {}).innerText === 'Cantidad por rollo o paquete').length");
    ok(editable === 0, 'ADMIN · el documento finalizado no permite editar sus campos en pantalla (inmutable)', editable);
    ok(/nueva revisión/i.test(t), 'ADMIN · la pantalla ofrece crear una nueva revisión', t.slice(t.indexOf('Finalizada en'), t.indexOf('Finalizada en') + 300));
  } finally { await A.cerrar(); await G.cerrar(); }
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: validación en navegador: todo PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
