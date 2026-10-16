// Renderiza la vista previa REAL (servicio compilado en dist/) de cada caso de casos.json y escribe un HTML por caso.
//   node generar_prototipo.cjs <carpeta_salida>
// Requiere `npm run build --workspace=@daubert/api` (usa dist/). No toca PostgreSQL ni BIND.
const fs = require('node:fs');
const path = require('node:path');
const dist = path.resolve(__dirname, '../../../dist/src/manufacturing-sheets/preview/sheet-preview.service.js');
if (!fs.existsSync(dist)) { console.error('Falta apps/api/dist: ejecuta «npm run build --workspace=@daubert/api» antes.'); process.exit(2); }
const { SheetPreviewService } = require(dist);
const salida = process.argv[2];
if (!salida) { console.error('Uso: node generar_prototipo.cjs <carpeta_salida>'); process.exit(2); }
fs.mkdirSync(salida, { recursive: true });
const casos = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos.json'), 'utf8'));
const servicio = new SheetPreviewService();
(async () => {
  const resumen = [];
  for (const caso of casos) {
    const r = await servicio.preview(caso.familia, caso.datos);
    fs.writeFileSync(path.join(salida, `${caso.id}.html`), r.html, 'utf8');
    resumen.push({ id: caso.id, familia: caso.familia, tipo: caso.tipo, completo: r.completo, bloqueado: r.bloqueado, faltantes: r.faltantes, advertencias: r.advertencias });
  }
  fs.writeFileSync(path.join(salida, 'resumen.json'), JSON.stringify(resumen, null, 1), 'utf8');
  console.log(`HTML generados: ${resumen.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
