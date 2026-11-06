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
const C = 'daubert-scratch-pg-prod-replica';
const PUERTO = 55447;
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const DUMP = arg('--dump');
const ESTRUCTURA_PROD = arg('--estructura-prod');
// --con-datos: el respaldo se restaura COMPLETO (con los datos reales) y NO se siembran datos sintéticos ni se ejecutan los smoke con escrituras (usan los usuarios sintéticos 1-5, que aquí serían reales).
// Solo para la réplica DESECHABLE del ensayo de liberación. Sin la bandera el comportamiento es el de siempre (estructura + datos sintéticos).
const CON_DATOS = process.argv.includes('--con-datos');
if (!DUMP || !fs.existsSync(DUMP)) { console.error('Uso: --dump <respaldo pg_dump -F c de daubert_global> [--estructura-prod estructura_PROD.txt]'); process.exit(2); }

const MIGRACIONES = [
  { n: 20, base: '20261108_020_manufactura_gestor_documental_prod', params: 'baseline' },
  { n: 21, base: '20261108_021_manufactura_responsables_firmas_prod', params: 'huella_101' },
  { n: 22, base: '20261108_022_manufactura_inventario_firmas_admin_prod', params: 'huella_manufactura' },
  { n: 23, base: '20261108_023_manufactura_cliente_abreviaturas_prod', params: 'huella_manufactura' },
  { n: 24, base: '20261108_024_manufactura_consulta_compartida_borradores_prod', params: 'huella_resto' }
];
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
  const r = docker(['run', '-d', '--rm', '--name', C, '-e', 'POSTGRES_PASSWORD=scratch', '-p', `127.0.0.1:${PUERTO}:5432`, 'postgres:18-alpine']);
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  for (let i = 0; i < 80; i += 1) { if (docker(['exec', C, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; dormir(500); }
  dormir(1500);
}

function construirReplica() {
  const roles = `
CREATE ROLE daubert_hub_app LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE daubert_hub_test_user LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE n8n_app LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE n8n_cat_prod LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE n8n_cat_test LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 5;
CREATE ROLE n8n_app_test LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE daubert_docs_ro LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE daubert_docs_ro SET default_transaction_read_only = on; ALTER ROLE daubert_docs_ro SET statement_timeout = '30s'; ALTER ROLE daubert_docs_ro SET lock_timeout = '5s';
ALTER ROLE n8n_app_test SET statement_timeout = '60s';
CREATE DATABASE daubert_global OWNER postgres;
CREATE DATABASE otra_base OWNER postgres;`;
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
  if (CON_DATOS) return;                                                   // réplica con datos reales: sin siembra sintética
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
    for (const m of MIGRACIONES) { sube(`replica_only/${m.base}.smoke_replica.sql`, `${m.n}.smoke.sql`); }

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
      if (CON_DATOS) continue;                                               // los smoke con escrituras usan usuarios sintéticos: no se ejecutan con datos reales
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
    const v1 = psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: '24' } });
    registrar(!TODO_OK(v1.out), 'DETECCIÓN: si n8n_app recibiera SELECT en manufactura, la verificación FALLA');
    psql({ sql: 'REVOKE SELECT ON manufactura.documentos FROM n8n_app' });
    psql({ sql: 'GRANT SELECT ON manufactura.firmas TO PUBLIC' });
    registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: '24' } }).out), 'DETECCIÓN: si PUBLIC recibiera SELECT en manufactura.firmas, la verificación FALLA');
    psql({ sql: 'REVOKE SELECT ON manufactura.firmas FROM PUBLIC' });
    psql({ sql: 'GRANT DELETE ON manufactura.documentos TO daubert_hub_app' });
    registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: '24' } }).out), 'DETECCIÓN: si daubert_hub_app recibiera DELETE en documentos, la verificación FALLA');
    psql({ sql: 'REVOKE DELETE ON manufactura.documentos FROM daubert_hub_app' });
    psql({ sql: 'GRANT SELECT ON core.empresas TO n8n_cat_prod' });
    registrar(!TODO_OK(psql({ archivo: VERIFICAR, tuplas: true, vars: { ...base, nivel: '24' } }).out), 'DETECCIÓN: si cambiara un privilegio FUERA de manufactura (core.empresas), la verificación FALLA');
    psql({ sql: 'REVOKE SELECT ON core.empresas FROM n8n_cat_prod' });
    verificar(base, 24, 'tras revertir las violaciones provocadas');

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
    verificar(base, 24, 'tras reaplicar 020–024');

    // ---- DOWN con datos: exige confirmaciones explícitas (no borra por accidente)
    if (CON_DATOS) {                                                         // usa usuarios sintéticos: no aplica a una réplica con datos reales
      console.log('INFO  --con-datos: se omite el DOWN con documentos sintéticos');
      docker(['rm', '-f', C]);
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
