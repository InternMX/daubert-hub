// Simulador CONTROLADO de BIND ERP para réplicas desechables (HTTPS en api.bind.com.mx:443 dentro de una red Docker interna; la API lo ve con --add-host y un CA propio en NODE_EXTRA_CA_CERTS).
// No es BIND: devuelve respuestas fijas según el código consultado (`Code eq '<código>'`). Registra cada solicitud (sin imprimir el token) para evidencia.
const https = require('node:https'); const fs = require('node:fs');
const dir = process.env.CERTS || '/certs';
const P = (Code, Title, Description, Weight, CreationDate = '2026-11-01T10:00:00Z') => ({ ID: '00000000-0000-4000-8000-' + String(Math.abs([...Code].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))).padStart(12, '0').slice(0, 12), Code, Title, Description, Weight, CreationDate });
const CATALOGO = {
  'SCHFPMG001': [P('SCHFPMG001', 'BOLSA VCI PMG 13 x 16 CAL. 3 MIL', 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 0.0428)],
  'DCMX-INCOMPLETO': [P('DCMX-INCOMPLETO', 'PRODUCTO SIN DATOS', null, null)],
  'DCMX-AMBIGUO': [P('DCMX-AMBIGUO', 'BOLSA AMBIGUA', 'BOLSA VCI 13 x 16 o 14 x 18 CAL. 3 MIL SEGUN CLIENTE', 0.05)],
  'DCMX-DUPLICADO': [P('DCMX-DUPLICADO', 'DUP 1', 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL', 0.04), P('DCMX-DUPLICADO', 'DUP 2', 'BOLSA VCI PMG 14 x 18" CAL. 3 MIL', 0.05)]
};
const RECIENTES = [P('SCHFPMG001', 'BOLSA VCI PMG 13 x 16 CAL. 3 MIL', 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 0.0428, '2026-11-05T09:00:00Z'), P('DCMX-AMBIGUO', 'BOLSA AMBIGUA', 'BOLSA VCI 13 x 16 o 14 x 18', 0.05, '2026-11-03T09:00:00Z')];
const servidor = https.createServer({ key: fs.readFileSync(dir + '/srv.key'), cert: fs.readFileSync(dir + '/srv.pem') }, (req, res) => {
  const u = new URL(req.url, 'https://api.bind.com.mx'); const filtro = u.searchParams.get('$filter') || '';
  const m = /Code eq '([^']+)'/.exec(filtro); const code = m ? m[1] : null;
  console.log(JSON.stringify({ t: new Date().toISOString(), metodo: req.method, ruta: u.pathname, filtro, auth: /^Bearer \S+/.test(req.headers.authorization || '') ? 'Bearer ***' : 'ausente', codigo: code }));
  const json = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (u.pathname !== '/api/Products') return json(404, { error: 'ruta' });
  if (code === 'DCMX-401') return json(401, { error: 'unauthorized' });
  if (code === 'DCMX-429') { res.writeHead(429, { 'retry-after': '1' }); return res.end('{}'); }
  if (code === 'DCMX-ERROR') return json(500, { error: 'boom' });
  if (code === 'DCMX-INVALIDO') return json(200, { value: [{ nada: true }] });
  if (code === 'DCMX-LENTO') return setTimeout(() => json(200, { value: [] }), 60000);
  if (!filtro) return json(200, { value: RECIENTES.slice(0, Number(u.searchParams.get('$top') || 30)) });
  // Cualquier SCHFPMG### devuelve el mismo producto con ese código (permite crear hojas nuevas en cada corrida del ensayo).
  if (code && /^SCHFPMG\d{3}$/.test(code) && !CATALOGO[code]) return json(200, { value: [P(code, 'BOLSA VCI PMG 13 x 16 CAL. 3 MIL', 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', 0.0428)] });
  return json(200, { value: CATALOGO[code] || [] });
});
servidor.listen(443, '0.0.0.0', () => console.log('simulador BIND escuchando en 443'));
