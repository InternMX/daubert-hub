#!/usr/bin/env node
'use strict';

// Offline generator of the PRODUCTION migration 016 from the VALIDATED TEST migrations 014 + 015. It never connects to a database and never applies anything.
//   node scripts/generate-caterpillar-016-prod.cjs          -> writes the four 016 files into database/migrations/daubert_global
//   node scripts/generate-caterpillar-016-prod.cjs --check  -> exits 1 if the committed files differ from what the TEST sources generate
// The logic (gate, reprocess, snapshot, ownership, wrappers) is NOT rewritten: it is the TEST text with only these documented deltas, so the
// PROD functions cannot drift from what was validated in TEST. Deltas: database name, dedicated worker role, function names without "_test",
// 014 column creation merged in, legacy-grant contract inverted (a NEW dedicated PROD role never held legacy EXECUTE), legacy body pins,
// message wording, and body fingerprints recomputed from the rendered text.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, '..', 'database', 'migrations', 'daubert_global');
const T015 = '20261022_015_caterpillar_atomic_admission_test';
const P016 = '20261024_016_caterpillar_atomic_admission_prod';
const PROD_DATABASE = 'daubert_global';
const PROD_WORKER_ROLE = 'n8n_cat_prod';

// Pins of the five legacy functions the protected wrappers delegate to, as validated in TEST (md5 of prosrc without CR).
const LEGACY_PINS = [
  ['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)', '929939dcc7cd3ef0e09b7b2a868b9616'],
  ['operacion.reservar_folios_para_ejecucion(bigint,text,integer)', '26719b6e9d322575673348111bc1279e'],
  ['operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)', '6efa9ced75530e72a3b79825c86ba3db'],
  ['ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)', 'faf128cb79f25abbf723014a41165822'],
  ['ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)', 'a2d6151b712cf07836e49f0cbf4e8948']
];

const read = name => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const md5 = text => crypto.createHash('md5').update(text.replace(/\r/g, '')).digest('hex');
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceOnce(text, search, replacement, label) {
  const hits = typeof search === 'string' ? text.split(search).length - 1 : (text.match(new RegExp(search.source, search.flags.replace('g', ''))) ? 1 : 0);
  if (hits !== 1) throw new Error(`Unexpected TEST source shape (${label}); review the generator`);
  return text.replace(search, () => replacement);
}

// prosrc of every "CREATE FUNCTION schema.name" that uses $fn$ quoting, keyed by qualified name.
function functionBodies(sql) {
  const bodies = new Map();
  for (const match of sql.matchAll(/CREATE FUNCTION ([a-z_]+\.[a-z_0-9]+)\b[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g)) bodies.set(match[1], match[2]);
  return bodies;
}

// Rows ('signature','md5',...) -> recomputed from the given SQL text. Used on the TEST text to prove the method reproduces the TEST pins.
function repin(text, sourceSql) {
  const bodies = functionBodies(sourceSql);
  return text.replace(/\('([a-z_]+\.[a-z_0-9]+)\(([^']*)\)','([0-9a-f]{32})'/g, (whole, name, args, hash) => {
    if (!bodies.has(name)) throw new Error(`No rendered body for ${name}`);
    return `('${name}(${args})','${md5(bodies.get(name))}'`;
  });
}

function toProd(text) {
  let out = text;
  out = out.split('daubert_hub_test').join(PROD_DATABASE);
  out = out.split('n8n_cat_test').join(PROD_WORKER_ROLE);
  out = out.split('_caterpillar_test').join('_caterpillar');
  out = out.split('CAT_ATOMIC_TEST_ONLY').join('CAT_ATOMIC_PROD_ONLY');
  out = out.replace(/'015 /g, "'016 ").replace(/PRECHECK_015_PASS/g, 'PRECHECK_016_PASS').replace(/POSTCHECK_015_PASS/g, 'POSTCHECK_016_PASS');
  out = out.split('exclusively in TEST').join(`exclusively in ${PROD_DATABASE}`).split('TEST postcheck only').join('production postcheck only').split('TEST rollback only').join('production rollback only');
  out = out.split('dedicated TEST role').join('dedicated production role').split('review TEST role').join('review production role').split('unsafe/missing TEST role').join('unsafe/missing production role');
  return out;
}

const PIN_ENFORCEMENT = `  IF EXISTS(SELECT 1 FROM (VALUES
${LEGACY_PINS.map(([signature, hash]) => `    ('${signature}','${hash}')`).join(',\n')}
  ) pinned(signature,body_hash) WHERE to_regprocedure(pinned.signature) IS NULL
    OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure(pinned.signature)),chr(13),''))<>pinned.body_hash) THEN
    RAISE EXCEPTION '016 legacy function body drift: the wrappers were validated against different legacy definitions; review required'; END IF;
`;

function buildUp(t015) {
  let up = t015;
  up = replaceOnce(up, /^-- PREPARED ONLY, NOT APPLIED\. TEST-only wrappers[^\n]*\n/, `-- PREPARED ONLY, NOT APPLIED. PRODUCTION (${PROD_DATABASE}) migration 016 = validated 014 + 015 (proven in the test database), generated by scripts/generate-caterpillar-016-prod.cjs.\n-- Do not edit by hand: regenerate. Creates the snapshot column and protected wrappers; no backfill, no allocator or table changes, no data touched.\n`, 'header');
  // 014 is merged: the column must not exist yet; the idle check cannot reference it before it is created.
  up = replaceOnce(up, /IF NOT EXISTS\(SELECT 1 FROM pg_attribute WHERE attrelid='core\.documentos'::regclass AND attname='caterpillar_admission' AND atttypid='jsonb'::regtype AND NOT attisdropped\) THEN\s*RAISE EXCEPTION '015 requires 014'; END IF;/,
    `IF to_regclass('core.documentos') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('core.documentos') AND relkind='r' AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('core.documentos') AND attname='caterpillar_admission' AND NOT attisdropped) THEN
    RAISE EXCEPTION '015 requires core.documentos owned by postgres without the snapshot column (refusing replacement)'; END IF;`, 'requires 014');
  up = replaceOnce(up, /IF NOT EXISTS\(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode\(p\.proacl\) acl[\s\S]*?THEN RAISE EXCEPTION '015 requires reviewed direct legacy grants for reversible cutover'; END IF;/,
    `IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION '015 legacy function missing'; END IF;
    IF has_function_privilege('n8n_cat_test',to_regprocedure(signature),'EXECUTE') THEN RAISE EXCEPTION '015 dedicated role must not hold legacy EXECUTE (direct, PUBLIC or membership)'; END IF;`, 'legacy grants');
  up = replaceOnce(up, /\(e\.estado='PROCESANDO' OR d\.caterpillar_admission IS NOT NULL\)\) THEN RAISE EXCEPTION '015 requires a reviewed idle cutover; no snapshot-backed executions'/,
    `e.estado='PROCESANDO') THEN RAISE EXCEPTION '015 requires a reviewed idle cutover; no PROCESANDO Caterpillar execution'`, 'idle');
  up = replaceOnce(up, "END $guard$;\n", `END $guard$;\n${PIN_ENFORCEMENT_FOR_UP}\nALTER TABLE core.documentos ADD COLUMN caterpillar_admission JSONB NULL;\n`, 'column');
  return up;
}
// Pins are enforced inside a DO block of their own (the guard block above is closed by then).
const PIN_ENFORCEMENT_FOR_UP = `DO $pins$
BEGIN
${PIN_ENFORCEMENT}END $pins$;`;

function buildPrecheck(p) {
  let pre = p;
  pre = replaceOnce(pre, /IF NOT EXISTS\(SELECT 1 FROM pg_attribute WHERE attrelid='core\.documentos'::regclass AND attname='caterpillar_admission' AND atttypid='jsonb'::regtype AND NOT attisdropped\) THEN RAISE EXCEPTION '015 requires 014'; END IF;/,
    `IF to_regclass('core.documentos') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('core.documentos') AND relkind='r' AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('core.documentos') AND attname='caterpillar_admission' AND NOT attisdropped) THEN
    RAISE EXCEPTION '015 requires core.documentos owned by postgres without the snapshot column (use postcheck if already applied)'; END IF;`, 'pre 014');
  pre = replaceOnce(pre, /IF NOT EXISTS\(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode\(p\.proacl\) acl WHERE p\.oid=to_regprocedure\(f\)[\s\S]*?THEN RAISE EXCEPTION '015 missing\/review-required legacy contract'; END IF;/,
    `IF to_regprocedure(f) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f) AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION '015 missing/review-required legacy contract'; END IF;
    IF has_function_privilege('n8n_cat_test',to_regprocedure(f),'EXECUTE') THEN RAISE EXCEPTION '015 dedicated role must not hold legacy EXECUTE (direct, PUBLIC or membership)'; END IF;`, 'pre legacy');
  pre = replaceOnce(pre, /AND\(e\.estado='PROCESANDO' OR d\.caterpillar_admission IS NOT NULL\)\) THEN RAISE EXCEPTION '015 reviewed idle cutover required'; END IF;/,
    `AND e.estado='PROCESANDO') THEN RAISE EXCEPTION '015 reviewed idle cutover required: no PROCESANDO Caterpillar execution'; END IF;
${UNVERIFIABLE_NAMES_PRECHECK}${PIN_ENFORCEMENT}`, 'pre idle');
  pre = replaceOnce(pre, "SELECT 'PRECHECK_015_PASS' AS result;", `SELECT 'PRECHECK_015_PASS' AS result;
-- Record before/after: the added NULL column is deliberately excluded from the fingerprint.
SELECT count(*) AS documents,md5(COALESCE(string_agg((to_jsonb(d)-'caterpillar_admission')::text,'|' ORDER BY documento_id),'')) AS existing_document_data_fingerprint FROM core.documentos d;`, 'pre pass');
  return pre;
}

// Production data condition. The gate answers REVIEW / HISTORY_UNAVAILABLE for EVERY new program of a company as soon as one of its historical
// Caterpillar documents has a file name it cannot verify (forbidden characters or a non-Excel extension), so such a name must be resolved BEFORE the cutover.
// The precheck uses a close approximation (the helper does not exist yet); the postcheck repeats it with the exact helper the gate uses.
const UNVERIFIABLE_NAMES_PRECHECK = `  IF EXISTS(SELECT 1 FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND (d.nombre_archivo ~ '[\\\\/:*?"<>|[:cntrl:]]' OR upper(btrim(d.nombre_archivo)) !~ '\\.(XLSX|XLSM|XLS)$')) THEN
    RAISE EXCEPTION '015 historical Caterpillar document names cannot be verified by the gate; every admission would be REVIEW (HISTORY_UNAVAILABLE)'; END IF;
`;
const UNVERIFIABLE_NAMES_POSTCHECK = `  IF EXISTS(SELECT 1 FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND d.caterpillar_admission IS NULL AND (d.nombre_archivo ~ '[\\\\/:*?"<>|[:cntrl:]]' OR ops.fn_cat_key_text_015(d.nombre_archivo) !~ '\\.(XLSX|XLSM|XLS)$')) THEN
    RAISE EXCEPTION '015 historical Caterpillar document names cannot be verified by the gate; every admission would be REVIEW (HISTORY_UNAVAILABLE)'; END IF;
END $postcheck$;`;

function buildPostcheck(p) {
  let post = replaceOnce(p, "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_test'", `IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE c.oid=to_regclass('core.documentos') AND c.relkind='r' AND pg_get_userbyid(c.relowner)='postgres'
      AND a.attname='caterpillar_admission' AND NOT a.attisdropped AND a.atttypid='jsonb'::regtype
      AND NOT a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='') THEN RAISE EXCEPTION '015 missing or incompatible snapshot column'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='n8n_cat_test'`, 'postcheck column');
  post = replaceOnce(post, 'END $postcheck$;', UNVERIFIABLE_NAMES_POSTCHECK, 'postcheck end');
  return post;
}

function buildDown(d) {
  let down = d;
  down = replaceOnce(down, /GRANT EXECUTE ON FUNCTION ops\.fn_crear_ejecucion_automatizacion[\s\S]*?TO n8n_cat_test;\n/, `-- The dedicated role never held legacy EXECUTE: nothing to restore. The legacy functions are untouched.
LOCK TABLE core.documentos IN ACCESS EXCLUSIVE MODE;
DO $snapshots$
BEGIN
  IF EXISTS(SELECT 1 FROM core.documentos WHERE caterpillar_admission IS NOT NULL) THEN RAISE EXCEPTION '015 snapshots exist; rollback refused'; END IF;
END $snapshots$;
ALTER TABLE core.documentos DROP COLUMN caterpillar_admission;
`, 'down grant');
  return down;
}

function render() {
  const sources = { up: read(`${T015}.up.sql`), precheck: read(`${T015}.precheck.sql`), postcheck: read(`${T015}.postcheck.sql`), down: read(`${T015}.down.sql`) };
  // Prove the fingerprint method against the validated TEST pins before trusting it for PROD.
  if (repin(sources.postcheck, sources.up) !== sources.postcheck) throw new Error('Fingerprint method does not reproduce the TEST pins');
  const up = toProd(buildUp(sources.up));
  const pre = toProd(buildPrecheck(sources.precheck));
  const post = repin(toProd(buildPostcheck(sources.postcheck)), up);
  const down = repin(toProd(buildDown(sources.down)), up);
  const testToken = /daubert_hub_test|n8n_cat_test|_caterpillar_test|\bTEST\b|_test\b/;
  const leftovers = [up, pre, post, down].flatMap(text => text.split('\n').filter(line => testToken.test(line)));
  if (leftovers.length) throw new Error(`TEST tokens remain in the PROD migration:\n${leftovers.join('\n')}`);
  return { [`${P016}.up.sql`]: up, [`${P016}.precheck.sql`]: pre, [`${P016}.postcheck.sql`]: post, [`${P016}.down.sql`]: down };
}

function main() {
  const rendered = render();
  const check = process.argv.includes('--check');
  let drift = false;
  for (const [name, text] of Object.entries(rendered)) {
    const file = path.join(DIR, name);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (check) { if (current !== text) { drift = true; console.error(`DRIFT ${name}`); } continue; }
    fs.writeFileSync(file, text);
    console.log(`written ${name}`);
  }
  if (check && drift) process.exitCode = 1;
}

module.exports = { render, toProd, repin, functionBodies, md5, P016, PROD_DATABASE, PROD_WORKER_ROLE, LEGACY_PINS };
if (require.main === module) main();
