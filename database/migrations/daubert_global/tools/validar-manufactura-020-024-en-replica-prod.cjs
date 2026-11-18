#!/usr/bin/env node
// VALIDACIÓN de las migraciones PRODUCTIVAS de Manufactura 020–024 en una RÉPLICA DESECHABLE con la ESTRUCTURA REAL DE PRODUCCIÓN (nunca TEST, nunca daubert_global real).
//   node database/migrations/daubert_global/tools/validar-manufactura-020-024-en-replica-prod.cjs --dump <respaldo pg_dump -F c de daubert_global> [--estructura-prod <estructura_PROD.txt>]
//
// La réplica se construye con `pg_restore --schema-only` de un respaldo REAL de daubert_global (sin datos: solo estructura, ACL y funciones), con los roles del clúster reales (daubert_hub_app,
// n8n_app, n8n_cat_prod, daubert_docs_ro, daubert_hub_test_user, …) y sus atributos. Los usuarios y clientes que usan los smoke son SINTÉTICOS y viven solo en el contenedor (marcados con el esquema
// replica_desechable); los scripts de replica_only/ se niegan a correr sin esa marca. El contenedor se elimina al terminar.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const MIG = path.resolve(__dirname, '..');
// --contenedor <nombre> y --red <red interna> (solo con --con-datos): permiten dejar la réplica en una red Docker INTERNA (sin salida a internet) para ensayos con la API; por omisión: sin red.
const argv1 = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const C = argv1('--contenedor') ?? 'daubert-scratch-pg-prod-replica';
const PUERTO = 55447;
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const DUMP = arg('--dump');
const ESTRUCTURA_PROD = arg('--estructura-prod');
// --con-datos: el respaldo se restaura COMPLETO (con los datos reales) y NO se siembran datos sintéticos ni se ejecutan los smoke con escrituras (usan los usuarios sintéticos 1-5, que aquí serían reales).
// Solo para la réplica DESECHABLE del ensayo de liberación. Sin la bandera el comportamiento es el de siempre (estructura + datos sintéticos).
const CON_DATOS = process.argv.includes('--con-datos');
// Solo con --con-datos: --roles <roles.sql> usa la definición REAL de los roles del clúster (pg_dumpall --globals-only --no-role-passwords) en lugar de la lista incrustada;
// --mantener deja la instancia desechable en pie al terminar (para inspeccionarla); --evidencia <carpeta> copia ahí las huellas y diferencias de antes/después.
// En este modo la instancia NO tiene red ni puertos publicados: nada puede salir de ella ni conectarse a ella desde fuera del contenedor.
const ROLES_FILE = arg('--roles'); const MANTENER = process.argv.includes('--mantener'); const EVIDENCIA = arg('--evidencia');
const HUELLAS_DATOS = path.resolve(__dirname, '..', '..', '..', '..', 'tools', 'ensayo-liberacion', 'huellas-datos.readonly.sql');
const DUMP_ESTRUCTURA = (destino, filtro) => "pg_dump -h 127.0.0.1 -U postgres -d daubert_global -s " + filtro + " | grep -vE '^.(un)?restrict' > " + destino;
if (!DUMP || !fs.existsSync(DUMP)) { console.error('Uso: --dump <respaldo pg_dump -F c de daubert_global> [--estructura-prod estructura_PROD.txt]'); process.exit(2); }

const MIGRACIONES = [
  { n: 20, base: '20261108_020_manufactura_gestor_documental_prod', params: 'baseline' },
  { n: 21, base: '20261108_021_manufactura_responsables_firmas_prod', params: 'huella_101' },
  { n: 22, base: '20261108_022_manufactura_inventario_firmas_admin_prod', params: 'huella_manufactura' },
  { n: 23, base: '20261108_023_manufactura_cliente_abreviaturas_prod', params: 'huella_manufactura' },
  { n: 24, base: '20261108_024_manufactura_consulta_compartida_borradores_prod', params: 'huella_resto' },
  { n: 26, base: '20261109_026_manufactura_respaldo_rls_prod', params: 'dos_huellas', sinSmoke: true }   // 025 reservada por otra rama (Caterpillar)
];
const NIVEL_FINAL = 26;
const VERIFICAR = '20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql';
const SMOKE_RO = '20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql';
const RES = [];
const registrar = (ok, prueba, detalle = '') => { RES.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'}  ${prueba}${detalle ? ' — ' + String(detalle).slice(0, 300) : ''}`); };
const docker = (args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 50_000_000 });
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const cp = (src, dst) => docker(['cp', src, `${C}:/tmp/${dst}`]);
function psql({ archivo, sql, usuario = 'postgres', base = 'daubert_global', vars = {}, tuplas = false }) {
  const a = ['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', base, '-X', '-v', 'ON_ERROR_STOP=1'];
  if (tuplas) a.push('-At', '-F', '|');
  for (const [k, v] of Object.entries(vars)) a.push('-v', `${k}=${v}`);
  if (archivo) a.push('-f', `/tmp/${archivo}`); else a.push('-c', sql);
  const r = docker(a);
  return { codigo: r.status, salida: `${r.stdout}\n${r.stderr}`, out: r.stdout };
}
const sube = (archivo, destino = archivo) => cp(path.join(MIG, archivo), destino);
const TODO_OK = (salida) => { const f = salida.split('\n').filter((l) => l.includes('|') && !l.startsWith('psql')).pop() ?? ''; const v = f.split('|'); return v.length > 1 && v.every((x) => x === 't'); };

function levantar() {
  docker(['rm', '-f', C]);
  const r = docker(['run', '-d', '--rm', '--name', C, '-e', 'POSTGRES_PASSWORD=scratch', ...(CON_DATOS ? ['--network', argv1('--red') ?? 'none'] : ['-p', `127.0.0.1:${PUERTO}:5432`]), 'postgres:18-alpine']);
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  for (let i = 0; i < 80; i += 1) { if (docker(['exec', C, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; dormir(500); }
  dormir(1500);
}

let antesDatos = '';
function construirReplica() {
  let roles = `
CREATE ROLE daubert_hub_app LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE daubert_hub_test_user LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE n8n_app LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE n8n_cat_prod LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE n8n_cat_test LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 5;
CREATE ROLE n8n_app_test LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE daubert_docs_ro LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE daubert_backup LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 2;
GRANT pg_read_all_data TO daubert_backup;
ALTER ROLE daubert_docs_ro SET default_transaction_read_only = on; ALTER ROLE daubert_docs_ro SET statement_timeout = '30s'; ALTER ROLE daubert_docs_ro SET lock_timeout = '5s';
ALTER ROLE n8n_app_test SET statement_timeout = '60s';
CREATE DATABASE daubert_global OWNER postgres;
CREATE DATABASE otra_base OWNER postgres;`;
  if (CON_DATOS && ROLES_FILE) {
    const crudo = fs.readFileSync(ROLES_FILE, 'utf8');
    const lineas = crudo.split(/\r?\n/).filter((l) => !/^(CREATE|ALTER) ROLE postgres\b/.test(l) && !/^\\(un)?restrict\b/.test(l));
    const login = [...crudo.matchAll(/^CREATE ROLE (\w+);/gm)].map((m) => m[1]).filter((n) => n !== 'postgres');
    roles = lineas.join('\n') + '\n' + login.map((n) => "ALTER ROLE " + n + " PASSWORD 'scratch';").join('\n') + '\nCREATE DATABASE daubert_global OWNER postgres;\nCREATE DATABASE otra_base OWNER postgres;';
    console.log('INFO  roles REALES del clúster (' + login.length + ' roles de aplicación; contraseñas desechables; sin el rol postgres del contenedor)');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replica-prod-'));
  fs.writeFileSync(path.join(tmp, 'roles.sql'), roles);
  cp(path.join(tmp, 'roles.sql'), 'roles.sql'); cp(DUMP, 'prod.dump');
  registrar(psql({ archivo: 'roles.sql', base: 'postgres' }).codigo === 0, 'roles reales del clúster creados (daubert_hub_app, n8n_app, n8n_cat_prod, daubert_docs_ro, daubert_hub_test_user, …)');
  const rs = docker(['exec', '-e', 'PGPASSWORD=scratch', C, 'pg_restore', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'daubert_global', ...(CON_DATOS ? [] : ['--schema-only']), '--exit-on-error', '/tmp/prod.dump']);
  registrar(rs.status === 0, 'estructura REAL de PROD restaurada (pg_restore --schema-only del respaldo): esquemas, tablas, funciones, triggers y ACL', rs.stderr);
  // Marca de réplica + datos SINTÉTICOS (solo para los smoke con escritura; nunca existen en PROD).
  const seed = `
CREATE SCHEMA replica_desechable; CREATE TABLE replica_desechable.marca (x int); COMMENT ON SCHEMA replica_desechable IS 'Marca: instancia desechable con datos sintéticos';
INSERT INTO security.users (user_id, display_name, email, password_hash, role, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Admin Uno', 'admin1@example.invalid', 'x', 'ADMIN', 'ACTIVE'), (2, 'General Dos', 'g2@example.invalid', 'x', 'GENERAL', 'ACTIVE'), (3, 'General Tres', 'g3@example.invalid', 'x', 'GENERAL', 'ACTIVE'),
  (4, 'Inactivo Cuatro', 'g4@example.invalid', 'x', 'GENERAL', 'INACTIVE'), (5, 'Admin Cinco', 'admin5@example.invalid', 'x', 'ADMIN', 'ACTIVE');
INSERT INTO core.empresas (empresa_id, tipo_empresa, nombre_comercial) OVERRIDING SYSTEM VALUE VALUES (1, 'CLIENTE', 'Cliente sintético 1'), (2, 'CLIENTE', 'Cliente sintético 2'), (3, 'PROVEEDOR', 'Proveedor sintético');
INSERT INTO core.empresa_roles (empresa_id, rol) VALUES (1, 'CLIENTE'), (2, 'CLIENTE'), (3, 'PROVEEDOR');`;
  if (CON_DATOS) {                                                         // réplica con datos reales: sin siembra sintética; se toman las huellas ANTES de migrar
    cp(HUELLAS_DATOS, 'huellas.sql');
    antesDatos = psql({ archivo: 'huellas.sql', tuplas: true }).out;
    docker(['exec', '-e', 'PGPASSWORD=scratch', C, 'sh', '-c', DUMP_ESTRUCTURA('/tmp/estructura_antes.sql', '--exclude-schema=manufactura')]);
    const n = antesDatos.split('\n').filter(Boolean).length;
    registrar(n > 10, 'huellas de datos ANTES de migrar (' + n + ' tablas) y estructura completa guardadas');
    return;
  }
  fs.writeFileSync(path.join(tmp, 'seed.sql'), seed); cp(path.join(tmp, 'seed.sql'), 'seed.sql');
  const sd = psql({ archivo: 'seed.sql' });
  registrar(sd.codigo === 0, 'datos SINTÉTICOS de réplica (5 usuarios, 3 empresas) y marca replica_desechable', sd.salida.slice(-200));
}

function aplicarMigracion(m, { verificar = true } = {}) {
  const f = (t) => `${m.base}.${t}.sql`;
  for (const t of ['precheck', 'up', 'postcheck', 'down']) sube(f(t), `${m.n}.${t}.sql`);
  const pre = psql({ archivo: `${m.n}.precheck.sql`, tuplas: true });
  const lineas = pre.out.split('\n').filter(Boolean);
  const hayT = lineas.some((l) => l === 't' || l.split('|').includes('t'));
  const hayF = lineas.some((l) => l === 'f' || l.split('|').includes('f'));
  registrar(pre.codigo === 0 && hayT && !hayF, `${m.n}: precheck correcto (todas las comprobaciones en t)`, hayF ? pre.salida.slice(-600) : '');
  let vars = {};
  if (m.params === 'baseline') {
    const fila = lineas.filter((l) => l.includes('|')).pop().split('|');
    const NOMBRES = ['baseline_users', 'baseline_empresas', 'baseline_audit_cambios', 'baseline_tablas_fp', 'baseline_funciones_fp', 'baseline_columnas_fp', 'baseline_triggers_fp', 'baseline_privilegios_fp', 'baseline_roles_fp', 'baseline_acl_bases_fp', 'baseline_esquemas_acl_fp'];
    registrar(fila.length === NOMBRES.length && fila.every((v) => v !== ''), `${m.n}: el precheck imprime la línea base (${NOMBRES.length} valores)`);
    vars = Object.fromEntries(NOMBRES.map((k, i) => [k, fila[i]]));
  } else if (m.params === 'dos_huellas') {
    const fila = lineas.find((l) => /^[0-9a-f]{32}\|[0-9a-f]{32}$/.test(l));
    registrar(Boolean(fila), `${m.n}: el precheck imprime las dos huellas (políticas de la aplicación y privilegios)`);
    const [a, b] = (fila ?? '|').split('|'); vars = { huella_politicas_app: a, huella_privilegios: b };
  } else {
    const h = lineas.find((l) => /^[0-9a-f]{32}$/.test(l));
    registrar(Boolean(h), `${m.n}: el precheck imprime la huella (${m.params})`);
    vars = { [m.params]: h };
  }
  const up = psql({ archivo: `${m.n}.up.sql` });
  registrar(up.codigo === 0 && /UP_OK/.test(up.salida) && /COMMIT/.test(up.salida), `${m.n}: UP aplicado`, up.codigo === 0 ? '' : up.salida.slice(-400));
  const post = psql({ archivo: `${m.n}.postcheck.sql`, tuplas: true, vars });
  const filaPost = post.out.split('\n').filter((l) => l.includes('|')).pop() ?? '';
  registrar(post.codigo === 0 && TODO_OK(post.out), `${m.n}: postcheck con todas las comprobaciones en t`, `${filaPost.split('|').filter((v) => v === 't').length} t / ${filaPost.split('|').filter((v) => v === 'f').length} f`);
  return vars;
}

function verificar(comando, nivel, etiqueta) {
  const r = psql({ archivo: VERIFICAR, tuplas: true, vars: { ...comando, nivel: String(nivel) } });
  const fila = r.out.split('\n').filter((l) => l.includes('|')).pop() ?? '';
  const v = fila.split('|');
  registrar(r.codigo === 0 && v.length > 5 && v.every((x) => x === 't'), `${etiqueta}: nada fuera de Manufactura cambió + matriz de privilegios exacta (${v.filter((x) => x === 't').length} comprobaciones en t)`, v.every((x) => x === 't') ? '' : r.salida.slice(-300));
  return fila;
}

function main() {
  console.log('== Validación 020–024 en réplica DESECHABLE con la estructura real de PRODUCCIÓN ==');
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) { console.error('Docker no está disponible.'); process.exit(2); }
  levantar();
  try {
    construirReplica();
    for (const a of [VERIFICAR, SMOKE_RO]) sube(a);
    for (const m of MIGRACIONES) { if (!m.sinSmoke) sube(`replica_only/${m.base}.smoke_replica.sql`, `${m.n}.smoke.sql`); }

    // ---- fidelidad de la réplica frente al inventario real de PROD (informativo)
    if (ESTRUCTURA_PROD && fs.existsSync(ESTRUCTURA_PROD)) {
      cp(path.resolve(MIG, '..', '..', 'maintenance', 'daubert_global', 'estructura_items.readonly.sql'), 'est.sql');
      const rep = psql({ archivo: 'est.sql', tuplas: true });
      const norm = (t) => new Set(t.replace(/^﻿/, '').split(/\r?\n/).filter((l) => /^(REL|COL|CON|IDX|FN|TRG|VIEW|POL)\s/.test(l)));
      const real = norm(fs.readFileSync(ESTRUCTURA_PROD, 'utf8')); const mia = norm(rep.out);
      const soloReal = [...real].filter((x) => !mia.has(x)); const soloMia = [...mia].filter((x) => !real.has(x));
      console.log(`INFO  fidelidad: la réplica tiene ${mia.size} objetos; el inventario real de PROD (${path.basename(ESTRUCTURA_PROD)}) ${real.size}. Diferencias: ${soloReal.length} objetos que PROD tiene hoy y el respaldo no (cambios posteriores al respaldo), ${soloMia.length} que el respaldo tiene y PROD ya no/cambió.`);
      console.log('INFO  (los objetos nuevos son de Caterpillar/Notificaciones de Pago; Manufactura solo depende de security.users, core.empresas, core.empresa_roles y audit.cambios, que coinciden):');
      const dep = (x) => /security\.users|core\.empresas |core\.empresa_roles|audit\.cambios/.test(x);
      registrar(soloReal.filter(dep).length === 0 && soloMia.filter(dep).length === 0, 'las 4 dependencias de Manufactura (security.users, core.empresas, core.empresa_roles, audit.cambios) son IDÉNTICAS entre la réplica y el inventario real de PROD');
    }

    // ---- línea base ANTES de cualquier migración
    const cap = psql({ archivo: VERIFICAR, tuplas: true });
    const cmd = cap.out.split('\n').find((l) => l.startsWith('psql '));
    registrar(cap.codigo === 0 && cmd, 'línea base capturada antes de la 020 (solo lectura)', cmd ? '' : cap.salida.slice(-700));
    if (!cmd) throw new Error('sin línea base');
    const base = Object.fromEntries([...cmd.matchAll(/-v (f_[a-z]+)=([0-9a-f]{32})/g)].map((x) => [x[1], x[2]]));
    registrar(Object.keys(base).length === 14, 'la línea base tiene las 14 huellas', Object.keys(base).length);

    // ---- 020 → 024 con verificación transversal y smoke con escrituras (rol daubert_hub_app) en cada paso
    const baseline = {};
    for (const m of MIGRACIONES) {
      const vars = aplicarMigracion(m);
      baseline[m.n] = vars;
      verificar(base, m.n, `tras la ${m.n}`);
      // Pruebas de seguridad CON ESCRITURAS como daubert_hub_app (solo réplica; cada script termina en ROLLBACK y comprueba que no dejó residuos). Cada smoke valida la semántica de SU nivel.
      if (CON_DATOS || m.sinSmoke) continue;                                 // los smoke con escrituras usan usuarios sintéticos: no se ejecutan con datos reales
      const sm = psql({ archivo: `${m.n}.smoke.sql`, usuario: 'daubert_hub_app', tuplas: true });
      const ls = sm.out.split('\n').filter((x) => /^\d+\|/.test(x));
      const fallos = ls.filter((x) => x.endsWith('|f'));
      registrar(sm.codigo === 0 && ls.length > 0 && fallos.length === 0, `${m.n}: smoke con escrituras como daubert_hub_app: ${ls.length} pruebas (RLS, triggers, inmutabilidad, permisos)`, fallos.join(' / ') || (sm.codigo ? sm.salida.slice(-300) : ''));
    }
    const smokeRO = psql({ archivo: SMOKE_RO, tuplas: true });
    const lineas = smokeRO.out.split('\n').filter((l) => /^\d+\|/.test(l));
    registrar(smokeRO.codigo === 0 && lineas.length > 10 && lineas.every((l) => l.endsWith('|t')), `smoke de SOLO LECTURA (el que se ejecutará en PROD): ${lineas.length} pruebas con los roles reales`, lineas.filter((l) => l.endsWith('|f')).join(' / ') || smokeRO.salida.slice(-500));

    // ---- los controles DETECTAN violaciones (se provocan y se revierten)
    psql({ sql: 'GRANT SELECT ON manufactura.documentos TO n8n_app' });
    const v1 = psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } });
    registrar(!TODO_OK(v1.out), 'DETECCIÓN: si n8n_app recibiera SELECT en manufactura, la verificación FALLA');
    psql({ sql: 'REVOKE SELECT ON manufactura.documentos FROM n8n_app' });
    psql({ sql: 'GRANT SELECT ON manufactura.firmas TO PUBLIC' });
    registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } }).out), 'DETECCIÓN: si PUBLIC recibiera SELECT en manufactura.firmas, la verificación FALLA');
    psql({ sql: 'REVOKE SELECT ON manufactura.firmas FROM PUBLIC' });
    psql({ sql: 'GRANT DELETE ON manufactura.documentos TO daubert_hub_app' });
    registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } }).out), 'DETECCIÓN: si daubert_hub_app recibiera DELETE en documentos, la verificación FALLA');
    psql({ sql: 'REVOKE DELETE ON manufactura.documentos FROM daubert_hub_app' });
    psql({ sql: 'GRANT SELECT ON core.empresas TO n8n_cat_prod' });
    registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } }).out), 'DETECCIÓN: si cambiara un privilegio FUERA de manufactura (core.empresas), la verificación FALLA');
    psql({ sql: 'REVOKE SELECT ON core.empresas FROM n8n_cat_prod' });
    {
    // ---- daubert_backup: lector autorizado (decisión A, 2026-11-09). Debe LEER por pertenencia a pg_read_all_data y NO tener ningún privilegio de escritura/administración; cada desviación se provoca y se detecta.
    const detecta = (sqlProvoca, sqlRevierte, etiqueta) => {
      psql({ sql: sqlProvoca });
      registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } }).out), 'DETECCIÓN (daubert_backup): ' + etiqueta);
      psql({ sql: sqlRevierte });
    };
    detecta('GRANT INSERT ON manufactura.documentos TO daubert_backup', 'REVOKE INSERT ON manufactura.documentos FROM daubert_backup', 'si recibiera INSERT en manufactura, la verificación FALLA');
    detecta('GRANT UPDATE (estado) ON manufactura.firmas TO daubert_backup', 'REVOKE UPDATE (estado) ON manufactura.firmas FROM daubert_backup', 'si recibiera UPDATE de columna en manufactura.firmas, la verificación FALLA');
    detecta('GRANT TRUNCATE ON manufactura.revisiones TO daubert_backup', 'REVOKE TRUNCATE ON manufactura.revisiones FROM daubert_backup', 'si recibiera TRUNCATE, la verificación FALLA');
    detecta('GRANT pg_write_all_data TO daubert_backup', 'REVOKE pg_write_all_data FROM daubert_backup', 'si heredara pg_write_all_data (escritura por membresía), la verificación FALLA');
    detecta('GRANT n8n_app TO daubert_backup', 'REVOKE n8n_app FROM daubert_backup', 'si heredara otro rol (membresía extra), la verificación FALLA');
    detecta('ALTER ROLE daubert_backup BYPASSRLS', 'ALTER ROLE daubert_backup NOBYPASSRLS', 'si tuviera BYPASSRLS, la verificación FALLA');
    detecta('ALTER ROLE daubert_backup CREATEROLE', 'ALTER ROLE daubert_backup NOCREATEROLE', 'si tuviera CREATEROLE (administración), la verificación FALLA');
    detecta('GRANT CREATE ON SCHEMA manufactura TO daubert_backup', 'REVOKE CREATE ON SCHEMA manufactura FROM daubert_backup', 'si pudiera crear objetos en manufactura, la verificación FALLA');
    detecta('GRANT EXECUTE ON FUNCTION manufactura.fn_inmutable() TO daubert_backup', 'REVOKE EXECUTE ON FUNCTION manufactura.fn_inmutable() FROM daubert_backup', 'si pudiera ejecutar funciones de manufactura, la verificación FALLA');
    detecta('GRANT SELECT ON manufactura.firmas TO daubert_backup', 'REVOKE SELECT ON manufactura.firmas FROM daubert_backup', 'si tuviera una ACL explícita (el acceso debe ser solo por la membresía), la verificación FALLA');
    // Estado real del rol (premisa de la decisión) y efectividad: lee, no escribe.
    const rolB = psql({ tuplas: true, sql: "SELECT (SELECT count(*) FROM pg_roles WHERE rolname = 'daubert_backup'), pg_has_role('daubert_backup', 'pg_read_all_data', 'USAGE'), has_table_privilege('daubert_backup', 'manufactura.firmas', 'SELECT'), has_schema_privilege('daubert_backup', 'manufactura', 'USAGE'), has_table_privilege('daubert_backup', 'manufactura.documentos', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'), (SELECT rolbypassrls OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication FROM pg_roles WHERE rolname = 'daubert_backup')" }).out.trim();
    if (ROLES_FILE) registrar(rolB === '1|t|t|t|f|f', 'daubert_backup (rol REAL): miembro de pg_read_all_data, LEE manufactura (firmas incluidas), sin privilegios de escritura/administración', rolB);
    {
      // Respaldo REAL con el rol daubert_backup (la 026 le da políticas de lectura; el acceso por pertenencia a pg_read_all_data no salta RLS).
      const sinBandera = docker(['exec', '-e', 'PGPASSWORD=scratch', C, 'sh', '-c', 'pg_dump -h 127.0.0.1 -U daubert_backup -d daubert_global -Fc -f /tmp/backup_sin_bandera.dump 2>&1 | head -1']);
      registrar(/row-level security/.test(sinBandera.stdout), 'pg_dump como daubert_backup SIN --enable-row-security sigue fallando por RLS (la bandera es obligatoria en el respaldo automático)', sinBandera.stdout.slice(0, 160));
      const conBandera = docker(['exec', '-e', 'PGPASSWORD=scratch', C, 'sh', '-c', 'pg_dump -h 127.0.0.1 -U daubert_backup -d daubert_global -Fc --enable-row-security --no-password -f /tmp/backup_rol.dump 2>&1; echo rc=$?; pg_restore -l /tmp/backup_rol.dump >/dev/null 2>&1 && echo toc_ok']);
      registrar(/rc=0/.test(conBandera.stdout) && /toc_ok/.test(conBandera.stdout), 'pg_dump como daubert_backup CON --enable-row-security termina bien y su catálogo se lee (pg_restore -l)', conBandera.stdout.slice(0, 200));
      // Un respaldo incompleto debe DETECTARSE: con la política de una tabla eliminada la verificación debe FALLAR (pg_dump saldría con esa tabla vacía y sin error).
      psql({ sql: 'DROP POLICY pol_respaldo_sel ON manufactura.firmas' });
      registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } }).out), 'DETECCIÓN (respaldo): si a una tabla con RLS le falta la política de lectura de daubert_backup, la verificación FALLA (evita un respaldo con la tabla vacía)');
      const postF = psql({ archivo: '26.postcheck.sql', tuplas: true, vars: baseline[26] });
      registrar(!TODO_OK(postF.out), 'DETECCIÓN (respaldo): el postcheck 026 FALLA si falta una política de respaldo');
      psql({ sql: "CREATE POLICY pol_respaldo_sel ON manufactura.firmas AS PERMISSIVE FOR SELECT TO daubert_backup USING (true)" });
      psql({ sql: 'CREATE TABLE core.zz_rls_sin_politica_respaldo (x int); ALTER TABLE core.zz_rls_sin_politica_respaldo ENABLE ROW LEVEL SECURITY' });
      registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: String(NIVEL_FINAL) } }).out), 'DETECCIÓN (respaldo): una tabla NUEVA con RLS fuera de manufactura y sin política de respaldo hace FALLAR la verificación');
      psql({ sql: 'DROP TABLE core.zz_rls_sin_politica_respaldo' });
      psql({ sql: 'DROP POLICY pol_respaldo_sel ON manufactura.firmas' });
      psql({ sql: "CREATE POLICY pol_respaldo_sel ON manufactura.firmas AS PERMISSIVE FOR ALL TO daubert_backup USING (true) WITH CHECK (true)" });
      registrar(!TODO_OK(psql({ archivo: '26.postcheck.sql', tuplas: true, vars: baseline[26] }).out), 'DETECCIÓN (respaldo): una política de respaldo que permitiera ESCRIBIR (FOR ALL) hace FALLAR el postcheck 026');
      psql({ sql: 'DROP POLICY pol_respaldo_sel ON manufactura.firmas' });
      psql({ sql: "CREATE POLICY pol_respaldo_sel ON manufactura.firmas AS PERMISSIVE FOR SELECT TO daubert_backup USING (true)" });
      psql({ sql: "COMMENT ON POLICY pol_respaldo_sel ON manufactura.firmas IS '026: lectura completa para el rol de respaldos daubert_backup (pg_dump --enable-row-security). Solo SELECT; no concede escritura. Las políticas de daubert_hub_app no cambian.'" });
    }
    }
    verificar(base, NIVEL_FINAL, 'tras revertir las violaciones provocadas');

    // ---- negativas de ejecución
    for (const [t, usuario] of [['precheck', 'postgres'], ['up', 'postgres'], ['down', 'postgres']]) {
      const r = psql({ archivo: `20.${t}.sql`, base: 'otra_base', usuario });
      registrar(r.codigo !== 0 && /ABORTO: .*daubert_global/.test(r.salida), `${t.toUpperCase()} en una base de otro nombre aborta antes de escribir`);
    }
    registrar(/ya existe/.test(psql({ archivo: '20.up.sql' }).salida), 'UP repetido aborta (no se reaplica)');
    registrar(/administrativo|no es administrador|permission denied/i.test(psql({ archivo: '20.up.sql', usuario: 'daubert_hub_app' }).salida), 'UP con el rol de la aplicación aborta');
    registrar(psql({ archivo: VERIFICAR, usuario: 'daubert_hub_app' }).codigo !== 0, 'la verificación transversal exige el rol administrativo');

    // ---- DOWN en orden inverso (esquema vacío) y vuelta exacta a la línea base
    for (const m of [...MIGRACIONES].reverse()) {
      const d = psql({ archivo: `${m.n}.down.sql` });
      registrar(d.codigo === 0 && /DOWN_OK/.test(d.salida), `${m.n}: DOWN aplicado (esquema vacío)`, d.codigo ? d.salida.slice(-300) : '');
    }
    registrar(psql({ sql: "SELECT to_regnamespace('manufactura') IS NULL", tuplas: true }).out.trim() === 't', 'tras los 5 DOWN el esquema manufactura ya no existe');
    verificar(base, 24, 'tras revertir TODO (DOWN 024→020): el catálogo fuera de manufactura es idéntico a la línea base');
    // ---- y se puede volver a aplicar
    for (const m of MIGRACIONES) aplicarMigracion(m);
    verificar(base, NIVEL_FINAL, 'tras reaplicar 020–026');

    // ---- DOWN con datos: exige confirmaciones explícitas (no borra por accidente)
    if (CON_DATOS) {                                                         // usa usuarios sintéticos: no aplica a una réplica con datos reales
      console.log('INFO  --con-datos: se omite el DOWN con documentos sintéticos');
      // ---- DESPUÉS de 020→024 (y tras DOWN/reaplicación y los controles de detección): nada preexistente cambió
      const despuesDatos = psql({ archivo: 'huellas.sql', tuplas: true }).out;
      const A = new Map(antesDatos.split('\n').filter(Boolean).map((l) => l.split('|'))); const D = new Map(despuesDatos.split('\n').filter(Boolean).map((l) => l.split('|')));
      const distintas = [...A].filter(([k, v]) => D.get(k) !== v).map(([k]) => k);
      registrar(A.size === D.size && distintas.length === 0, 'DATOS preexistentes idénticos antes y después de 020–024 (' + A.size + ' tablas, huella MD5 de todas sus filas)', distintas.length ? 'distintas: ' + distintas.join(', ') : '');
      docker(['exec', '-e', 'PGPASSWORD=scratch', C, 'sh', '-c', DUMP_ESTRUCTURA('/tmp/estructura_despues.sql', '--exclude-schema=manufactura')]);
      const dif = docker(['exec', C, 'sh', '-c', 'diff /tmp/estructura_antes.sql /tmp/estructura_despues.sql | head -40']);
      registrar(dif.status === 0 && dif.stdout.trim() === '', 'ESTRUCTURA y permisos fuera de manufactura idénticos antes y después (pg_dump -s completo: ACL, políticas RLS, funciones, triggers)', dif.stdout.slice(0, 280));
      if (EVIDENCIA) {
        fs.mkdirSync(EVIDENCIA, { recursive: true });
        fs.writeFileSync(path.join(EVIDENCIA, 'huellas_datos_antes.txt'), antesDatos); fs.writeFileSync(path.join(EVIDENCIA, 'huellas_datos_despues.txt'), despuesDatos);
        docker(['exec', '-e', 'PGPASSWORD=scratch', C, 'sh', '-c', DUMP_ESTRUCTURA('/tmp/estructura_manufactura.sql', '-n manufactura')]);
        for (const n of ['estructura_antes', 'estructura_despues', 'estructura_manufactura']) docker(['cp', C + ':/tmp/' + n + '.sql', path.join(EVIDENCIA, n + '.sql')]);
      }
      if (!MANTENER) docker(['rm', '-f', C]);
      const fallosCD = RES.filter((x) => !x).length;
      console.log(`\nRESULTADO: ${RES.length - fallosCD} PASS / ${fallosCD} FAIL`);
      process.exit(fallosCD ? 1 : 0);
    }
    psql({ sql: "SELECT set_config('app.user_id', '1', false), set_config('app.user_email', 'admin1@example.invalid', false); INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ('X1')" });
    const dd = psql({ archivo: '24.down.sql' });
    const d16 = dd.codigo === 0;
    registrar(d16, '024: DOWN (solo restaura políticas; no toca datos)');
    const dn = psql({ archivo: '20.down.sql' });
    registrar(dn.codigo !== 0 && /hay datos en manufactura/.test(dn.salida), '020: DOWN con documentos existentes ABORTA sin las confirmaciones explícitas de producción');
  } finally {
    docker(['rm', '-f', C]);
  }
  const fallos = RES.filter((x) => !x).length;
  console.log(`\nRESULTADO: ${RES.length - fallos} PASS / ${fallos} FAIL`);
  process.exit(fallos ? 1 : 0);
}
main();
