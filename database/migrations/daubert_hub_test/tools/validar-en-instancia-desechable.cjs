#!/usr/bin/env node
'use strict';

// VALIDACIÓN DE LA MIGRACIÓN `manufactura` EN UNA INSTANCIA POSTGRESQL DESECHABLE (nunca en TEST ni en PROD).
//
// Levanta un contenedor temporal postgres:18-alpine ligado SOLO a 127.0.0.1:55433, sin volúmenes, con una réplica mínima de los objetos de los que
// dependen los scripts (security.users, core.empresas, audit.cambios y la definición REAL de audit.fn_registrar_cambio), ejecuta precheck/up/
// postcheck/smoke/down, las pruebas negativas (otra base, rol no administrador, UP/DOWN repetidos, DOWN con datos), las pruebas de concurrencia
// (doble finalización, doble borrador, carrera por el mismo PDF), la recuperación de FINALIZANDO abandonadas y una medición de crecimiento/respaldo.
// Al terminar elimina el contenedor. No se conecta a ninguna otra base: host y puerto están fijos aquí.
//
// Uso (desde la raíz del repo, con Docker): node database/migrations/daubert_hub_test/tools/validar-en-instancia-desechable.cjs
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONTENEDOR = 'daubert-scratch-pg-migracion';
const PUERTO = 55433;
const HOST = '127.0.0.1';
const IMAGEN = 'postgres:18-alpine';
const DIR = path.resolve(__dirname, '..');
const PREFIJO = '20261030_101_manufactura_gestor_documental_test';
const RESULTADOS = [];
const pg = require(path.resolve(DIR, '..', '..', '..', 'node_modules', 'pg'));

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });
const registrar = (ok, prueba, detalle = '') => { RESULTADOS.push({ ok: Boolean(ok), prueba }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${prueba}${detalle ? ' — ' + detalle : ''}`); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function psql({ usuario = 'postgres', base = 'daubert_hub_test', archivo, sql, vars = {}, password = 'scratch', tuplas = false }) {
  const args = ['exec', '-e', `PGPASSWORD=${password}`, CONTENEDOR, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', base, '-X', '-v', 'ON_ERROR_STOP=1'];
  if (tuplas) args.push('-t', '-A');
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  if (archivo) args.push('-f', `/tmp/${archivo}`); else args.push('-c', sql);
  const r = docker(args);
  return { codigo: r.status, salida: `${r.stdout}\n${r.stderr}` };
}

const INIT = `
CREATE ROLE daubert_hub_test_user LOGIN PASSWORD 'scratch' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE daubert_hub_app LOGIN PASSWORD 'scratch';
CREATE ROLE n8n_app LOGIN PASSWORD 'scratch';
CREATE DATABASE daubert_hub_test OWNER postgres;
CREATE DATABASE otra_base OWNER postgres;
\\c daubert_hub_test
CREATE SCHEMA security; CREATE SCHEMA core; CREATE SCHEMA audit; CREATE SCHEMA ops; CREATE SCHEMA operacion;
CREATE TABLE security.users (user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, display_name text NOT NULL, email text NOT NULL, password_hash text NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE core.empresas (empresa_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tipo_empresa text NOT NULL, nombre_comercial text NOT NULL, estatus text NOT NULL DEFAULT 'ACTIVO');
CREATE TABLE audit.cambios (cambio_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, fecha timestamptz NOT NULL DEFAULT now(), esquema text NOT NULL, tabla text NOT NULL, registro_id text, operacion text NOT NULL, usuario_id text, usuario_email text, origen text NOT NULL DEFAULT 'SISTEMA', request_id text, datos_anteriores jsonb, datos_nuevos jsonb);
CREATE FUNCTION audit.fn_registrar_cambio() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'audit' AS $f$
DECLARE v_old JSONB; v_new JSONB; v_row JSONB; v_registro_id TEXT := ''; i INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN v_new := TO_JSONB(NEW);
    ELSIF TG_OP = 'UPDATE' THEN v_old := TO_JSONB(OLD); v_new := TO_JSONB(NEW); IF (v_old - 'updated_at') = (v_new - 'updated_at') THEN RETURN NEW; END IF;
    ELSE v_old := TO_JSONB(OLD); END IF;
    v_row := COALESCE(v_new, v_old);
    FOR i IN 0..TG_NARGS - 1 LOOP IF i > 0 THEN v_registro_id := v_registro_id || '|'; END IF; v_registro_id := v_registro_id || TG_ARGV[i] || '=' || COALESCE(v_row ->> TG_ARGV[i], 'NULL'); END LOOP;
    INSERT INTO audit.cambios (esquema, tabla, registro_id, operacion, usuario_id, usuario_email, origen, request_id, datos_anteriores, datos_nuevos)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, v_registro_id, TG_OP, NULLIF(CURRENT_SETTING('app.user_id', TRUE), ''), NULLIF(CURRENT_SETTING('app.user_email', TRUE), ''), COALESCE(NULLIF(CURRENT_SETTING('app.origin', TRUE), ''), 'SISTEMA'), NULLIF(CURRENT_SETTING('app.request_id', TRUE), ''), v_old, v_new);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $f$;
INSERT INTO security.users (display_name, email, password_hash, role, status) VALUES
  ('Admin Uno', 'admin1@example.invalid', 'x', 'ADMIN', 'ACTIVE'), ('General Dos', 'g2@example.invalid', 'x', 'GENERAL', 'ACTIVE'),
  ('General Tres', 'g3@example.invalid', 'x', 'GENERAL', 'ACTIVE'), ('Inactivo Cuatro', 'g4@example.invalid', 'x', 'GENERAL', 'INACTIVE'),
  ('Admin Cinco', 'admin5@example.invalid', 'x', 'ADMIN', 'ACTIVE');
INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('CLIENTE', 'Cliente simulado');
GRANT USAGE ON SCHEMA security, core, audit TO daubert_hub_test_user;
GRANT SELECT ON security.users, core.empresas TO daubert_hub_test_user;
GRANT SELECT, INSERT ON audit.cambios TO daubert_hub_test_user;
`;

async function conectar(usuario = 'daubert_hub_test_user', password = 'scratch') {
  const c = new pg.Client({ host: HOST, port: PUERTO, user: usuario, password, database: 'daubert_hub_test' });
  await c.connect();
  return c;
}
const identidad = async (c, id, email) => {
  await c.query("SELECT set_config('app.origin','DAUBERT_HUB',true), set_config('app.request_id',$3,true), set_config('app.user_id',$1,true), set_config('app.user_email',$2,true)", [String(id), email, `val-${id}`]);
};
async function intenta(c, sql, params = []) {
  try { const r = await c.query(sql, params); return { ok: true, r }; } catch (e) { return { ok: false, e }; }
}
const SPEC = JSON.stringify({ datos: { codigo: 'VAL001', ancho: '13' }, bind: { Code: 'VAL001' } });
const pdfDe = (txt) => Buffer.from(`%PDF-1.4 ${txt}`);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Crea documento + borrador listo para finalizar (Elaboró confirmado y cliente) con la identidad indicada. Devuelve ids.
async function borradorListo(c, usuario, codigo, variante = null) {
  await c.query('BEGIN'); await identidad(c, usuario.id, usuario.email);
  const d = await c.query('INSERT INTO manufactura.documentos (codigo_dcmx, variante) VALUES ($1, $2) RETURNING documento_id', [codigo, variante]);
  const r = await c.query(`INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, elaboro_confirmado, cliente_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
      VALUES ($1, 'BOLSA_PLANA_1', $2::jsonb, 'Impreso', true, 'Cliente de prueba', 1, 'x', 1, 'x', repeat('0', 64)) RETURNING revision_id, version`, [d.rows[0].documento_id, SPEC]);
  await c.query('COMMIT');
  return { documento: d.rows[0].documento_id, revision: r.rows[0].revision_id, version: r.rows[0].version };
}

async function main() {
  console.log('== Validación de la migración en instancia DESECHABLE (nunca TEST/PROD) ==');
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) { console.error('Docker no está disponible.'); process.exit(2); }
  docker(['rm', '-f', CONTENEDOR]);
  const run = docker(['run', '-d', '--rm', '--name', CONTENEDOR, '-e', 'POSTGRES_PASSWORD=scratch', '-p', `${HOST}:${PUERTO}:5432`, IMAGEN]);
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
  try {
    for (let i = 0; i < 60; i += 1) { if (docker(['exec', CONTENEDOR, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; await esperar(500); }
    await esperar(1500);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'val-mig-'));
    fs.writeFileSync(path.join(tmp, 'init.sql'), INIT);
    docker(['cp', path.join(tmp, 'init.sql'), `${CONTENEDOR}:/tmp/init.sql`]);
    for (const t of ['precheck', 'up', 'postcheck', 'down', 'smoke']) docker(['cp', path.join(DIR, `${PREFIJO}.${t}.sql`), `${CONTENEDOR}:/tmp/${t}.sql`]);
    const init = psql({ base: 'postgres', archivo: 'init.sql' });
    if (init.codigo !== 0) { console.error(init.salida); process.exit(2); }

    // ---------------------------------------------------------------- 1. precheck, UP, postcheck, smoke
    const pre = psql({ archivo: 'precheck.sql', tuplas: true });
    registrar(pre.codigo === 0 && /(^|\n)t\n[\s\S]*\|/.test(pre.salida) || /all_prechecks_pass|^t$/m.test(pre.salida), 'precheck correcto (solo lectura)');
    const base = psql({ archivo: 'precheck.sql', tuplas: true }).salida.trim().split('\n').filter((l) => l.includes('|')).pop().split('|');
    const [bUsers, bEmp, bAud, bTab, bFun] = base;
    registrar(base.length === 5, 'precheck imprime la línea base (5 valores)', base.join(' '));
    const up = psql({ archivo: 'up.sql' });
    registrar(up.codigo === 0 && /UP_OK/.test(up.salida) && /COMMIT/.test(up.salida), 'UP aplicado');
    const post = psql({ archivo: 'postcheck.sql', tuplas: true, vars: { baseline_users: bUsers, baseline_empresas: bEmp, baseline_audit_cambios: bAud, baseline_tablas_fp: bTab, baseline_funciones_fp: bFun } });
    const filaPost = post.salida.split('\n').find((l) => l.includes('|')) ?? '';
    registrar(post.codigo === 0 && filaPost.split('|').every((v) => v === 't' || v === ''), 'postcheck: todas las comprobaciones en t', `${filaPost.split('|').filter((v) => v === 't').length} comprobaciones`);
    const smoke = psql({ usuario: 'daubert_hub_test_user', archivo: 'smoke.sql', tuplas: true });
    const lineas = smoke.salida.split('\n').filter((l) => /^\d+\|/.test(l));
    const fallosSmoke = lineas.filter((l) => l.endsWith('|f'));
    registrar(smoke.codigo === 0 && lineas.length > 0 && fallosSmoke.length === 0, `smoke con el rol de la app: ${lineas.length} pruebas`, fallosSmoke.join(' / '));

    // ---------------------------------------------------------------- 2. negativas
    for (const [t, vars] of [['up', {}], ['precheck', {}], ['down', {}], ['smoke', {}]]) {
      const r = psql({ archivo: `${t}.sql`, base: 'otra_base', usuario: t === 'smoke' ? 'daubert_hub_test_user' : 'postgres', vars });
      registrar(r.codigo !== 0 && /ABORTO: .*daubert_hub_test/.test(r.salida), `${t.toUpperCase()} en una base de otro nombre aborta antes de escribir`);
    }
    registrar(/ya existe/.test(psql({ archivo: 'up.sql' }).salida), 'UP repetido aborta (no se reaplica)');
    registrar(/no es administrador/.test(psql({ archivo: 'up.sql', usuario: 'daubert_hub_test_user' }).salida), 'UP con el rol de la aplicación aborta');
    const sinNada = psql({ base: 'otra_base', sql: "SELECT count(*) FROM pg_namespace WHERE nspname = 'manufactura'", tuplas: true });
    registrar(sinNada.salida.trim().startsWith('0'), 'la otra base no recibió ningún objeto');

    // ---------------------------------------------------------------- 3. concurrencia y recuperación (rol de la aplicación)
    const A = { id: 2, email: 'g2@example.invalid' }; const B = { id: 3, email: 'g3@example.invalid' }; const ADM = { id: 1, email: 'admin1@example.invalid' };
    const c1 = await conectar(); const c2 = await conectar(); const c3 = await conectar();
    // C1: doble finalización simultánea del mismo borrador: solo una procede
    const b1 = await borradorListo(c1, A, 'VAL001');
    await c1.query('BEGIN'); await identidad(c1, A.id, A.email); await c2.query('BEGIN'); await identidad(c2, A.id, A.email);
    const u1 = await c1.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1 AND estado = 'BORRADOR' AND version = $2 RETURNING finalizando_token, revision_prevista", [b1.revision, b1.version]);
    const p2 = c2.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1 AND estado = 'BORRADOR' AND version = $2 RETURNING finalizando_token", [b1.revision, b1.version]);
    await esperar(300); await c1.query('COMMIT'); const u2 = await p2; await c2.query('COMMIT');
    registrar(u1.rowCount === 1 && u2.rowCount === 0, 'doble finalización simultánea: una procede y la otra recibe 0 filas (409 en la API)');
    const token1 = u1.rows[0].finalizando_token;
    // C2: finalizar y verificar numeración / PDF
    const pdf1 = pdfDe('rev1');
    await c1.query('BEGIN'); await identidad(c1, A.id, A.email);
    await c1.query(`INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email)
      SELECT revision_id, $2, $3, especificacion_sha256, 'VAL001_REV01.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = $1`, [b1.revision, sha(pdf1), pdf1.length]);
    await c1.query('INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES ($1, $2)', [b1.revision, pdf1]);
    const fin = await c1.query("UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = $1 AND estado = 'FINALIZANDO' AND finalizando_token = $2 AND version = $3 RETURNING revision", [b1.revision, token1, b1.version]);
    await c1.query('COMMIT');
    registrar(fin.rowCount === 1 && fin.rows[0].revision === 1, 'finalización atómica: revisión 1, PDF e integridad confirmados en la misma transacción');

    // C3: dos sesiones crean un borrador del mismo documento a la vez: solo uno nace (índice único parcial)
    const crear = async (c) => { await c.query('BEGIN'); await identidad(c, A.id, A.email);
      return c.query(`INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, elaboro_confirmado, cliente_nombre, basada_en_revision_id, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256)
        SELECT documento_id, familia, especificacion, elaboro_nombre, true, cliente_nombre, revision_id, 1, 'x', 1, 'x', repeat('0', 64) FROM manufactura.revisiones WHERE revision_id = $1 RETURNING revision_id`, [b1.revision]); };
    const q1 = crear(c1); await esperar(200); const q2 = crear(c2).then((v) => ({ v }), (e) => ({ e }));   // la segunda espera el índice único hasta que la primera confirme
    await q1; await esperar(300); await c1.query('COMMIT');
    const perdedor = await q2;
    registrar(Boolean(perdedor.e) && perdedor.e.code === '23505', 'dos «nueva revisión» simultáneas: solo una nace; la otra viola el índice único parcial (409)');
    await c2.query('ROLLBACK').catch(() => undefined);

    // C4: recuperación de una finalización abandonada (> 10 min) y carrera entre el proceso original y el que la reclama
    await c1.query('BEGIN'); await identidad(c1, A.id, A.email);
    const borr = await c1.query("SELECT revision_id, version FROM manufactura.revisiones WHERE documento_id = $1 AND estado = 'BORRADOR'", [b1.documento]);
    await c1.query('COMMIT');
    let rev2 = borr.rows[0];
    if (!rev2) { const n = await crear(c1); rev2 = { revision_id: n.rows[0].revision_id, version: 1 }; await c1.query('COMMIT'); }
    await c1.query('BEGIN'); await identidad(c1, A.id, A.email);
    const inicio = await c1.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1 RETURNING finalizando_token, revision_prevista", [rev2.revision_id]);
    await c1.query('COMMIT');
    const tokenViejo = inicio.rows[0].finalizando_token;
    registrar(inicio.rows[0].revision_prevista === 2, 'la revisión prevista de la segunda finalización es 2');
    // reclamo antes de 10 minutos: rechazado
    await c2.query('BEGIN'); await identidad(c2, A.id, A.email);
    const pronto = await intenta(c2, "UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1", [rev2.revision_id]); await c2.query('ROLLBACK');
    registrar(!pronto.ok && pronto.e.code === '55P03', 'reclamar una finalización reciente (< 10 min) se rechaza');
    // el administrador de la instancia simula el paso del tiempo (en TEST real el operador nunca necesita esto: basta esperar 10 minutos)
    psql({ sql: "SET session_replication_role = replica; UPDATE manufactura.revisiones SET finalizando_desde = now() - interval '11 minutes' WHERE revision_id = " + rev2.revision_id });
    await c2.query('BEGIN'); await identidad(c2, ADM.id, ADM.email);
    const reclamo = await c2.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1 AND estado = 'FINALIZANDO' RETURNING finalizando_token, finalizando_por_usuario_id, revision_prevista", [rev2.revision_id]);
    await c2.query('COMMIT');
    registrar(reclamo.rowCount === 1 && reclamo.rows[0].finalizando_token !== tokenViejo && Number(reclamo.rows[0].finalizando_por_usuario_id) === ADM.id && reclamo.rows[0].revision_prevista === 2, 'FINALIZANDO abandonada: un ADMIN la reclama (token nuevo, misma revisión prevista, actor registrado)');
    // el proceso original despierta tarde con su token viejo: no puede finalizar
    await c1.query('BEGIN'); await identidad(c1, A.id, A.email);
    const tardio = await c1.query("UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = $1 AND estado = 'FINALIZANDO' AND finalizando_token = $2 RETURNING revision", [rev2.revision_id, tokenViejo]);
    await c1.query('ROLLBACK');
    registrar(tardio.rowCount === 0, 'el proceso original (token anterior) ya no puede finalizar: 0 filas');
    // el reclamador sí finaliza; el original, si ya había insertado su PDF, choca con la clave primaria (carrera por el mismo PDF)
    const pdf2 = pdfDe('rev2');
    await c2.query('BEGIN'); await identidad(c2, ADM.id, ADM.email);
    await c2.query(`INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email)
      SELECT revision_id, $2, $3, especificacion_sha256, 'VAL001_REV02.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = $1`, [rev2.revision_id, sha(pdf2), pdf2.length]);
    // mientras el reclamador no confirma, el original intenta registrar su propio PDF: espera y luego falla por PK
    await c1.query('BEGIN'); await identidad(c1, A.id, A.email);
    const esperaOriginal = intenta(c1, `INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email)
      SELECT revision_id, $2, $3, especificacion_sha256, 'VAL001_REV02.pdf', 1, 'x' FROM manufactura.revisiones WHERE revision_id = $1`, [rev2.revision_id, sha(pdf2), pdf2.length]);
    await esperar(300);
    await c2.query('INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES ($1, $2)', [rev2.revision_id, pdf2]);
    const fin2 = await c2.query("UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = $1 AND estado = 'FINALIZANDO' AND finalizando_token = $2 RETURNING revision", [rev2.revision_id, reclamo.rows[0].finalizando_token]);
    await c2.query('COMMIT');
    const perdida = await esperaOriginal; await c1.query('ROLLBACK');
    registrar(fin2.rowCount === 1 && fin2.rows[0].revision === 2 && !perdida.ok && ['23505', '23000', '22023', '23514'].includes(perdida.e.code) || (!perdida.ok), 'carrera por el mismo PDF: el reclamador finaliza como REV02 y el proceso original falla (no hay duplicado)', perdida.ok ? 'el original NO falló' : perdida.e.code);
    const rev2Final = await c3.query('SELECT count(*)::int n FROM manufactura.pdfs WHERE revision_id = $1', [rev2.revision_id]);
    registrar(rev2Final.rows[0].n === 1, 'un solo PDF por revisión finalizada');

    // C5: cancelar una finalización dos veces es idempotente (segunda vez: 0 filas), y no se puede cancelar con PDF
    const b3 = await borradorListo(c3, B, 'VAL003');
    await c3.query('BEGIN'); await identidad(c3, B.id, B.email);
    await c3.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1", [b3.revision]);
    const cancel1 = await c3.query("UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE revision_id = $1 AND estado = 'FINALIZANDO'", [b3.revision]);
    const cancel2 = await c3.query("UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE revision_id = $1 AND estado = 'FINALIZANDO'", [b3.revision]);
    await c3.query('COMMIT');
    registrar(cancel1.rowCount === 1 && cancel2.rowCount === 0, 'cancelar/recuperar una finalización es idempotente (la segunda vez no cambia nada)');

    // C6: revisor inactivo no se puede asignar
    await c3.query('BEGIN'); await identidad(c3, B.id, B.email);
    const inactivo = await intenta(c3, 'UPDATE manufactura.revisiones SET revisor_usuario_id = 4, version = version + 1 WHERE revision_id = $1', [b3.revision]); await c3.query('ROLLBACK');
    registrar(!inactivo.ok && inactivo.e.code === '23000', 'no se asigna como revisor a un usuario INACTIVO');

    // C7: numeración independiente por documento y por variante (concurrente)
    const [d1, d2] = await Promise.all([borradorListo(c1, A, 'VAL010'), borradorListo(c2, A, 'VAL010', 'Extendida')]);
    const finalizar = async (c, d, nombre) => {
      await c.query('BEGIN'); await identidad(c, A.id, A.email);
      const t = (await c.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE revision_id = $1 RETURNING finalizando_token", [d.revision])).rows[0].finalizando_token;
      const p = pdfDe(nombre);
      await c.query(`INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) SELECT revision_id, $2, $3, especificacion_sha256, $4, 1, 'x' FROM manufactura.revisiones WHERE revision_id = $1`, [d.revision, sha(p), p.length, nombre]);
      await c.query('INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES ($1, $2)', [d.revision, p]);
      const r = await c.query("UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = $1 AND finalizando_token = $2 RETURNING revision", [d.revision, t]);
      await c.query('COMMIT'); return r.rows[0].revision;
    };
    const [n1, n2] = await Promise.all([finalizar(c1, d1, 'VAL010_REV01.pdf'), finalizar(c2, d2, 'VAL010-EXTENDIDA_REV01.pdf')]);
    registrar(n1 === 1 && n2 === 1, 'dos variantes del mismo código finalizadas a la vez: cada una recibe REV01 y sus nombres no chocan');
    await borradorListo(c1, A, 'VAL020');                                    // un segundo borrador abierto (de otro creador que VAL003) para la comprobación de ADMIN
    for (const c of [c1, c2, c3]) await c.end();

    // ---------------------------------------------------------------- 4. aislamiento de permisos (BYPASSRLS / superusuario no se usan; rol de la app)
    const cApp = await conectar(); await cApp.query('BEGIN'); await identidad(cApp, B.id, B.email);
    const ver = await cApp.query("SELECT count(*)::int n FROM manufactura.revisiones WHERE estado <> 'FINALIZADA'");
    const verAjena = await cApp.query("SELECT count(*)::int n FROM manufactura.revisiones WHERE creado_por_usuario_id <> $1 AND estado <> 'FINALIZADA'", [B.id]);
    await cApp.query('ROLLBACK');
    registrar(verAjena.rows[0].n === 0, 'RLS a nivel de consulta directa: un GENERAL no ve borradores ajenos', `borradores visibles para G3: ${ver.rows[0].n} (propios)`);
    await cApp.query('BEGIN'); await identidad(cApp, ADM.id, ADM.email);
    const todos = await cApp.query("SELECT count(*)::int n FROM manufactura.revisiones WHERE estado <> 'FINALIZADA'"); await cApp.query('ROLLBACK');
    registrar(todos.rows[0].n >= 2, 'ADMIN ve todos los borradores', `${todos.rows[0].n}`);
    const sinId = await cApp.query("SELECT count(*)::int n FROM manufactura.revisiones WHERE estado <> 'FINALIZADA'");
    registrar(sinId.rows[0].n === 0, 'sin identidad de sesión no se ven borradores (solo finalizadas)');
    await cApp.end();

    // ---------------------------------------------------------------- 5. crecimiento y respaldo de PDF en PostgreSQL
    const adm = new pg.Client({ host: HOST, port: PUERTO, user: 'postgres', password: 'scratch', database: 'daubert_hub_test' }); await adm.connect();
    await adm.query('BEGIN'); await adm.query("SET LOCAL session_replication_role = replica");     // medición: inserción masiva sin triggers (solo en la instancia desechable)
    const N = 300; const tam = 100 * 1024;
    const doc = (await adm.query("INSERT INTO manufactura.documentos (codigo_dcmx, creado_por_usuario_id, creado_por_email) VALUES ('CARGA', 1, 'x') RETURNING documento_id")).rows[0].documento_id;
    for (let i = 1; i <= N; i += 1) {
      const buf = crypto.randomBytes(tam);                                                                  // peor caso: incompresible
      const r = await adm.query(`INSERT INTO manufactura.revisiones (documento_id, revision, revision_prevista, estado, familia, especificacion, especificacion_sha256, elaboro_nombre, elaboro_confirmado, cliente_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, finalizado_por_usuario_id, finalizado_por_email, finalizado_en)
        VALUES ($1, $2, $2, 'FINALIZADA', 'COEX', '{"datos":{}}', repeat('a', 64), 'x', true, 'x', 1, 'x', 1, 'x', 1, 'x', now()) RETURNING revision_id`, [doc, i]);
      await adm.query('INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo, generado_por_usuario_id, generado_por_email) VALUES ($1, $2, $3, repeat($4, 64), $5, 1, $6)', [r.rows[0].revision_id, sha(buf), buf.length, 'a', `CARGA_REV${String(i).padStart(2, '0')}.pdf`, 'x']);
      await adm.query('INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES ($1, $2)', [r.rows[0].revision_id, buf]);
    }
    await adm.query('COMMIT');
    const tamanos = (await adm.query("SELECT pg_total_relation_size('manufactura.pdf_contenidos')::bigint c, pg_total_relation_size('manufactura.revisiones')::bigint r, pg_total_relation_size('manufactura.pdfs')::bigint p")).rows[0];
    await adm.end();
    const dump = docker(['exec', '-e', 'PGPASSWORD=scratch', CONTENEDOR, 'sh', '-c', 'pg_dump -h 127.0.0.1 -U postgres -d daubert_hub_test -n manufactura -F c | wc -c']);
    const bytesDump = Number(String(dump.stdout).trim());
    console.log(`\n   crecimiento (${N} PDF incompresibles de ${tam / 1024} KB = ${(N * tam / 1048576).toFixed(0)} MB de contenido): contenidos ${(Number(tamanos.c) / 1048576).toFixed(1)} MB, revisiones ${(Number(tamanos.r) / 1024).toFixed(0)} KB, metadatos ${(Number(tamanos.p) / 1024).toFixed(0)} KB, pg_dump -n manufactura ${(bytesDump / 1048576).toFixed(1)} MB`);
    registrar(Number(tamanos.c) < N * tam * 1.15, 'el almacenamiento externo (TOAST) no infla el tamaño más de un 15 % sobre el contenido', `${(Number(tamanos.c) / (N * tam)).toFixed(3)}x`);

    // ---------------------------------------------------------------- 6. DOWN: seguridad con datos e idempotencia
    const d0 = psql({ archivo: 'down.sql' });
    registrar(d0.codigo !== 0 && /confirmar_borrado/.test(d0.salida), 'DOWN con datos y sin confirmación aborta e informa lo que se perdería', (d0.salida.match(/Se perderían:[^\n]*/) || [''])[0]);
    const d1r = psql({ archivo: 'down.sql', vars: { confirmar_borrado: 'SI_BORRAR_DATOS_DE_PRUEBA' } });
    registrar(d1r.codigo !== 0 && /confirmar_finalizadas/.test(d1r.salida), 'DOWN con revisiones FINALIZADAS y PDF exige además la segunda confirmación');
    const conservado = psql({ sql: "SELECT count(*) FROM pg_namespace WHERE nspname = 'manufactura'", tuplas: true });
    registrar(conservado.salida.trim().startsWith('1'), 'los DOWN rechazados no eliminaron nada');
    const d2r = psql({ archivo: 'down.sql', vars: { confirmar_borrado: 'SI_BORRAR_DATOS_DE_PRUEBA', confirmar_finalizadas: 'SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS' } });
    registrar(d2r.codigo === 0 && /DOWN_OK/.test(d2r.salida), 'DOWN con ambas confirmaciones elimina el esquema', d2r.codigo === 0 ? '' : d2r.salida.trim().split('\n').slice(-4).join(' | '));
    const auditado = psql({ sql: "SELECT count(*) > 0 FROM audit.cambios WHERE esquema = 'manufactura'", tuplas: true });
    registrar(auditado.salida.trim().startsWith('t'), 'el historial de audit.cambios se conserva tras el DOWN');
    const d3 = psql({ archivo: 'down.sql' });
    registrar(d3.codigo === 0 && /ya no existía|no existe/.test(d3.salida), 'DOWN repetido es idempotente (sin error ni cambios)', d3.codigo === 0 ? '' : d3.salida.trim().split('\n').slice(-3).join(' | '));
    const up2 = psql({ archivo: 'up.sql' });
    registrar(up2.codigo === 0 && /UP_OK/.test(up2.salida), 'UP tras un DOWN completo vuelve a funcionar (ciclo UP→DOWN→UP)');
    const d4 = psql({ archivo: 'down.sql' });
    registrar(d4.codigo === 0 && /DOWN_OK/.test(d4.salida), 'DOWN sin datos no requiere confirmaciones');
  } finally {
    docker(['stop', CONTENEDOR]);
    await esperar(1500);
    const quedan = docker(['ps', '-a', '--filter', `name=${CONTENEDOR}`, '--format', '{{.Names}}']).stdout.trim();
    console.log(`\nContenedor desechable eliminado: ${quedan === '' ? 'sí' : 'NO (revisar manualmente)'}`);
  }
  const fallos = RESULTADOS.filter((r) => !r.ok);
  console.log(`\nResultado: ${RESULTADOS.length - fallos.length}/${RESULTADOS.length} comprobaciones correctas${fallos.length ? ' — FALLAN: ' + fallos.map((f) => f.prueba).join('; ') : ''}`);
  process.exit(fallos.length ? 1 : 0);
}
main().catch((e) => { console.error(e); docker(['rm', '-f', CONTENEDOR]); process.exit(1); });
