// Mini-controlador de Chrome por DevTools Protocol (sin dependencias nuevas: usa `ws`, que ya está en node_modules). Para la validación en NAVEGADOR de la réplica.
const { spawn } = require('node:child_process'); const http = require('node:http'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const WebSocket = require('ws');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
async function lanzar({ puerto = 9333, ancho = 1440, alto = 1100 } = {}) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'ens-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`, `--window-size=${ancho},${alto}`, '--no-first-run', '--disable-extensions', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  let objetivo; for (let i = 0; i < 50; i++) { try { const l = await getJson(`http://127.0.0.1:${puerto}/json`); objetivo = l.find((t) => t.type === 'page'); if (objetivo) break; } catch { /* arrancando */ } await espera(300); }
  if (!objetivo) throw new Error('Chrome no arrancó');
  const ws = new WebSocket(objetivo.webSocketDebuggerUrl); await new Promise((r) => ws.once('open', r));
  let id = 0; const pend = new Map(); const eventos = [];
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend.has(j.id)) { const { res, rej } = pend.get(j.id); pend.delete(j.id); j.error ? rej(new Error(j.error.message)) : res(j.result); } else if (j.method) eventos.push(j); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const api = {
    send, ev, eventos,
    ir: async (url) => { await send('Page.navigate', { url }); await espera(1200); await api.esperar(() => 'document.readyState === "complete"'); },
    esperar: async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(typeof expr === 'function' ? expr() : expr)) return true; } catch { /* navegando */ } await espera(250); } throw new Error('tiempo agotado esperando: ' + String(typeof expr === 'function' ? expr() : expr).slice(0, 140)); },
    texto: () => ev('document.body.innerText'),
    // clic en el elemento visible más específico cuyo texto contiene `t` (botones, enlaces, pestañas, ítems de menú)
    clic: (t, sel = 'button, a, [role=button], [role=menuitem], [role=tab], li, label') => ev(`(() => { const t = ${JSON.stringify(t)}.toLowerCase(); const c = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.offsetParent !== null && e.innerText && e.innerText.trim().toLowerCase().includes(t) && !e.disabled); c.sort((a, b) => a.innerText.length - b.innerText.length); if (!c[0]) return false; c[0].scrollIntoView({ block: 'center' }); c[0].click(); return true; })()`),
    // escribe en un campo localizado por etiqueta (aria-label, label asociado, placeholder o name)
    escribir: async (etiqueta, valor) => { const ok = await ev(`(() => { const L = ${JSON.stringify(etiqueta)}.toLowerCase(); const campos = [...document.querySelectorAll('input, textarea')].filter((e) => e.offsetParent !== null && !e.disabled); const nombre = (e) => ((e.getAttribute('aria-label') || '') + ' ' + (e.placeholder || '') + ' ' + (e.name || '') + ' ' + (e.id && document.querySelector('label[for="' + e.id + '"]') ? document.querySelector('label[for="' + e.id + '"]').innerText : '') + ' ' + (e.closest('label') ? e.closest('label').innerText : '')).toLowerCase(); const c = campos.find((e) => nombre(e).includes(L)); if (!c) return false; c.scrollIntoView({ block: 'center' }); c.focus(); c.select && c.select(); return true; })()`); if (!ok) return false; await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 }); await send('Input.insertText', { text: valor }); return true; },
    teclear: async (key) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key }); },
    captura: async (archivo) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(archivo, Buffer.from(r.data, 'base64')); },
    cerrar: async () => { try { await send('Browser.close'); } catch { /* cerrado */ } try { ws.close(); } catch { /* */ } proc.kill(); }
  };
  return api;
}
module.exports = { lanzar, espera };
