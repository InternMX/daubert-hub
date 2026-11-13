// Validación del procedimiento 105 (101 + 102 + 103 + 104 → precheck → UP → postcheck → smoke → DOWN (con y sin datos) → UP → postcheck) en un contenedor DESECHABLE (127.0.0.1:55439). Nunca TEST/PROD.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const MIG = path.resolve(__dirname, '..');
const { INIT } = require(path.join(MIG, 'tools', 'instancia-desechable.cjs'));
const C = 'daubert-scratch-pg-105';
const d = (a) => spawnSync('docker', a, { encoding: 'utf8' });
const ejecutar = (archivo, usuario = 'postgres', extra = []) =>
  d(['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', archivo === 'init.sql' ? 'postgres' : 'daubert_hub_test', '-X', '-v', 'ON_ERROR_STOP=1', ...extra, '-f', '/tmp/' + archivo]);
const sql = (texto, usuario = 'postgres') => d(['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', 'daubert_hub_test', '-X', '-v', 'ON_ERROR_STOP=1', '-c', texto]);
const cp = (src, name) => d(['cp', src, C + ':/tmp/' + name]);
const P = '20261107_105_manufactura_consulta_compartida_borradores_test';
const log = [];
const paso = (nombre, r, esperado) => { const ok = r.status === 0 && (!esperado || esperado.test(r.stdout + r.stderr)); log.push(`${ok ? 'OK   ' : 'FALLA'} ${nombre}`); if (!ok) log.push((r.stdout + r.stderr).split('\n').slice(-25).join('\n')); return r; };
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

d(['rm', '-f', C]);
const run = d(['run', '-d', '--rm', '--name', C, '-e', 'POSTGRES_PASSWORD=scratch', '-p', '127.0.0.1:55439:5432', 'postgres:18-alpine']);
if (run.status !== 0) { console.log(run.stderr); process.exit(1); }
try {
  for (let i = 0; i < 80; i++) { if (d(['exec', C, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; dormir(500); }
  dormir(1500);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v105-'));
  fs.writeFileSync(path.join(tmp, 'init.sql'), INIT);
  cp(path.join(tmp, 'init.sql'), 'init.sql');
  cp(path.join(MIG, '20261030_101_manufactura_gestor_documental_test.up.sql'), 'up101.sql');
  cp(path.join(MIG, '20261103_102_manufactura_responsables_firmas_test.up.sql'), 'up102.sql');
  cp(path.join(MIG, '20261105_103_manufactura_inventario_firmas_admin_test.up.sql'), 'up103.sql');
  cp(path.join(MIG, '20261106_104_manufactura_cliente_abreviaturas_test.up.sql'), 'up104.sql');
  for (const s of ['precheck', 'up', 'postcheck', 'smoke', 'down']) cp(path.join(MIG, `${P}.${s}.sql`), `${s}.sql`);
  paso('init réplica', ejecutar('init.sql'));
  paso('UP 101', ejecutar('up101.sql'), /UP_OK/);
  paso('UP 102', ejecutar('up102.sql'), /UP_OK manufactura 102/);
  paso('UP 103', ejecutar('up103.sql'), /UP_OK/);
  paso('UP 104', ejecutar('up104.sql'), /UP_OK manufactura 104/);
  const pre = paso('precheck 105', ejecutar('precheck.sql'));
  const huella = /huella_resto\s*\n-+\n\s*([0-9a-f]{32})/.exec(pre.stdout)?.[1];
  log.push('precheck: ' + pre.stdout.split('\n').filter((l) => /^\s*t\s*\||\| t\s*$|all_prechecks_pass/.test(l)).join(' ') + ' · huella_manufactura=' + huella);
  paso('UP 105', ejecutar('up.sql'), /UP_OK manufactura 105/);
  const ok = (t) => (/all_postchecks_pass[\s\S]*\n[^\n]*\|\s*t\s*\n/.test(t) ? 'true' : 'REVISAR');
  const post = paso('postcheck 105', ejecutar('postcheck.sql', 'postgres', ['-v', 'huella_resto=' + huella]));
  log.push('postcheck all_postchecks_pass = ' + ok(post.stdout) + '\n' + post.stdout);
  const smoke = paso('smoke 105 (rol de la app)', ejecutar('smoke.sql', 'daubert_hub_test_user'));
  log.push(smoke.stdout);
  paso('DOWN 105', ejecutar('down.sql'), /DOWN_OK/);
  paso('DOWN idempotente (segunda vez)', ejecutar('down.sql'), /DOWN_OK/);
  const volvio = sql("SELECT (SELECT qual FROM pg_policies WHERE policyname='pol_revisiones_sel') NOT LIKE '%BORRADOR%' AS politica_de_la_101_restaurada, (SELECT count(*) FROM pg_policy p WHERE obj_description(p.oid,'pg_policy') LIKE '105:%') = 0 AS sin_marcas_105");
  log.push(volvio.stdout);
  paso('UP 105 tras DOWN', ejecutar('up.sql'), /UP_OK manufactura 105/);
  const post2 = paso('postcheck 105 tras reaplicar', ejecutar('postcheck.sql', 'postgres', ['-v', 'huella_resto=' + huella]));
  log.push('postcheck (reaplicado) all_postchecks_pass = ' + ok(post2.stdout));
  paso('UP 105 no se reaplica', (() => { const r = ejecutar('up.sql'); return { ...r, status: r.status !== 0 && /ya está aplicada/.test(r.stderr) ? 0 : 1 }; })());
} finally { d(['rm', '-f', C]); }
console.log(log.join('\n'));
