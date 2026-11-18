// Validación del procedimiento 102 (precheck → UP → postcheck → smoke → DOWN → UP) en un contenedor DESECHABLE (127.0.0.1:55436). Nunca TEST/PROD.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const RAIZ = 'C:\\Users\\06\\Documents\\Daubert\\daubert-hub';
const MIG = path.join(RAIZ, 'database', 'migrations', 'daubert_hub_test');
const { INIT } = require(path.join(MIG, 'tools', 'instancia-desechable.cjs'));
const C = 'daubert-scratch-pg-102';
const d = (a) => spawnSync('docker', a, { encoding: 'utf8' });
const ejecutar = (archivo, usuario = 'postgres', extra = [], base = 'daubert_hub_test') => {
  const r = d(['exec', '-e', 'PGPASSWORD=' + (usuario === 'postgres' ? 'scratch' : 'scratch'), C, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', base, '-X', '-v', 'ON_ERROR_STOP=1', ...extra, '-f', '/tmp/' + archivo]);
  return r;
};
const cp = (src, name) => d(['cp', src, C + ':/tmp/' + name]);
const P = '20261103_102_manufactura_responsables_firmas_test';
const log = [];
const paso = (nombre, r, esperado) => { const ok = r.status === 0 && (!esperado || esperado.test(r.stdout + r.stderr)); log.push(`${ok ? 'OK ' : 'FALLA'} ${nombre}`); if (!ok) log.push((r.stdout + r.stderr).split('\n').slice(-25).join('\n')); return r; };
d(['rm', '-f', C]);
const run = d(['run', '-d', '--rm', '--name', C, '-e', 'POSTGRES_PASSWORD=scratch', '-p', '127.0.0.1:55436:5432', 'postgres:18-alpine']);
if (run.status !== 0) { console.log(run.stderr); process.exit(1); }
try {
  for (let i = 0; i < 80; i++) { if (d(['exec', C, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v102-'));
  fs.writeFileSync(path.join(tmp, 'init.sql'), INIT);
  cp(path.join(tmp, 'init.sql'), 'init.sql');
  cp(path.join(MIG, '20261030_101_manufactura_gestor_documental_test.up.sql'), 'up101.sql');
  for (const s of ['precheck', 'up', 'postcheck', 'smoke', 'down']) cp(path.join(MIG, `${P}.${s}.sql`), `${s}.sql`);
  paso('init réplica', ejecutar('init.sql', 'postgres', [], 'postgres'));
  paso('UP 101', ejecutar('up101.sql'), /UP_OK/);
  const pre = paso('precheck 102', ejecutar('precheck.sql'), /t\s*\n/);
  const huella = /huella_101\s*\n-+\n\s*([0-9a-f]{32})/.exec(pre.stdout)?.[1];
  log.push('precheck all_prechecks_pass: ' + /all_prechecks_pass[\s\S]*?\n\s*[-+]+\n?[\s\S]*?\bt\b\s*\n/.test(pre.stdout) + ' · huella_101=' + huella);
  const allpre = /all_prechecks_pass\s*\n[-+\s]*\n[^\n]*\|\s*t\s*\n|all_prechecks_pass[\s\S]{0,400}?\n\s*(?:t\s*\|)?[^\n]*\bt\s*\n/.test(pre.stdout);
  log.push('(precheck impreso)\n' + pre.stdout.split('\n').slice(0, 14).join('\n'));
  paso('UP 102', ejecutar('up.sql'), /UP_OK manufactura 102/);
  const post = paso('postcheck 102', ejecutar('postcheck.sql', 'postgres', ['-v', 'huella_101=' + huella]));
  log.push('(postcheck impreso)\n' + post.stdout);
  const smoke = paso('smoke 102 (rol app)', ejecutar('smoke.sql', 'daubert_hub_test_user'));
  log.push('(smoke impreso)\n' + smoke.stdout);
  const sinConf = ejecutar('down.sql');
  log.push('DOWN sin datos: ' + (sinConf.status === 0 ? 'OK' : 'FALLA') + ' ' + /DOWN_OK/.test(sinConf.stdout));
  const again = paso('DOWN idempotente (segunda vez)', ejecutar('down.sql'));
  paso('UP 102 tras DOWN', ejecutar('up.sql'), /UP_OK manufactura 102/);
  const post2 = paso('postcheck 102 tras reaplicar', ejecutar('postcheck.sql', 'postgres', ['-v', 'huella_101=' + huella]));
  log.push(post2.stdout.split('\n').filter((l) => /all_postchecks_pass|^ *t|^ *f/.test(l)).join('\n'));
} finally { d(['rm', '-f', C]); }
console.log(log.join('\n'));
