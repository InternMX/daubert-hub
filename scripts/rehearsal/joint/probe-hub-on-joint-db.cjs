#!/usr/bin/env node
'use strict';

// Runs the REAL compiled Caterpillar repository of one or more Hub images against the throw-away database that has ALL migrations applied (rehearse-joint-migrations-isolated.cjs --keep),
// as the production Hub role daubert_hub_app, plus the Pagos functions the Hub calls (019 and 017). Nothing outside the throw-away container is touched.
//   node scripts/probe-hub-on-joint-db.cjs --state <joint-migrations-state.json> --old <image> --new <image> [--new <image>]
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arg = flag => { const out = []; process.argv.forEach((v, i) => { if (v === flag) out.push(process.argv[i + 1]); }); return out; };
const state = JSON.parse(fs.readFileSync(arg('--state')[0], 'utf8'));
const oldImage = arg('--old')[0], newImages = arg('--new');
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; };
const sql = text => sh('docker', ['exec', state.container, 'psql', '-U', 'postgres', '-d', 'daubert_global', '-t', '-A', '-c', text]).stdout.trim();
const results = [];
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail).slice(0, 500) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { check: name }); };

// The Caterpillar probe body is the one already reviewed in rehearse-hub-contracts-isolated.cjs; the Pagos part is appended here.
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'rehearse-hub-contracts-isolated.cjs'), 'utf8');
const probeBody = /const PROBE = `([\s\S]*?)`;\r?\n\r?\nfunction probe/.exec(source)[1].replace(/\\\\n/g, '\\n');
const pagosAddition = `
const pagosProbe = async () => {
  const q = async (text, values) => { try { const r = await pool.query(text, values); return { ok: true, rows: r.rows }; } catch (error) { return { ok: false, code: error.code || null, message: String(error.message).split('\\n')[0].slice(0, 140) }; } };
  out.pagos = {
    destino: await q('SELECT core.fn_destino_asignacion_pago_disponible($1::bigint, $2::bigint) AS safe', [process.env.P_CORREO, process.env.P_EMPRESA]),
    elegibilidad: await q('SELECT elegible FROM core.fn_reproceso_asignaciones_puntuales($1::bigint)', [process.env.P_CORREO]),
    sinPrivilegioDeEscritura: await q('SELECT core.fn_iniciar_recuperacion_pago($1::bigint, $2::text)', [process.env.P_CORREO, 'probe'])
  };
};
`;
const wrapped = probeBody.replace('(async () => {', pagosAddition + '(async () => {\n  await pagosProbe();');

function probe(image, extra = {}) {
  const file = path.join(os.tmpdir(), `joint-probe-${crypto.randomBytes(4).toString('hex')}.cjs`);
  fs.writeFileSync(file, wrapped);
  try {
    const env = { P_PORT: state.port, P_PASS: state.hubPassword, P_EXECUTION: extra.executionId, P_WRITES: extra.writes ? 1 : 0, P_ADMIN: extra.adminId ?? '', P_CORREO: extra.correo, P_EMPRESA: extra.empresa };
    const args = ['run', '--rm', '--add-host', 'host.docker.internal:host-gateway', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), '-v', `${file}:/app/rb-probe.cjs:ro`, image, 'node', '/app/rb-probe.cjs'];
    const run = sh('docker', args);
    const line = run.stdout.trim().split('\n').pop() || '';
    try { return JSON.parse(line); } catch { return { fatal: `no JSON (exit ${run.status}): ${run.stderr.slice(0, 300)}` }; }
  } finally { fs.unlinkSync(file); }
}

try {
  const executionId = sql("SELECT ejecucion_id FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='COMPLETADA' AND EXISTS(SELECT 1 FROM operacion.remisiones r WHERE r.ejecucion_id=e.ejecucion_id) ORDER BY 1 DESC LIMIT 1");
  const adminId = sql("SELECT user_id FROM security.users WHERE role='ADMIN' AND status='ACTIVE' AND NOT must_change_password ORDER BY user_id LIMIT 1");
  const correo = sql("SELECT correo_id FROM core.correos_notificacion_pago WHERE estado IN ('ERROR','PROCESADO') ORDER BY correo_id DESC LIMIT 1");
  const empresa = sql('SELECT empresa_id FROM core.empresas ORDER BY empresa_id LIMIT 1');
  const base = { executionId, adminId, correo, empresa };
  const oldRun = probe(oldImage, base);
  const readKeys = ['list', 'findById', 'findRemissionsByExecutionId', 'findReservationsByExecutionId', 'findDetailsByRemisionIds'];
  check('PREVIOUS Hub (production image) reads the fully migrated database: Caterpillar reads work', !oldRun.fatal && readKeys.every(k => oldRun[k]?.ok), JSON.stringify(oldRun));
  check('PREVIOUS Hub: the Pagos functions it relies on still answer on the migrated database', oldRun.pagos?.elegibilidad?.ok === true, JSON.stringify(oldRun.pagos));
  for (const image of newImages) {
    const p = probe(image, { ...base, writes: true });
    check(`${image}: every Caterpillar read works and the cancellation/regeneration contracts are available`, !p.fatal && readKeys.every(k => p[k]?.ok) && p.findCancellationAuditsByExecutionId?.ok && p.findRegenerationContext?.value?.available === true, JSON.stringify(p));
    check(`${image}: Caterpillar protected functions answer with their own domain errors (not 'does not exist')`, p.authorizeRegeneration && p.cancelRemission && !/does not exist|no existe/i.test(`${p.authorizeRegeneration.message} ${p.cancelRemission.message}`), JSON.stringify({ a: p.authorizeRegeneration, c: p.cancelRemission }));
    check(`${image}: Pagos 019 function fn_destino_asignacion_pago_disponible is executable by the Hub role and returns a boolean`, p.pagos?.destino?.ok === true && typeof p.pagos.destino.rows[0].safe === 'boolean', JSON.stringify(p.pagos?.destino));
    check(`${image}: Pagos 017 eligibility function answers`, p.pagos?.elegibilidad?.ok === true, JSON.stringify(p.pagos?.elegibilidad));
    check(`${image}: the Hub role CANNOT start a recovery owner (that entry belongs to n8n_app): permission denied`, p.pagos?.sinPrivilegioDeEscritura?.ok === false && p.pagos.sinPrivilegioDeEscritura.code === '42501', JSON.stringify(p.pagos?.sinPrivilegioDeEscritura));
  }
  console.log(JSON.stringify({ result: 'HUB_ON_JOINT_DB_PASS', checks: results.length, probeTargets: base, results }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ result: 'HUB_ON_JOINT_DB_FAIL', failedCheck: error.check ?? null, message: String(error.message).slice(0, 300), results: results.filter(r => !r.pass) }, null, 2));
  process.exitCode = 1;
}
