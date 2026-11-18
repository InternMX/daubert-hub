#!/usr/bin/env node
// GENERADOR del MANIFIESTO de archivos de database/ de una liberación (lo consume la compuerta de Deploy-DaubertHub.ps1 con -DatabaseManifest y lo usa Invoke-ManufacturaMigrations.ps1).
//   node scripts/deploy/generar-manifiesto-database.cjs --base 16153a8 [--salida deploy/release-manifests/manufactura-database-release.json]
//   node scripts/deploy/generar-manifiesto-database.cjs --verificar deploy/release-manifests/manufactura-database-release.json     (compara el manifiesto con HEAD; código 1 si difiere)
// El manifiesto lista, para cada archivo de database/ que cambió entre --base y HEAD: su ruta, su categoría, el id de blob de git (SHA-1 del contenido) y su SHA-256. La compuerta exige que el delta del
// release sea EXACTAMENTE ese conjunto con esos contenidos: un archivo nuevo, ausente o modificado hace que la compuerta bloquee. No contiene secretos y no ejecuta SQL.
//
// Categorías:
//   produccion_aplicar     precheck / up / postcheck de las migraciones de producción autorizadas (SE APLICAN, en el orden de «ordenMigraciones»).
//   produccion_reversion   down de esas migraciones (solo para revertir; nunca en el avance).
//   produccion_lectura     verificaciones de SOLO LECTURA de producción (línea base / matriz de privilegios / humo de solo lectura).
//   inerte_nunca_en_prod   TEST (daubert_hub_test), mantenimiento, herramientas, réplica desechable y documentación: viajan en el repositorio pero NO se ejecutan en producción.
const { spawnSync } = require('node:child_process'); const crypto = require('node:crypto'); const fs = require('node:fs'); const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const git = (args, opts = {}) => spawnSync('git', ['-C', REPO, ...args], { encoding: opts.binario ? 'buffer' : 'utf8', maxBuffer: 100_000_000 });

// ---- Migraciones de producción autorizadas, EN ESTE ORDEN (la 025 pertenece a otra rama —recuperación de folios de Caterpillar, TEST— y está excluida a propósito).
const ORDEN = [
  { paso: '020', id: '20261108_020_manufactura_gestor_documental_prod' },
  { paso: '021', id: '20261108_021_manufactura_responsables_firmas_prod' },
  { paso: '022', id: '20261108_022_manufactura_inventario_firmas_admin_prod' },
  { paso: '023', id: '20261108_023_manufactura_cliente_abreviaturas_prod' },
  { paso: '024', id: '20261108_024_manufactura_consulta_compartida_borradores_prod' },
  { paso: '026', id: '20261109_026_manufactura_respaldo_rls_prod' }
];
const LECTURA = ['20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql', '20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql'];
const PROHIBIDOS = ['_025_', 'caterpillar_folio_recovery', 'cat_recovery'];
const PREFIJO = 'database/migrations/daubert_global/';

function categoria(ruta) {
  if (ruta.startsWith(PREFIJO)) {
    const n = ruta.slice(PREFIJO.length);
    for (const o of ORDEN) {
      if (n === `${o.id}.precheck.sql` || n === `${o.id}.up.sql` || n === `${o.id}.postcheck.sql`) return 'produccion_aplicar';
      if (n === `${o.id}.down.sql`) return 'produccion_reversion';
    }
    if (LECTURA.includes(n)) return 'produccion_lectura';
  }
  return 'inerte_nunca_en_prod';
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const contenido = (ruta) => { const r = git(['cat-file', 'blob', `HEAD:${ruta}`], { binario: true }); return r.status === 0 ? r.stdout : null; };
const blob = (ruta) => { const r = git(['rev-parse', `HEAD:${ruta}`]); return r.status === 0 ? r.stdout.trim() : null; };

function construir(base) {
  const d = git(['diff', '--name-only', base, 'HEAD', '--', 'database']);
  if (d.status !== 0) throw new Error('git diff falló: ' + d.stderr);
  const rutas = d.stdout.split('\n').filter(Boolean).sort();
  const archivos = rutas.map((ruta) => { const c = contenido(ruta); if (c === null) throw new Error(`${ruta} no existe en HEAD (¿eliminado? la compuerta no autoriza eliminaciones)`); return { ruta, categoria: categoria(ruta), blob: blob(ruta), sha256: sha256(c), bytes: c.length }; });
  const malos = archivos.filter((a) => PROHIBIDOS.some((p) => a.ruta.includes(p)));
  if (malos.length) throw new Error('el delta incluye archivos prohibidos (migración 025 de otra rama u otros): ' + malos.map((m) => m.ruta).join(', '));
  const faltan = ORDEN.flatMap((o) => ['precheck', 'up', 'postcheck', 'down'].map((f) => `${PREFIJO}${o.id}.${f}.sql`)).filter((r) => !archivos.some((a) => a.ruta === r));
  if (faltan.length) throw new Error('faltan archivos de las migraciones autorizadas en el delta: ' + faltan.join(', '));
  const conteo = {}; for (const a of archivos) conteo[a.categoria] = (conteo[a.categoria] ?? 0) + 1;
  return {
    formato: 1,
    descripcion: 'Archivos de database/ autorizados para la liberación de Manufactura (migraciones 020-024 y 026). Generado por scripts/deploy/generar-manifiesto-database.cjs; verificar con -DatabaseManifestSha256 entregado fuera del repositorio.',
    base: git(['rev-parse', base]).stdout.trim(),
    ordenMigraciones: ORDEN.map((o) => ({ ...o, fases: ['precheck', 'up', 'postcheck'], reversion: 'down' })),
    lecturaProduccion: LECTURA,
    prohibidos: PROHIBIDOS,
    resumen: conteo,
    archivos
  };
}

if (arg('--verificar')) {
  const m = JSON.parse(fs.readFileSync(path.resolve(REPO, arg('--verificar')), 'utf8')); let mal = 0;
  const reconstruido = construir(m.base);
  const a = new Map(m.archivos.map((x) => [x.ruta, x])); const b = new Map(reconstruido.archivos.map((x) => [x.ruta, x]));
  for (const [r, x] of b) { const y = a.get(r); if (!y) { console.log('NO AUTORIZADO (nuevo en HEAD): ' + r); mal++; } else if (y.blob !== x.blob || y.sha256 !== x.sha256 || y.categoria !== x.categoria) { console.log('MODIFICADO respecto del manifiesto: ' + r); mal++; } }
  for (const r of a.keys()) if (!b.has(r)) { console.log('EN EL MANIFIESTO pero ya no cambia respecto de la base: ' + r); mal++; }
  console.log(mal ? `MANIFIESTO NO COINCIDE (${mal})` : `MANIFIESTO COINCIDE con HEAD (${m.archivos.length} archivos, base ${m.base.slice(0, 7)})`); process.exit(mal ? 1 : 0);
}
const base = arg('--base'); if (!base) { console.error('Uso: --base <commit desplegado> [--salida ruta] | --verificar <manifiesto>'); process.exit(2); }
const salida = path.resolve(REPO, arg('--salida') ?? 'deploy/release-manifests/manufactura-database-release.json');
const m = construir(base); fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(m, null, 2) + '\n', 'utf8');
const normalizado = Buffer.from(fs.readFileSync(salida, 'utf8').split('\r\n').join('\n'), 'utf8');
console.log(`Manifiesto escrito: ${path.relative(REPO, salida)} · ${m.archivos.length} archivos · ${JSON.stringify(m.resumen)} · SHA-256 del manifiesto (texto con LF): ${sha256(normalizado)}`);
