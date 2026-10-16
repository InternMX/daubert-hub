/* Demostración reproducible exclusivamente LOCAL: fixtures simulados, frontend real y compositor real.
 * No inicia Nest, no carga .env, no conecta a BIND/BD/Dropbox. Nunca incluir este servidor en producción.
 * Uso desde raíz: node apps/api/test/manufacturing-sheets/prototype/demostracion.cjs --salida CARPETA [--capturas]
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { interpretarProductoBind, sugerirEspecificacion, sugerirDatosPlantilla } = require('../../../dist/src/manufacturing-sheets/bind-product-interpreter');
const { configuracionFamilias } = require('../../../dist/src/manufacturing-sheets/preview/family-registry');
const { SheetPreviewService } = require('../../../dist/src/manufacturing-sheets/preview/sheet-preview.service');
const ROOT = path.resolve(__dirname, '../../../../..');
const WEB = path.join(ROOT, 'apps/web/dist');
const casos = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos.json'), 'utf8')).filter((c) => c.tipo === 'normal' && c.id !== 'hojas-extendida');
const salidaArg = process.argv.indexOf('--salida');
const salida = path.resolve(salidaArg >= 0 ? process.argv[salidaArg + 1] : path.join(__dirname, 'test-results/demo'));
fs.mkdirSync(salida, { recursive: true });
const service = new SheetPreviewService();
const productos = casos.map((c) => ({ ID: `simulado-${c.id}`, Code: c.datos.codigo, Title: c.datos.descripcion, Weight: c.datos.pesoLb, Description: 'FIXTURE SIMULADO para demostración local; no consultado a BIND real.', CreationDate: null }));
productos.push({ ID: 'simulado-paper', Code: 'TARPPW3301', Title: 'PAPEL VCI PW33 100 X 200 MM PAQUETE C/100 HOJAS', Weight: null, Description: 'FIXTURE SIMULADO: detección de papel sin plantilla.', CreationDate: null });
function lookup(producto) {
  const interpretacion = interpretarProductoBind(producto);
  const sugerencias = sugerirEspecificacion(interpretacion);
  return { origen: 'BIND', producto, interpretacion, sugerencias, datosSugeridosPlantilla: sugerirDatosPlantilla(interpretacion), familiaSugerida: sugerencias.familia.valor ? [sugerencias.familia.valor] : [], pendientes: interpretacion.pendientes, advertencias: interpretacion.advertencias, especificacionConfirmada: false };
}
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/auth/me') return json(res, 200, { data: { user: { id: 'demo-local', displayName: 'DEMOSTRACIÓN SIMULADA', email: 'demo@example.invalid', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: false } } });
    if (url.pathname === '/api/manufacturing-sheets/families') return json(res, 200, { data: configuracionFamilias() });
    if (url.pathname.startsWith('/api/manufacturing-sheets/bind-products/by-code/')) {
      const p = productos.find((p) => p.Code === decodeURIComponent(url.pathname.split('/').at(-1)));
      return json(res, p ? 200 : 404, p ? { data: lookup(p) } : { code: 'BIND_PRODUCT_NOT_FOUND' });
    }
    if (url.pathname === '/api/manufacturing-sheets/previews' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) return json(res, 413, {}); }
      const body = JSON.parse(raw);
      if (!configuracionFamilias().some((c) => c.codigo === body.familia)) return json(res, 400, {});
      return json(res, 200, { data: await service.preview(body.familia, body.datos, body.contexto) });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { message: 'Solo rutas simuladas de manufactura.' });
    let file = path.resolve(WEB, `.${url.pathname}`);
    if (!file.startsWith(WEB + path.sep)) file = path.join(WEB, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = content.toString().replace('<body>', '<body><div style="position:fixed;top:0;left:0;right:0;z-index:99999;text-align:center;background:#fff3cd;color:#633c00;font:bold 12px Arial;padding:4px">DEMOSTRACIÓN LOCAL · FIXTURES SIMULADOS · NO ES BIND REAL</div>');
    res.end(content);
  } catch { json(res, 400, { message: 'Datos de demostración no válidos.' }); }
});

const labels = { codigo: 'Código DCMX', descripcion: 'Descripción', producto: 'Producto', resinaVci: 'Resina VCI', colorNombre: 'Texto del color en el documento', cantidad: 'Cantidad por rollo o paquete', ancho: 'Ancho', largo: 'Largo', calibre: 'Calibre', pesoLb: 'Peso (lb)', etiqueta: 'Etiqueta', fuelleTotal: 'Fuelle total', fuelleDerecho: 'Fuelle derecho', fuelleIzquierdo: 'Fuelle izquierdo', anchoRollo: 'Ancho del rollo', anchoDoblado: 'Ancho doblado', medidaPliegue: 'Medida del pliegue', largoPresentacionFinal: 'Largo de la presentación final', anchoPresentacionFinal: 'Ancho de la presentación final', pesoCapaInterior: 'Peso de la capa interior (lb)', pesoCapaIntermedia: 'Peso de la capa intermedia (lb)', pesoCapaExterior: 'Peso de la capa exterior (lb)', lbVciInterior: 'Libras de VCI de la capa interior', lbVciIntermedia: 'Libras de VCI de la capa intermedia', lbVciExterior: 'Libras de VCI de la capa exterior' };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function capturas(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'daubert-demo-'));
  const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    const active = path.join(profile, 'DevToolsActivePort');
    for (let n = 0; !fs.existsSync(active) && n < 100; n++) await delay(100);
    const debug = fs.readFileSync(active, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${debug}/json`)).json();
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const k = ++id; pending.set(k, { resolve, reject }); ws.send(JSON.stringify({ id: k, method, params })); });
    const evaluate = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const wait = async (expression) => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`No se cumplió: ${expression}`); };
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
    const resumen = [];
    for (const caso of casos) {
      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/automations/manufacturing-sheets` });
      await wait(`!!document.querySelector('input[placeholder="Ej. SCHFPMG001"]')`);
      await delay(200);
      await evaluate(`(() => { const e=document.querySelector('input[placeholder="Ej. SCHFPMG001"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(caso.datos.codigo)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await delay(50);
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Buscar en BIND')).click()`);
      await wait(`!!document.querySelector('input[value="${caso.familia}"]')`);
      await evaluate(`document.querySelector('input[value="${caso.familia}"]').click()`);
      await delay(100);
      // Controles reales de React; solo se completan los valores del fixture, sin inyectar un formulario alternativo.
      await evaluate(`(async () => {
        const d=${JSON.stringify(caso.datos)}, labels=${JSON.stringify(labels)};
        const pause=()=>new Promise(r=>setTimeout(r,25));
        for(const [k,label] of Object.entries(labels)) {
          if(!(k in d)) continue;
          const l=[...document.querySelectorAll('label')].find(l=>l.textContent===label);
          const e=l && document.getElementById(l.htmlFor);
          if(!e || !['INPUT','TEXTAREA'].includes(e.tagName)) continue;
          const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(e,d[k]);e.dispatchEvent(new Event('input',{bubbles:true}));await pause();
        }
        for(const k of ['composicion','presentacion','modalidad']) { const e=document.querySelector('input[value="'+d[k]+'"]'); if(e&&!e.disabled)e.click(); await pause(); }
        for(const [k,label] of [['unidadDimensiones','Unidad de las medidas'],['cantidadUnidad','Unidad de la cantidad'],['coexVariante','Variante COEX']]) {
          if(!d[k])continue; const l=[...document.querySelectorAll('label')].find(l=>l.textContent===label);const e=l&&document.getElementById(l.htmlFor);
          if(!e)continue; e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));await pause();
          document.querySelector('li[data-value="'+d[k]+'"]')?.click();await pause();
        }
        [...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar familia')?.click();
      })()`);
      await wait(`!!document.querySelector('iframe[srcdoc]') && !document.querySelector('[aria-label="Actualizando vista previa"]')`);
      await delay(150);
      const texto = await evaluate('document.body.innerText');
      if (texto.includes('Datos técnicos incompletos (')) throw new Error(`Caso incompleto en UI: ${caso.id}: ${texto.slice(-4000)}`);
      const dims = await cdp('Page.getLayoutMetrics');
      const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height: dims.cssContentSize.height, scale: 1 } });
      fs.writeFileSync(path.join(salida, `${caso.id}-formulario.png`), Buffer.from(shot.data, 'base64'));
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Ampliar').click()`);
      await wait(`!!document.querySelector('[role="dialog"] iframe')`);
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1800, deviceScaleFactor: 1, mobile: false });
      await delay(250);
      const ampliada = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(salida, `${caso.id}-hoja-ampliada.png`), Buffer.from(ampliada.data, 'base64'));
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
      resumen.push({ id: caso.id, formularioCompleto: true, captura: `${caso.id}-hoja-ampliada.png` });
      console.log(`Capturas OK: ${caso.id}`);
    }
    fs.writeFileSync(path.join(salida, 'capturas-resultados.json'), JSON.stringify(resumen, null, 2));
  } finally { ws?.close(); chrome.kill(); await delay(300); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
}

async function main() {
  const documentados = [];
  for (let i = 0; i < casos.length; i++) {
    const c = casos[i]; const p = productos[i]; const r = lookup(p);
    const preview = await service.preview(c.familia, c.datos, { title: p.Title, code: p.Code });
    documentados.push({ ...c, origen: 'FIXTURE_SIMULADO_NO_CONSULTADO_A_BIND', producto: p, automaticos: r.interpretacion.campos, sugerencias: r.sugerencias, advertenciasOrigen: r.advertencias, resultado: { ...preview, html: undefined } });
  }
  fs.writeFileSync(path.join(salida, 'casos-demostracion.json'), JSON.stringify(documentados, null, 2));
  const lineas = ['# Ocho casos reproducibles', '', '**Todos son fixtures simulados reproducidos localmente; no se consultó BIND real.**', '', 'Los datos finales son valores de prueba capturados o confirmados por el demostrador. Cliente vacío en todos los casos. Ninguno es una especificación oficial.', ''];
  for (const c of documentados) {
    lineas.push(`## ${c.id} · ${c.familia}`, '', `- Código: \`${c.producto.Code}\``, `- Title: ${c.producto.Title}`, `- Familia esperada: ${c.familia}. Seleccionarla o confirmar la sugerencia.`, '', '### Datos obtenidos automáticamente del fixture', '');
    for (const [key, campo] of Object.entries(c.automaticos)) if (campo.origen === 'EXTRAIDO' && campo.valor !== null) lineas.push(`- ${key}: ${JSON.stringify(campo.valor)} (${campo.procedencia ?? 'TITLE'}).`);
    lineas.push('', '### Derivados / sugeridos (requieren revisión)', '', `- Familia: ${c.sugerencias.familia.valor ?? 'pendiente'}. ${c.sugerencias.familia.motivo}`, `- Color: ${c.sugerencias.color.nota}`, `- Resina VCI: ${c.sugerencias.resinaVci.nota}`);
    for (const [key, campo] of Object.entries(c.automaticos)) if (campo.origen === 'SUGERIDO') lineas.push(`- ${key}: ${JSON.stringify(campo.valor)}. ${campo.nota ?? ''}`);
    lineas.push('', '### Captura / confirmación manual', '', '- Confirmar familia y revisar todos los valores sugeridos. Fecha local editable; cliente opcional solo para demostración.');
    const equivalencias = { composicion: 'resina', cantidadUnidad: 'cantidad' };
    for (const [key, valor] of Object.entries(c.datos)) {
      const campo = c.automaticos[equivalencias[key] ?? key];
      if ((!campo || campo.origen === 'PENDIENTE' || campo.valor === null) && !['codigo', 'descripcion', 'etiqueta', 'fechaEmision', 'colorHex', 'colorNombre', 'resinaVci'].includes(key)) lineas.push(`- ${labels[key] ?? key}: \`${valor}\`.`);
    }
    lineas.push('', '### Advertencias esperadas y vista previa', '', ...c.advertenciasOrigen.map((a) => `- Origen: ${a.mensaje}`), ...c.resultado.avisosTecnicos.map((a) => `- ${a.nivel}: ${a.mensaje}`), `- Resultado final: ${c.resultado.completo ? 'datos técnicos completos' : 'incompleto'}, ${c.resultado.bloqueado ?? 'HTML generado con su plantilla aprobada'}, firmas SIN FIRMA. Pendientes de emisión: ${c.resultado.pendientesEmision.join(', ') || 'ninguno'}.`, `- Capturas: \`${c.id}-formulario.png\` y \`${c.id}-hoja-ampliada.png\`.`, '', '### Valores finales del caso', '', '```json', JSON.stringify(c.datos, null, 2), '```', '');
  }
  fs.writeFileSync(path.join(salida, 'CASOS_DEMOSTRACION.md'), lineas.join('\n'));
  server.listen(4199, '127.0.0.1', async () => {
    console.log('DEMO SIMULADA: http://127.0.0.1:4199/automations/manufacturing-sheets');
    if (process.argv.includes('--capturas')) { try { await capturas(4199); } catch (e) { console.error(e); process.exitCode = 1; } finally { server.closeAllConnections(); server.close(); } }
  });
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
