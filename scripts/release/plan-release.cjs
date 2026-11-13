'use strict';

// Read-only release comparison. No DB, Docker, network calls or PROD configuration.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const GROUPS = ['hub', 'database', 'n8n', 'host', 'tooling', 'docs', 'other'];

function groupForPath(file) {
  if (/^database\//.test(file)) return 'database';
  if (/^n8n\//.test(file)) return 'n8n';
  if (/^scripts\/release\//.test(file) || /^\.github\//.test(file)) return 'tooling';
  if (/^scripts\//.test(file) || /^deploy\//.test(file)) return 'host';
  if (/^apps\//.test(file) || /^docker\//.test(file) || /^compose(?:\.|\/)/.test(file) || /^package(?:-lock)?\.json$/.test(file)) return 'hub';
  if (/^docs\//.test(file) || /^(?:README|CONTRIBUTING|CHANGELOG)\.md$/i.test(file)) return 'docs';
  return 'other';
}

function classifyChangedFiles(paths) {
  const files = [...new Set(paths.filter(Boolean))].sort();
  const groups = Object.fromEntries(GROUPS.map((group) => [group, []]));
  for (const file of files) groups[groupForPath(file)].push(file);
  const hubRequiresBuild = groups.hub.length > 0;
  const needsCoordination = ['database', 'n8n', 'host', 'other'].some((group) => groups[group].length > 0);
  const decision = needsCoordination ? 'REQUIERE_COORDINACION_MANUAL' : hubRequiresBuild ? 'CANDIDATO_SOLO_HUB' : 'SIN_DESPLIEGUE_HUB';
  const warnings = [];
  if (groups.database.length) warnings.push('Cambios en database/: aplicar migraciones por separado con precheck, backup y postcheck; no ejecutar SQL desde CI.');
  if (groups.n8n.length) warnings.push('Cambios en n8n/: validar y promover workflows por separado; este proceso nunca importa ni activa workflows.');
  if (groups.host.length) warnings.push('Cambios en scripts/ o deploy/: requieren revision operativa del host antes de desplegar.');
  if (groups.other.length) warnings.push('Rutas no clasificadas: requiere revision manual para determinar impacto.');
  return { decision, hubRequiresBuild, needsCoordination, groups, warnings, totalChangedFiles: files.length };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function verifiedSha(ref) {
  if (!/^[0-9a-f]{7,40}$/i.test(ref)) throw new Error('Los commits deben indicarse como SHA hexadecimal de 7 a 40 caracteres.');
  return git('rev-parse', '--verify', `${ref}^{commit}`);
}

function buildPlan({ base, head, version, files, generatedAt }) {
  return {
    schemaVersion: 1,
    generatedAt,
    baselineCommit: base,
    candidateCommit: head,
    version,
    ...classifyChangedFiles(files),
    advisory: 'REPORTE INFORMATIVO. No valida CI ni el estado de PROD; no autoriza un despliegue.',
  };
}

function renderMarkdown(plan) {
  const counts = GROUPS.map((g) => `| ${g} | ${plan.groups[g].length} |`).join('\n');
  const flags = plan.warnings.length ? plan.warnings.map((v) => `- ${v}`).join('\n') : '- Sin advertencias de alcance detectadas (requiere preflight local).';
  const allFiles = GROUPS.flatMap((g) => plan.groups[g].map((p) => `- \`${p}\` (${g})`));
  return [
    '# Daubert Hub — candidato de release', '',
    `- **Version declarada:** \`${plan.version}\``,
    `- **Commit PROD de referencia (declarado por operador):** \`${plan.baselineCommit}\``,
    `- **Commit candidato:** \`${plan.candidateCommit}\``,
    `- **Clasificacion:** \`${plan.decision}\``,
    `- **Requiere build de Hub:** ${plan.hubRequiresBuild ? 'SI' : 'NO'}`,
    `- **Generado (UTC):** ${plan.generatedAt}`, '',
    '## Alcance', '', '| Grupo | Archivos |', '| --- | ---: |', counts, '',
    '## Advertencias', '', flags, '',
    '## Archivos modificados', '', ...(allFiles.length ? allFiles : ['- Ninguno']), '',
    '> **No es una autorizacion de produccion.** Verificar CI, estado real de `/api/health`, respaldos, preflight y aprobacion manual antes del despliegue. El workflow no accede a PostgreSQL, n8n ni Docker.', '',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {};
  if (argv.length % 2) throw new Error('Uso: --base <sha> --head <sha> --out-dir <directorio>');
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--base', '--head', '--out-dir'].includes(key) || options[key] || !argv[i + 1]) throw new Error('Parametros invalidos o duplicados.');
    options[key] = argv[i + 1];
  }
  if (!options['--base'] || !options['--head'] || !options['--out-dir']) throw new Error('Faltan --base, --head o --out-dir.');
  return options;
}

function main(argv) {
  const args = parseArgs(argv);
  const base = verifiedSha(args['--base']);
  const head = verifiedSha(args['--head']);
  if (head !== git('rev-parse', 'HEAD')) throw new Error('El candidato debe ser el HEAD actual, para mantener consistente package.json.');
  try { execFileSync('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' }); }
  catch { throw new Error('El commit base debe ser ancestro del candidato; revisar el SHA realmente desplegado.'); }
  const changed = git('diff', '--no-renames', '--name-only', '--diff-filter=ACDMRT', base, head, '--');
  const files = changed ? changed.split(/\r?\n/) : [];
  const version = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !version) throw new Error('Falta version valida en package.json.');
  const plan = buildPlan({ base, head, files, version, generatedAt: new Date().toISOString() });
  const out = path.resolve(args['--out-dir']);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'release-manifest.json'), `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'release-report.md'), renderMarkdown(plan));
  process.stdout.write(`Clasificacion: ${plan.decision}; archivos: ${plan.totalChangedFiles}; salida: ${out}\n`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`No se pudo preparar el release: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { groupForPath, classifyChangedFiles, buildPlan, renderMarkdown, parseArgs };
