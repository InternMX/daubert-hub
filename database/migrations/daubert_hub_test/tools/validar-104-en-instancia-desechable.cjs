// Validación del procedimiento 104 (101 + 102 → precheck → UP → postcheck → smoke → DOWN (con y sin datos) → UP → postcheck) en un contenedor DESECHABLE (127.0.0.1:55438). Nunca TEST/PROD.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const MIG = path.resolve(__dirname, '..');
const { INIT } = require(path.join(MIG, 'tools', 'instancia-desechable.cjs'));
const C = 'daubert-scratch-pg-104';
const d = (a) => spawnSync('docker', a, { encoding: 'utf8' });
const ejecutar = (archivo, usuario = 'postgres', extra = []) =>
  d(['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', archivo === 'init.sql' ? 'postgres' : 'daubert_hub_test', '-X', '-v', 'ON_ERROR_STOP=1', ...extra, '-f', '/tmp/' + archivo]);
const sql = (texto, usuario = 'postgres') => d(['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', 'daubert_hub_test', '-X', '-v', 'ON_ERROR_STOP=1', '-c', texto]);
const cp = (src, name) => d(['cp', src, C + ':/tmp/' + name]);
const P = '20261106_104_manufactura_cliente_abreviaturas_test';
const log = [];
const paso = (nombre, r, esperado) => { const ok = r.status === 0 && (!esperado || esperado.test(r.stdout + r.stderr)); log.push(`${ok ? 'OK   ' : 'FALLA'} ${nombre}`); if (!ok) log.push((r.stdout + r.stderr).split('\n').slice(-25).join('\n')); return r; };
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

d(['rm', '-f', C]);
const run = d(['run', '-d', '--rm', '--name', C, '-e', 'POSTGRES_PASSWORD=scratch', '-p', '127.0.0.1:55438:5432', 'postgres:18-alpine']);
if (run.status !== 0) { console.log(run.stderr); process.exit(1); }
try {
  for (let i = 0; i < 80; i++) { if (d(['exec', C, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; dormir(500); }
  dormir(1500);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v104-'));
  fs.writeFileSync(path.join(tmp, 'init.sql'), INIT);
  cp(path.join(tmp, 'init.sql'), 'init.sql');
  cp(path.join(MIG, '20261030_101_manufactura_gestor_documental_test.up.sql'), 'up101.sql');
  cp(path.join(MIG, '20261103_102_manufactura_responsables_firmas_test.up.sql'), 'up102.sql');
  for (const s of ['precheck', 'up', 'postcheck', 'smoke', 'down']) cp(path.join(MIG, `${P}.${s}.sql`), `${s}.sql`);
  paso('init réplica', ejecutar('init.sql'));
  paso('UP 101', ejecutar('up101.sql'), /UP_OK/);
  paso('UP 102', ejecutar('up102.sql'), /UP_OK manufactura 102/);
  const pre = paso('precheck 104', ejecutar('precheck.sql'));
  const huella = /huella_manufactura\s*\n-+\n\s*([0-9a-f]{32})/.exec(pre.stdout)?.[1];
  log.push('precheck: ' + pre.stdout.split('\n').filter((l) => /^\s*t\s*\||\| t\s*$|all_prechecks_pass/.test(l)).join(' ') + ' · huella_manufactura=' + huella);
  paso('UP 104', ejecutar('up.sql'), /UP_OK manufactura 104/);
  const post = paso('postcheck 104', ejecutar('postcheck.sql', 'postgres', ['-v', 'huella_manufactura=' + huella]));
  log.push('postcheck all_postchecks_pass = ' + (/all_postchecks_pass[\s\S]*\n[^\n]*\|\s*t\s*\n/.test(post.stdout) ? 'true' : 'REVISAR') + '\n' + post.stdout);
  sql("INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('CLIENTE', 'Cliente simulado 2'); INSERT INTO core.empresa_roles (empresa_id, rol) SELECT empresa_id, 'CLIENTE' FROM core.empresas WHERE nombre_comercial = 'Cliente simulado 2';");   // la réplica trae 1 cliente; TEST real tiene al menos 2
  const smoke = paso('smoke 104 (rol de la app)', ejecutar('smoke.sql', 'daubert_hub_test_user'));
  log.push(smoke.stdout);
  // DOWN con datos: debe rechazarse sin confirmación y proceder con ella.
  const ins = sql("SELECT set_config('app.user_id','1',false), set_config('app.user_email','admin1@example.invalid',false); INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, estado, origen) VALUES ('ZZD', 1, 'PROPUESTA', 'MANUAL_ADMIN');");
  log.push((ins.status === 0 ? 'OK   ' : 'FALLA') + ' fila de prueba insertada como ADMIN (instancia desechable)');
  const rechazo = ejecutar('down.sql');
  log.push((rechazo.status !== 0 && /hay 1 abreviaturas/.test(rechazo.stderr) ? 'OK   ' : 'FALLA') + ' DOWN con datos sin confirmación: rechazado');
  paso('DOWN con confirmación', ejecutar('down.sql', 'postgres', ['-v', 'confirmar_borrado=SI_BORRAR_ABREVIATURAS']), /DOWN_OK/);
  paso('DOWN idempotente (segunda vez)', ejecutar('down.sql'), /DOWN_OK/);
  const sinTabla = sql("SELECT to_regclass('manufactura.cliente_abreviaturas') IS NULL AS tabla_eliminada, (SELECT count(*) FROM pg_tables WHERE schemaname='manufactura') AS tablas, (SELECT count(*) FROM audit.cambios WHERE tabla='cliente_abreviaturas') AS auditoria_conservada;");
  log.push(sinTabla.stdout);
  paso('UP 104 tras DOWN', ejecutar('up.sql'), /UP_OK manufactura 104/);
  const post2 = paso('postcheck 104 tras reaplicar', ejecutar('postcheck.sql', 'postgres', ['-v', 'huella_manufactura=' + huella]));
  log.push('postcheck (reaplicado) all_postchecks_pass = ' + (/all_postchecks_pass[\s\S]*\n[^\n]*\|\s*t\s*\n/.test(post2.stdout) ? 'true' : 'REVISAR'));
  paso('UP 104 no se reaplica', (() => { const r = ejecutar('up.sql'); return { ...r, status: r.status !== 0 && /ya está aplicada/.test(r.stderr) ? 0 : 1 }; })());
} finally { d(['rm', '-f', C]); }
console.log(log.join('\n'));
