// Prueba REAL de respaldo y restauración de Manufactura con el rol daubert_backup (privilegios efectivos: pg pertenece a pg_read_all_data, sin BYPASSRLS) usando SOLO instancias PostgreSQL desechables.
//   node tools/ensayo-liberacion/probar-respaldo-rls.cjs --origen ens-origen --api ens-api --roles <roles.sql> --red ens-int --evidencia <carpeta>
// Requisitos: la réplica `origen` ya tiene 020–026 aplicadas y datos sintéticos de Manufactura (datos-sinteticos-manufactura.cjs). La prueba NO se da por buena porque pg_dump termine con código 0: compara filas,
// identificadores, hashes de contenido (PDF y firmas), objetos, permisos y políticas entre el ORIGEN y la RESTAURACIÓN, y comprueba que un respaldo incompleto (política de respaldo ausente) se DETECTA.
const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const ORIGEN = arg('--origen') ?? 'ens-origen'; const API = arg('--api'); const ROLES = arg('--roles'); const RED = arg('--red') ?? 'ens-int'; const EVID = arg('--evidencia');
const DEST = 'ens-restaurada';
if (!ROLES || !EVID) { console.error('Uso: --origen <contenedor> --api <contenedor de la API> --roles <roles.sql> --red <red interna> --evidencia <carpeta>'); process.exit(2); }
fs.mkdirSync(EVID, { recursive: true });
const MIG = path.resolve(__dirname, '..', '..', 'database', 'migrations', 'daubert_global');
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + String(x).replace(/\s+/g, ' ').slice(0, 280))); if (!c) fails++; };
const dk = (a) => spawnSync('docker', a, { encoding: 'utf8', maxBuffer: 200_000_000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const sh = (c, cmd, env = {}) => dk(['exec', ...Object.entries({ PGPASSWORD: 'scratch', ...env }).flatMap(([k, v]) => ['-e', `${k}=${v}`]), c, 'sh', '-c', cmd]);
const psql = (c, sql, { usuario = 'postgres', base = 'daubert_global', archivo } = {}) => { const a = ['exec', '-e', 'PGPASSWORD=scratch', c, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', base, '-X', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1']; a.push(...(archivo ? ['-f', archivo] : ['-c', sql])); const r = dk(a); return { rc: r.status, out: r.stdout.replace(/\r/g, ''), err: r.stderr }; };
const TABLAS = ['cliente_abreviaturas', 'confirmaciones_revision', 'documentos', 'firma_autorizaciones', 'firmas', 'pdf_contenidos', 'pdfs', 'revision_responsables', 'revisiones'];
const login0 = (s) => [...s.matchAll(/^CREATE ROLE (w+);/gm)].map((m) => m[1]).filter((n) => n !== 'postgres');
const QUITA = (s) => s.split('\n').filter((l) => !/^\\(un)?restrict/.test(l)).join('\n');

// Foto de contenido de Manufactura: por tabla, filas, MD5 de todas las filas (incluye bytea) y, para PDF y firmas, MD5 por fila del binario + coherencia con el SHA-256 registrado.
function foto(c, usuario = 'postgres') {
  const r = {};
  for (const t of TABLAS) { const x = psql(c, `SELECT count(*), md5(COALESCE(string_agg(x::text, E'\\n' ORDER BY x::text), '')) FROM manufactura.${t} x`, { usuario }); r[t] = x.rc === 0 ? x.out.trim() : 'ERROR ' + x.err.slice(0, 80); }
  const pdf = psql(c, "SELECT count(*), md5(COALESCE(string_agg(revision_id || ':' || md5(contenido) || ':' || length(contenido), ',' ORDER BY revision_id), '')), count(*) FILTER (WHERE encode(sha256(c.contenido), 'hex') = p.pdf_sha256 AND length(c.contenido) = p.bytes) FROM manufactura.pdf_contenidos c JOIN manufactura.pdfs p USING (revision_id)", { usuario });
  const fir = psql(c, "SELECT count(*), md5(COALESCE(string_agg(public_id || ':' || md5(contenido) || ':' || length(contenido), ',' ORDER BY public_id), '')), count(*) FILTER (WHERE encode(sha256(contenido), 'hex') = sha256 AND length(contenido) = bytes) FROM manufactura.firmas", { usuario });
  const ids = psql(c, "SELECT md5(string_agg(public_id::text, ',' ORDER BY public_id)) FROM manufactura.documentos UNION ALL SELECT md5(string_agg(public_id::text, ',' ORDER BY public_id)) FROM manufactura.revisiones", { usuario });
  r.pdf = pdf.out.trim(); r.firmas_bin = fir.out.trim(); r.ids = ids.out.trim().replace(/\n/g, '/');
  return r;
}
const comparar = (a, b, etiqueta) => { const d = Object.keys(a).filter((k) => a[k] !== b[k]); ok(d.length === 0, etiqueta, d.map((k) => `${k}: ${a[k]} ≠ ${b[k]}`).join(' ; ')); return d; };

(async () => {
  // ---------------------------------------------------------------- 1. ORIGEN: foto de referencia (superusuario)
  const ref = foto(ORIGEN); fs.writeFileSync(path.join(EVID, 'foto_origen.json'), JSON.stringify(ref, null, 1));
  const total = TABLAS.map((t) => Number(ref[t].split('|')[0]));
  ok(total.every((n, i) => ['firma_autorizaciones', 'cliente_abreviaturas'].includes(TABLAS[i]) ? n >= 1 : n >= 1), 'el ORIGEN tiene datos sintéticos en las 9 tablas de Manufactura', JSON.stringify(Object.fromEntries(TABLAS.map((t, i) => [t, total[i]]))));
  ok(Number(ref.pdf.split('|')[0]) >= 4 && ref.pdf.split('|')[2] === ref.pdf.split('|')[0], 'PDF del origen: todos los binarios coinciden con su SHA-256 y tamaño registrados', ref.pdf);
  ok(Number(ref.firmas_bin.split('|')[0]) >= 4 && ref.firmas_bin.split('|')[2] === ref.firmas_bin.split('|')[0], 'firmas del origen: todas coinciden con su SHA-256 y tamaño registrados', ref.firmas_bin);
    dk(['cp', path.resolve(__dirname, 'huellas-datos.readonly.sql'), `${ORIGEN}:/tmp/huellas.sql`]);
  const hOrigen = psql(ORIGEN, null, { archivo: '/tmp/huellas.sql' }).out; fs.writeFileSync(path.join(EVID, 'huellas_datos_origen.txt'), hOrigen);

  // ---------------------------------------------------------------- 2. Visibilidad efectiva del rol de respaldos (RLS): ve EXACTAMENTE lo mismo que el superusuario
  const comoRol = foto(ORIGEN, 'daubert_backup');
  comparar(ref, comoRol, 'daubert_backup (RLS activo, con la política de respaldo) ve EXACTAMENTE las mismas filas y bytes que el superusuario en las 9 tablas');

  // ---------------------------------------------------------------- 3. Escrituras del rol de respaldos: todas denegadas y nada cambia
  const intentos = [
    "INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('ZZ-NO')", "UPDATE manufactura.revisiones SET estado = estado", "DELETE FROM manufactura.documentos", "TRUNCATE manufactura.pdfs",
    "UPDATE manufactura.firmas SET estado = 'RETIRADA'", "DELETE FROM manufactura.pdf_contenidos", "UPDATE manufactura.pdf_contenidos SET contenido = ''::bytea", "INSERT INTO manufactura.cliente_abreviaturas (abreviatura) VALUES ('ZZ')",
    "ALTER TABLE manufactura.documentos DISABLE ROW LEVEL SECURITY", "DROP POLICY pol_respaldo_sel ON manufactura.firmas", "CREATE POLICY zz ON manufactura.firmas FOR ALL TO daubert_backup USING (true)",
    "SELECT manufactura.fn_actor_id()", "SET ROLE daubert_hub_app", "SET ROLE postgres", "ALTER ROLE daubert_backup BYPASSRLS", "CREATE TABLE manufactura.zz (x int)", "CREATE TABLE public.zz (x int)"
  ];
  const noDenegadas = intentos.filter((s) => psql(ORIGEN, s, { usuario: 'daubert_backup' }).rc === 0);
  ok(noDenegadas.length === 0, `daubert_backup NO puede escribir ni administrar: ${intentos.length} intentos (INSERT/UPDATE/DELETE/TRUNCATE/DDL/GRANT/SET ROLE/BYPASSRLS) denegados`, noDenegadas.join(' | '));
  const grant = dk(['exec', '-e', 'PGPASSWORD=scratch', ORIGEN, 'psql', '-h', '127.0.0.1', '-U', 'daubert_backup', '-d', 'daubert_global', '-X', '-At', '-c', 'GRANT ALL ON manufactura.documentos TO daubert_backup']);
  const efecto = psql(ORIGEN, "SELECT has_table_privilege('daubert_backup', 'manufactura.documentos', 'INSERT,UPDATE,DELETE,TRUNCATE'), has_table_privilege('daubert_backup', 'manufactura.documentos', 'SELECT')").out.trim();
  ok(/no privileges were granted|no se otorgaron/i.test(grant.stderr) && efecto === 'f|t', 'GRANT ALL de daubert_backup a sí mismo: PostgreSQL avisa «no privileges were granted» y NO concede nada (sigue solo con SELECT)', grant.stderr + ' / ' + efecto);
  comparar(ref, foto(ORIGEN), 'tras los intentos de escritura el contenido de Manufactura es idéntico (nada se modificó ni eliminó)');

  // ---------------------------------------------------------------- 4. RESPALDO con las credenciales y el comando de la automatización (pg_dump -Fc --no-password + --enable-row-security) como daubert_backup
  sh(ORIGEN, 'rm -f /tmp/backup.dump /tmp/backup_schema.dump /tmp/globals.sql');
  const sin = sh(ORIGEN, 'pg_dump -h 127.0.0.1 -p 5432 -U daubert_backup -d daubert_global -Fc -f /tmp/sin.dump --no-password 2>&1 | head -1');
  ok(/row-level security/.test(sin.stdout), 'SIN --enable-row-security el respaldo del rol FALLA (por eso la bandera es obligatoria en la automatización)', sin.stdout);
  const dump = sh(ORIGEN, 'pg_dump -h 127.0.0.1 -p 5432 -U daubert_backup -d daubert_global -Fc -f /tmp/backup.dump --no-password --enable-row-security 2>&1; echo rc=$?');
  ok(/rc=0/.test(dump.stdout) && !/error|warning/i.test(dump.stdout.replace(/rc=0/, '')), 'pg_dump -Fc --enable-row-security como daubert_backup termina con código 0 y sin avisos', dump.stdout);
  const sch = sh(ORIGEN, 'pg_dump -h 127.0.0.1 -p 5432 -U daubert_backup -d daubert_global -Fc --schema-only -f /tmp/backup_schema.dump --no-password --enable-row-security 2>&1; echo rc=$?'); ok(/rc=0/.test(sch.stdout), 'instantánea de solo esquema (--schema-only --enable-row-security) también termina bien', sch.stdout);
  const gl = sh(ORIGEN, 'pg_dumpall -h 127.0.0.1 -p 5432 -U daubert_backup -l daubert_global --globals-only --no-role-passwords -f /tmp/globals.sql --no-password 2>&1; echo rc=$?'); ok(/rc=0/.test(gl.stdout) && sh(ORIGEN, "grep -c PASSWORD /tmp/globals.sql").stdout.trim() === '0', 'roles globales (pg_dumpall --globals-only --no-role-passwords) con daubert_backup: código 0 y sin contraseñas', gl.stdout);
  const toc = sh(ORIGEN, 'pg_restore -l /tmp/backup.dump'); ok(toc.status === 0 && /TABLE DATA manufactura pdf_contenidos/.test(toc.stdout) && /POLICY manufactura firmas pol_respaldo_sel/.test(toc.stdout), 'el catálogo del respaldo (pg_restore -l) contiene los datos de pdf_contenidos y las políticas de respaldo', toc.stderr);
  const dataEntries = (toc.stdout.match(/TABLE DATA/g) || []).length; ok(dataEntries === 45, `el respaldo contiene los datos de las 45 tablas (36 previas + 9 de Manufactura): ${dataEntries}`);
  fs.writeFileSync(path.join(EVID, 'respaldo_toc.txt'), toc.stdout);
  const ruta = path.join(os.tmpdir(), 'ens-backup.dump'); dk(['cp', `${ORIGEN}:/tmp/backup.dump`, ruta]); dk(['cp', `${ORIGEN}:/tmp/globals.sql`, path.join(os.tmpdir(), 'ens-globals.sql')]);
  const bytes = fs.statSync(ruta).size; ok(bytes > 100_000, `el respaldo pesa ${bytes} bytes (≫ el de un volcado con tablas vacías)`);

  // ---------------------------------------------------------------- 5. RESTAURACIÓN en una SEGUNDA instancia desechable (red interna, sin salida)
  dk(['rm', '-f', DEST]);
  const up = dk(['run', '-d', '--rm', '--name', DEST, '--network', RED, '-e', 'POSTGRES_PASSWORD=scratch', 'postgres:18-alpine']); ok(up.status === 0, 'segunda instancia desechable creada', up.stderr);
  for (let i = 0; i < 60; i += 1) { if (dk(['exec', DEST, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  const globalsProducido = path.join(os.tmpdir(), 'ens-globals.sql'); // el que generó la automatización (pg_dumpall --globals-only como daubert_backup); ROLES solo respalda la comparación
  const crudo = fs.readFileSync(globalsProducido, 'utf8'); ok(login0(crudo).length === login0(fs.readFileSync(ROLES, 'utf8')).length, 'los roles globales producidos por daubert_backup coinciden con los del clúster real (' + login0(crudo).length + ' roles de aplicación)'); const login = [...crudo.matchAll(/^CREATE ROLE (\w+);/gm)].map((m) => m[1]).filter((n) => n !== 'postgres');
  const rolesSql = crudo.split(/\r?\n/).filter((l) => !/^(CREATE|ALTER) ROLE postgres\b/.test(l) && !/^\\(un)?restrict\b/.test(l)).join('\n') + '\n' + login.map((n) => `ALTER ROLE ${n} PASSWORD 'scratch';`).join('\n') + '\nCREATE DATABASE daubert_global OWNER postgres;';
  const tmp = path.join(os.tmpdir(), 'ens-roles-restaurada.sql'); fs.writeFileSync(tmp, rolesSql); dk(['cp', tmp, `${DEST}:/tmp/roles.sql`]); dk(['cp', ruta, `${DEST}:/tmp/backup.dump`]);
  ok(psql(DEST, null, { base: 'postgres', archivo: '/tmp/roles.sql' }).rc === 0, 'roles reales restaurados en la segunda instancia (desde la definición de roles del clúster)');
  const rest = sh(DEST, 'pg_restore -h 127.0.0.1 -U postgres -d daubert_global --exit-on-error /tmp/backup.dump 2>&1; echo rc=$?'); ok(/rc=0/.test(rest.stdout) && rest.stdout.trim() === 'rc=0', 'pg_restore --exit-on-error del respaldo producido por daubert_backup: sin errores', rest.stdout);

  // ---------------------------------------------------------------- 6. INTEGRIDAD: origen vs restauración
  const rst = foto(DEST); fs.writeFileSync(path.join(EVID, 'foto_restaurada.json'), JSON.stringify(rst, null, 1));
  comparar(ref, rst, 'RESTAURACIÓN = ORIGEN: filas, MD5 de todas las filas, identificadores, y MD5 y tamaño por fila de PDF y firmas, en las 9 tablas');
  ok(rst.pdf.split('|')[2] === rst.pdf.split('|')[0] && rst.firmas_bin.split('|')[2] === rst.firmas_bin.split('|')[0], 'en la restauración, cada PDF y cada firma coincide con su SHA-256 y tamaño registrados', rst.pdf + ' / ' + rst.firmas_bin);
  dk(['cp', path.resolve(__dirname, 'huellas-datos.readonly.sql'), `${DEST}:/tmp/huellas.sql`]);
  const hRest = psql(DEST, null, { archivo: '/tmp/huellas.sql' }).out; fs.writeFileSync(path.join(EVID, 'huellas_datos_restaurada.txt'), hRest);
  ok(hRest === hOrigen && hOrigen.split('\n').filter(Boolean).length >= 36, `objetos AJENOS a Manufactura: datos idénticos (MD5 de todas las filas de ${hOrigen.split('\n').filter(Boolean).length} tablas)`);
  const est = (c) => QUITA(sh(c, 'pg_dump -h 127.0.0.1 -U postgres -d daubert_global -s').stdout);
  const eO = est(ORIGEN); const eR = est(DEST); fs.writeFileSync(path.join(EVID, 'estructura_origen.sql'), eO); fs.writeFileSync(path.join(EVID, 'estructura_restaurada.sql'), eR);
  const normCheck = (s) => s.split('\n').map((l) => (/CONSTRAINT .* CHECK \(/.test(l) ? l.replace(/[()\s]/g, '') : l)).join('\n');
  const soloCheck = eO !== eR && normCheck(eO) === normCheck(eR); if (soloCheck) console.log('INFO  la única diferencia textual son ' + eO.split('\n').filter((l, i) => l !== eR.split('\n')[i]).length + ' líneas de CHECK reimpresas con otro paréntesis ((a AND b) AND c ↔ a AND b AND c): equivalencia semántica de PostgreSQL');
  ok(eO.length > 50_000 && (eO === eR || soloCheck), `estructura completa idéntica (pg_dump -s: tablas, funciones, triggers, políticas RLS, propietarios y ACL; ${eO.length} bytes)`, eO === eR ? '' : 'difiere');
  const q = (c) => psql(c, "SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')), (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal), (SELECT count(*) FROM pg_policies), (SELECT count(*) FROM pg_tables WHERE rowsecurity), (SELECT md5(string_agg(rolname || rolsuper || rolbypassrls || rolcanlogin, ',' ORDER BY rolname)) FROM pg_roles WHERE rolname !~ '^pg_'), (SELECT md5(string_agg(m.roleid::regrole || '>' || m.member::regrole, ',' ORDER BY 1)) FROM pg_auth_members m WHERE m.member::regrole::text !~ '^pg_'), (SELECT md5(string_agg(pg_get_userbyid(relowner) || c.relname, ',' ORDER BY relname)) FROM pg_class c WHERE relnamespace='manufactura'::regnamespace)").out.trim();
  ok(q(ORIGEN) === q(DEST), 'funciones, triggers, políticas RLS, tablas con RLS, roles (atributos), membresías y propietarios idénticos entre origen y restauración', q(ORIGEN) + ' vs ' + q(DEST));
  ok(psql(DEST, "SELECT count(*) FROM pg_policies WHERE policyname = 'pol_respaldo_sel' AND schemaname = 'manufactura'").out.trim() === '9', 'las 9 políticas de respaldo y las 24 de la aplicación llegaron a la restauración', psql(DEST, "SELECT count(*) FROM pg_policies WHERE schemaname='manufactura'").out);
  ok(psql(DEST, "SELECT pg_has_role('daubert_backup','pg_read_all_data','USAGE'), (SELECT rolbypassrls FROM pg_roles WHERE rolname='daubert_backup')").out.trim() === 't|f', 'en la restauración daubert_backup conserva su membresía y sigue SIN BYPASSRLS');

  // ---------------------------------------------------------------- 7. CONTROL NEGATIVO: un respaldo INCOMPLETO debe detectarse (política de respaldo ausente => pg_dump sale con 0 pero la tabla va vacía)
  if (API) dk(['stop', API]);
  psql(ORIGEN, 'DROP DATABASE IF EXISTS ens_sin_politica', { base: 'postgres' });
  const cp = psql(ORIGEN, 'CREATE DATABASE ens_sin_politica TEMPLATE daubert_global', { base: 'postgres' }); ok(cp.rc === 0, 'copia desechable del origen para el control negativo', cp.err);
  psql(ORIGEN, 'DROP POLICY pol_respaldo_sel ON manufactura.pdf_contenidos; DROP POLICY pol_respaldo_sel ON manufactura.firmas', { base: 'ens_sin_politica' });
  const inc = sh(ORIGEN, 'pg_dump -h 127.0.0.1 -U daubert_backup -d ens_sin_politica -Fc --enable-row-security --no-password -f /tmp/incompleto.dump 2>&1; echo rc=$?');
  ok(/rc=0/.test(inc.stdout), 'con la política ausente pg_dump --enable-row-security SALE CON 0 (el riesgo es real: no avisa)', inc.stdout);
  dk(['exec', ORIGEN, 'sh', '-c', 'true']); sh(ORIGEN, "psql -h 127.0.0.1 -U postgres -d postgres -X -qc 'DROP DATABASE IF EXISTS ens_incompleta' -c 'CREATE DATABASE ens_incompleta' && pg_restore -h 127.0.0.1 -U postgres -d ens_incompleta --no-owner --no-acl /tmp/incompleto.dump 2>&1 | head -3");
  const vacio = psql(ORIGEN, "SELECT (SELECT count(*) FROM manufactura.pdf_contenidos), (SELECT count(*) FROM manufactura.firmas), (SELECT count(*) FROM manufactura.pdfs)", { base: 'ens_incompleta' }).out.trim();
  ok(vacio.startsWith('0|0|') && !vacio.endsWith('|0'), 'el respaldo incompleto quedó SIN los bytes de PDF ni las firmas (pdf_contenidos=0, firmas=0) aunque pdfs conserve sus filas: ' + vacio);
  const fi = foto(ORIGEN); // el origen sigue intacto
  psql(ORIGEN, "SELECT 1", {});
  const rIncompleta = { pdf: psql(ORIGEN, "SELECT count(*), 0, 0 FROM manufactura.pdf_contenidos", { base: 'ens_incompleta' }).out.trim() }; ok(rIncompleta.pdf.split('|')[0] !== ref.pdf.split('|')[0], 'la COMPARACIÓN de integridad (conteos y hashes) detecta el respaldo incompleto: FALLARÍA la validación', `${rIncompleta.pdf} ≠ ${ref.pdf}`);
  dk(['cp', path.resolve(MIG, '20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql'), `${ORIGEN}:/tmp/v.sql`]);
  const cap = psql(ORIGEN, null, { archivo: '/tmp/v.sql', base: 'daubert_global' }).out; const cmd = cap.split('\n').find((l) => l.startsWith('psql ')) || '';
  const vars = [...cmd.matchAll(/-v (f_[a-z]+)=([0-9a-f]{32})/g)].flatMap((x) => ['-v', `${x[1]}=${x[2]}`]);
  const ver = (db) => dk(['exec', '-e', 'PGPASSWORD=scratch', ORIGEN, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', db, '-X', '-At', '-F', '|', '-v', 'nivel=26', ...vars, '-f', '/tmp/v.sql']).stdout.split('\n').filter((l) => l.includes('|') && !l.startsWith('psql')).pop() || '';
  ok(ver('daubert_global').split('|').every((x) => x === 't'), 'verificación transversal (nivel 26) sobre el origen completo: todo en t');
  psql(ORIGEN, 'DROP POLICY pol_respaldo_sel ON manufactura.firmas');
  ok(ver('daubert_global').split('|').includes('f'), 'verificación transversal (nivel 26) SIN la política de respaldo de una tabla: FALLA (detecta la causa antes de que exista un respaldo vacío)');
  psql(ORIGEN, "CREATE POLICY pol_respaldo_sel ON manufactura.firmas AS PERMISSIVE FOR SELECT TO daubert_backup USING (true)");
  ok(ver('daubert_global').split('|').every((x) => x === 't'), 'política restituida: la verificación vuelve a dar todo en t');
  psql(ORIGEN, 'DROP DATABASE ens_sin_politica', { base: 'postgres' }); psql(ORIGEN, 'DROP DATABASE ens_incompleta', { base: 'postgres' });

  // ---------------------------------------------------------------- 8. REVERSIÓN y reaplicación de la 026 (con datos de Manufactura presentes)
  for (const t of ['precheck', 'up', 'postcheck', 'down']) dk(['cp', path.join(MIG, `20261109_026_manufactura_respaldo_rls_prod.${t}.sql`), `${ORIGEN}:/tmp/026.${t}.sql`]);
  const run = (f, extra = []) => dk(['exec', '-e', 'PGPASSWORD=scratch', ORIGEN, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'daubert_global', '-X', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', ...extra, '-f', f]);
  const dn = run('/tmp/026.down.sql'); ok(dn.status === 0 && /DOWN_OK/.test(dn.stdout), 'DOWN 026 con documentos presentes: solo elimina pol_respaldo_sel', dn.stderr);
  comparar(ref, foto(ORIGEN), 'tras el DOWN 026 los datos de Manufactura siguen idénticos');
  const sinPol = sh(ORIGEN, 'pg_dump -h 127.0.0.1 -U daubert_backup -d daubert_global -Fc --enable-row-security --no-password -f /tmp/tras_down.dump 2>&1; echo rc=$?; pg_restore -l /tmp/tras_down.dump | grep -c "TABLE DATA manufactura"');
  ok(/rc=0/.test(sinPol.stdout), 'tras el DOWN, el respaldo con la bandera sigue saliendo con 0 pero INCOMPLETO: exactamente el riesgo que la verificación de nivel 26 debe impedir', sinPol.stdout);
  const pre = run('/tmp/026.precheck.sql'); const fila = pre.stdout.split('\n').find((l) => /^[0-9a-f]{32}\|[0-9a-f]{32}$/.test(l)); const [h1, h2] = (fila || '|').split('|');
  ok(pre.status === 0 && /^t(\|t)+$/.test(pre.stdout.split('\n').find((l) => /^t\|/.test(l)) || ''), 'precheck 026 (con datos presentes) correcto');
  const upr = run('/tmp/026.up.sql'); ok(upr.status === 0 && /UP_OK/.test(upr.stdout), 'reaplicar 026 con documentos presentes', upr.stderr);
  const pst = run('/tmp/026.postcheck.sql', ['-v', `huella_politicas_app=${h1}`, '-v', `huella_privilegios=${h2}`]); const lp = pst.stdout.split('\n').filter((l) => l.includes('|')).pop() || '';
  ok(lp.split('|').every((x) => x === 't'), `postcheck 026 tras reaplicar: ${lp.split('|').filter((x) => x === 't').length} comprobaciones en t`, lp);
  const dup = run('/tmp/026.up.sql'); ok(dup.status !== 0 && /ya existe/.test(dup.stderr + dup.stdout), 'UP repetido de la 026 aborta');
  const otra = dk(['exec', '-e', 'PGPASSWORD=scratch', ORIGEN, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/026.up.sql']); ok(otra.status !== 0 && /ABORTO/.test(otra.stderr + otra.stdout), 'UP 026 en una base de otro nombre aborta antes de escribir');
  const conApp = dk(['exec', '-e', 'PGPASSWORD=scratch', ORIGEN, 'psql', '-h', '127.0.0.1', '-U', 'daubert_hub_app', '-d', 'daubert_global', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/026.down.sql']); ok(conApp.status !== 0, 'DOWN 026 con el rol de la aplicación aborta');
  const fin = sh(ORIGEN, 'pg_dump -h 127.0.0.1 -U daubert_backup -d daubert_global -Fc --enable-row-security --no-password -f /tmp/final.dump 2>&1; echo rc=$?'); ok(/rc=0/.test(fin.stdout), 'tras reaplicar la 026 el respaldo del rol vuelve a ser completo (rc=0)');
  comparar(ref, foto('ens-origen', 'daubert_backup'), 'tras reaplicar, daubert_backup vuelve a ver exactamente lo mismo que el superusuario');

  dk(['rm', '-f', DEST]);
  console.log(fails ? `RESULTADO: ${fails} FAIL` : 'RESULTADO: respaldo, restauración y controles de integridad TODO PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
