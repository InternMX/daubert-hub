import { createRequire } from 'node:module';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaterpillarReprocessWebhookClient } from '../src/automations/remisiones-caterpillar/caterpillar-reprocess-webhook.client';

// Offline evidence for the PRODUCTION cutover package (016): nothing here connects to PostgreSQL, n8n or any file outside the repository.
// It proves the correspondence between (1) the generated PROD migration, (2) the PROD workflow candidate and (3) the Hub contract.
const root = resolve(__dirname, '../../..');
const load = createRequire(resolve(root, 'scripts', 'x.cjs'));
const generator = load('./generate-caterpillar-016-prod.cjs') as {
  render: () => Record<string, string>; functionBodies: (sql: string) => Map<string, string>; toProd: (text: string) => string; md5: (text: string) => string;
  P016: string; LEGACY_PINS: string[][];
};
const prodPrepare = createRequire(resolve(root, 'n8n/workflows/remisiones-caterpillar/candidate-016-prod/x.cjs'))('./prepare-prod.cjs') as {
  build: (prod: Workflow, full: Workflow) => Workflow; rewriteConnections: (c: Connections) => Connections;
  compareWorkflows: (a: Workflow, b: Workflow) => { parameters: unknown[]; connections: { onlyReference: string[]; onlyExported: string[] }; credentials: unknown[]; flags: unknown[] }; OUTPUT_FILE: string; PROD_FILE: string; FULL_FILE: string; LOGIC_FROM_FULL: string[]; NEW_FROM_FULL: string[];
  GATE_NODE: string; PROD_GATE_NODE: string; DROPPED_PROD_NODES: string[]; WORKER_CREDENTIAL: unknown;
};
const inspect = createRequire(resolve(root, 'apps/api/scripts/x.cjs'))('./caterpillar-016-prod-inspect.cjs') as {
  parseBlocks: (text: string) => Array<{ name: string; sql: string }>; assertReadOnly: (blocks: Array<{ name: string; sql: string }>) => void; SQL_FILE: string;
  resolveConnection: (env: Record<string, string | undefined>, flags: string[]) => { host: string; port: number; database: string; user: string; password: string; options: string };
};

type Node = { id?: string; name: string; type: string; disabled?: boolean; notes?: string; credentials?: unknown; position: number[]; parameters: Record<string, unknown> };
type Connections = Record<string, { main: Array<Array<{ node: string }>> }>;
type Workflow = { id?: string; name: string; active: boolean; nodes: Node[]; connections: Connections };
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Workflow;
const dir = resolve(root, 'database/migrations/daubert_global');
const read = (name: string) => fs.readFileSync(resolve(dir, name), 'utf8').replace(/\r\n/g, '\n');
const prod = readJson(prodPrepare.PROD_FILE), full = readJson(prodPrepare.FULL_FILE), candidate = readJson(prodPrepare.OUTPUT_FILE);
const node = (w: Workflow, name: string) => w.nodes.find(n => n.name === name)!;
const edges = (w: Workflow) => new Set(Object.entries(w.connections).flatMap(([from, v]) => v.main.flatMap((outs, i) => outs.map(t => `${from} [${i}] -> ${t.node}`))));
const rendered = generator.render();
const upSql = rendered[`${generator.P016}.up.sql`]!;
const testUp = read('20261022_015_caterpillar_atomic_admission_test.up.sql');

describe('PROD migration 016 is the validated TEST logic, generated and pinned', () => {
  it('committed files equal what the generator renders from the TEST sources (no hand edits)', () => {
    for (const [name, text] of Object.entries(rendered)) expect(read(name), name).toBe(text);
  });
  it('contains no TEST database, role, function name or wording', () => {
    for (const text of Object.values(rendered)) expect(text).not.toMatch(/daubert_hub_test|n8n_cat_test|_caterpillar_test|\bTEST\b/);
    expect(upSql).toContain("current_database()<>'daubert_global'");
    expect(upSql).toContain('n8n_cat_prod');
  });
  it('every function body equals the validated TEST body (015, with the 017 reprocess gate and authorize function) except the documented substitutions', () => {
    const regenerationUp = read('20261024_017_caterpillar_regeneration_test.up.sql');
    const reprocessStart = regenerationUp.indexOf('$fn$', regenerationUp.indexOf('CREATE OR REPLACE FUNCTION ops.fn_reprocesar_reservar_caterpillar_test')) + 4;
    const testBodies = generator.functionBodies(testUp);
    testBodies.set('ops.fn_reprocesar_reservar_caterpillar_test', regenerationUp.slice(reprocessStart, regenerationUp.indexOf('$fn$', reprocessStart)));
    for (const [name, body] of generator.functionBodies(regenerationUp)) testBodies.set(name, body);
    const prodBodies = generator.functionBodies(upSql);
    expect(prodBodies.size).toBe(10);
    expect(testBodies.size).toBe(10);
    for (const [name, body] of testBodies) {
      const prodName = name.replace('_caterpillar_test', '_caterpillar');
      expect(prodBodies.get(prodName), prodName).toBe(generator.toProd(body));
    }
  });
  it('production gets the commercial regeneration pieces and requires formal cancellation (013) first', () => {
    expect(upSql).toContain('CREATE TABLE operacion.autorizaciones_regeneracion_caterpillar');
    expect(upSql).toContain('GRANT SELECT ON operacion.autorizaciones_regeneracion_caterpillar TO %I');
    expect(upSql).toContain("v_role := 'daubert_hub_app'");
    expect(upSql).toContain('migration 013');
    expect(rendered[`${generator.P016}.precheck.sql`]).toContain('migration 013');
    expect(rendered[`${generator.P016}.postcheck.sql`]).toContain('015 authorize privilege drift'.replace('015', '016'));
    expect(rendered[`${generator.P016}.down.sql`]).toContain('regeneration authorizations exist; rollback refused');
  });
  it('the committed postcheck pins the md5 of the rendered bodies and the five validated legacy bodies', () => {
    const bodies = generator.functionBodies(upSql);
    const post = rendered[`${generator.P016}.postcheck.sql`]!;
    for (const [name, body] of bodies) expect(post, name).toContain(`'${generator.md5(body)}'`);
    const pre = rendered[`${generator.P016}.precheck.sql`]!;
    for (const [signature, hash] of generator.LEGACY_PINS) expect(pre).toContain(`('${signature}','${hash}')`);
    expect(upSql).toContain('016 legacy function body drift');
  });
  it('creates the snapshot column, requires no PROCESANDO, never grants legacy EXECUTE and never touches data', () => {
    expect(upSql).toContain('ALTER TABLE core.documentos ADD COLUMN caterpillar_admission JSONB NULL;');
    // Outside the function bodies (which only run when the worker calls them) the migration contains no data statement at all.
    expect(upSql.replace(/\$fn\$[\s\S]*?\$fn\$/g, '')).not.toMatch(/^\s*(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\.|TRUNCATE\s+TABLE|DROP\s+TABLE)\b/im);
    expect(upSql).not.toMatch(/GRANT EXECUTE ON FUNCTION (ops\.fn_crear_ejecucion_automatizacion|operacion\.reservar_folios|operacion\.fn_registrar_remision_generada|ops\.fn_finalizar_ejecucion_automatizacion|ops\.fn_registrar_fallo_ejecucion)/);
    expect(upSql).toMatch(/no PROCESANDO Caterpillar execution/);
    expect(upSql).toMatch(/dedicated role must not hold legacy EXECUTE/);
    expect(rendered[`${generator.P016}.down.sql`]).toContain('rollback refused');
    expect(rendered[`${generator.P016}.down.sql`]).not.toMatch(/GRANT EXECUTE/);
  });
});

describe('PROD workflow candidate', () => {
  const calls = (w: Workflow) => w.nodes.filter(n => n.type.endsWith('.postgres')).flatMap(n => {
    const query = String(n.parameters.query);
    return [...query.matchAll(/(?:core|ops|operacion)\.fn_[a-z_0-9]+|operacion\.reservar_folios_para_ejecucion/g)].map(m => ({ node: n.name, fn: m[0], query }));
  });
  const created = new Set([...upSql.matchAll(/CREATE FUNCTION ((?:ops|operacion)\.[a-z_0-9]+)\(/g)].map(m => m[1]!));
  const readOnlyResolvers = new Set(['core.fn_crear_o_resolver_documento', 'ops.fn_resolver_ejecucion_para_reproceso']);
  const legacy = ['fn_crear_ejecucion_automatizacion', 'reservar_folios_para_ejecucion', 'fn_registrar_remision_generada', 'fn_finalizar_ejecucion_automatizacion', 'fn_registrar_fallo_ejecucion'];

  it('is regenerable from the repository PROD export and FULL, inactive, new (no id) and with no automatic trigger enabled', () => {
    expect(prodPrepare.build(prod, full)).toEqual(candidate);
    expect(candidate.active).toBe(false);
    expect(candidate).not.toHaveProperty('id');
    expect(node(candidate, 'Schedule Trigger').disabled).toBe(true);
    expect(node(candidate, 'Webhook Reproceso CAT (PROD)').disabled).toBe(true);
    expect(node(candidate, 'Webhook Reproceso CAT (PROD)').parameters.path).toBe(node(prod, 'Webhook Reproceso CAT (PROD)').parameters.path);
  });
  it('keeps every environment node byte-identical to PROD and replaces only the validated logic', () => {
    const regenerationEntry = createRequire(resolve(root, 'n8n/workflows/remisiones-caterpillar/candidate-015/x.cjs'))('./regeneration-entry.cjs') as { ENTRY_NODE: string; ELIGIBILITY_NODE: string; patchNode: (n: Node) => Node };
    const replaced = new Set([...prodPrepare.LOGIC_FROM_FULL, prodPrepare.PROD_GATE_NODE, ...prodPrepare.DROPPED_PROD_NODES, regenerationEntry.ENTRY_NODE, regenerationEntry.ELIGIBILITY_NODE]);
    for (const name of [regenerationEntry.ENTRY_NODE, regenerationEntry.ELIGIBILITY_NODE]) expect(node(candidate, name).parameters, name).toEqual(regenerationEntry.patchNode(structuredClone(node(prod, name))).parameters);
    for (const prodNode of prod.nodes.filter(n => !replaced.has(n.name) && !n.type.endsWith('.stickyNote'))) {
      const kept = node(candidate, prodNode.name);
      expect(kept, prodNode.name).toBeTruthy();
      expect(kept.parameters, prodNode.name).toEqual(prodNode.parameters);
    }
    const names = new Set(candidate.nodes.map(n => n.name));
    for (const name of [...prodPrepare.NEW_FROM_FULL, prodPrepare.GATE_NODE]) expect(names.has(name), name).toBe(true);
    for (const name of [...prodPrepare.DROPPED_PROD_NODES, prodPrepare.PROD_GATE_NODE, 'Filtrar solo pruebas locales1']) expect(names.has(name), name).toBe(false);
    for (const name of prodPrepare.LOGIC_FROM_FULL) expect(JSON.stringify(node(candidate, name).parameters), name).toBe(JSON.stringify(node(full, name).parameters).split('_caterpillar_test').join('_caterpillar').split('CAT_TEST_').join('CAT_'));
  });
  it('keeps the production process gating (P2, P5, P6 only) and the production route table', () => {
    const detector = String(node(candidate, 'Detectar archivos CAT1').parameters.jsCode);
    expect(detector).toMatch(/PROCESOS_HABILITADOS_PROD = new Set\(\[\s*"CATERPILLAR_P2\|P2\|",\s*"CAT_P3_P4_P5_P6\|P5\|",\s*"CAT_P3_P4_P5_P6\|P6\|"\s*\]\)/);
    expect(detector).toContain('const ACTIVAR_APARTADO_PRUEBAS = false;');
    expect(detector).toContain('const ACTIVAR_RUTAS_REALES = true;');
    expect(String(node(candidate, 'Filtrar archivos nuevos').parameters.jsCode)).toContain('2026-09-22T00:00:00-06:00');
  });
  it('carries no TEST path, credential, sandbox, failure injection or test-only SQL', () => {
    const text = JSON.stringify(candidate);
    for (const forbidden of [/Dropbox\\\\\\\\Pruebas\\\\\\\\REMISIONES/, /cat-test/i, /daubert_hub_test/, /_caterpillar_test/, /n8n_cat_test/, /CAT_TEST/, /HUB_TEST/, /CAT_FAILURE/, /exit 1/, /__catTest/, /catConfinedPath/, /IO_HOLD/, /NOT_APPROVED/, /\bFAILURE\b/])
      expect(text).not.toMatch(forbidden);
    expect(text).not.toMatch(/xK9CGscXx6kKLZTi|9Ngnrpi16b6GtOAX|0hUrQ64tpD2yI2MZ/);
    // Production resolves documents for its own source company (122), not the TEST one (1207).
    expect(text).not.toContain('1207');
    expect(String((node(candidate, 'Resolver documento origen PG').parameters.options as { queryReplacement: string }).queryReplacement)).toMatch(/\[\s*122,/);
  });
  it('uses only the dedicated credential for PostgreSQL and the existing PROD Header Auth for the webhook', () => {
    for (const n of candidate.nodes.filter(x => x.type.endsWith('.postgres'))) expect(n.credentials, n.name).toEqual(prodPrepare.WORKER_CREDENTIAL);
    expect(node(candidate, 'Webhook Reproceso CAT (PROD)').credentials).toEqual(node(prod, 'Webhook Reproceso CAT (PROD)').credentials);
    for (const n of candidate.nodes.filter(x => x.credentials && !x.type.endsWith('.postgres') && !x.type.endsWith('.webhook'))) expect(n.credentials, n.name).toEqual(node(prod, n.name).credentials);
  });
  it('calls only functions created by 016 or the two read-only resolvers, with matching argument types, and never a legacy function', () => {
    const used = calls(candidate);
    expect(used.length).toBeGreaterThanOrEqual(7);
    for (const { fn, node: name, query } of used) {
      expect(legacy.some(l => fn.endsWith(l)), `${name} calls legacy ${fn}`).toBe(false);
      expect(created.has(fn) || readOnlyResolvers.has(fn), `${name}: ${fn} is neither created by 016 nor an allowed resolver`).toBe(true);
      if (created.has(fn)) {
        const signature = new RegExp(`CREATE FUNCTION ${fn.replace('.', '\\.')}\\(([^)]*)\\)`).exec(upSql)![1]!;
        const declared = signature.split(',').map(a => a.trim().split(/\s+/)[1]);
        const casts = [...query.matchAll(/\$(\d)::([a-z]+)/g)].filter((m, i, all) => all.findIndex(x => x[1] === m[1]) === i).sort((a, b) => Number(a[1]) - Number(b[1])).map(m => m[2]);
        if (!query.includes('ternary') && !query.startsWith('=')) expect(casts.slice(0, declared.length), `${name} argument types`).toEqual(declared.slice(0, casts.length));
      }
    }
    for (const fn of ['ops.fn_guardar_snapshot_caterpillar', 'operacion.fn_registrar_remision_caterpillar', 'ops.fn_finalizar_caterpillar', 'ops.fn_admitir_reservar_caterpillar', 'ops.fn_reprocesar_reservar_caterpillar'])
      expect(used.some(u => u.fn === fn || u.query.includes(fn)), fn).toBe(true);
  });
  it('rewires the validated 015 topology onto PROD and leaves no dangling or TEST-only edge', () => {
    const wanted = edges({ ...full, connections: prodPrepare.rewriteConnections(full.connections) } as Workflow);
    expect(edges(candidate)).toEqual(wanted);
    const names = new Set(candidate.nodes.map(n => n.name));
    for (const [from, v] of Object.entries(candidate.connections)) { expect(names.has(from), from).toBe(true); for (const out of v.main) for (const t of out) expect(names.has(t.node), `${from} -> ${t.node}`).toBe(true); }
    const prodOnly = [...edges(prod)].filter(e => !edges(candidate).has(e)).sort();
    expect(prodOnly).toEqual([
      'Crear o recuperar ejecución PG [0] -> Propagar ejecución PG', 'Normalizar datos CAT [0] -> Preparar reserva folios PG',
      'Preparar error CAT [0] -> Registrar fallo PG', 'Propagar documento origen PG [0] -> Crear o recuperar ejecución PG', 'Propagar ejecución PG [0] -> ¿Es reproceso?',
      'Reservar folios PG [0] -> Asignar folios PG CAT', '¿Es reproceso? [1] -> ¿Procesar según PG?', '¿Estado de reproceso reconocido? [1] -> Responder reproceso estado inesperado',
      '¿Procesar según PG? [0] -> Leer catálogo Caterpillar', '¿Procesar según PG? [1] -> Loop Over Items', 'Responder reproceso aceptado [0] -> ¿Procesar según PG?'
    ].sort());
  });
  it('the reprocess answer of the candidate is accepted by the Hub client (REPROCESS_CREATED / ALREADY_PROCESSING / ALREADY_REPROCESSED)', async () => {
    const map = new Function('$input', `${String(node(candidate, 'Mapear resultado creación reproceso CAT').parameters.jsCode)}`);
    const responder = String(node(candidate, 'Responder reproceso aceptado').parameters.responseBody).replace(/^=\{\{/, '').replace(/\}\}$/, '');
    for (const [reason, row, status] of [['REPROCESS_ACQUIRED', { puede_emitir: true, ejecucion_id: '900' }, 'REPROCESS_CREATED'], ['REPROCESS_IN_PROGRESS', { puede_emitir: false, ejecucion_ajena_id: '901', admision_decision: 'BLOCK' }, 'ALREADY_PROCESSING'],
      ['ALREADY_REPROCESSED', { puede_emitir: false, ejecucion_ajena_id: '901', admision_decision: 'BLOCK' }, 'ALREADY_REPROCESSED']] as const) {
      const mapped = (map({ first: () => ({ json: { ...row, admision_reason: reason, reproceso_de_id: '12' } }) }) as Array<{ json: Record<string, unknown> }>)[0]!.json;
      const body = new Function('$json', `return ${responder}`)(mapped) as unknown;
      const original = global.fetch;
      global.fetch = (async () => ({ status: 202, ok: true, json: async () => JSON.parse(JSON.stringify(body)) })) as never;
      try {
        const client = new CaterpillarReprocessWebhookClient({ get: () => ({ url: 'http://localhost:5678/webhook/cat-reprocess', token: 't' }) } as never);
        expect(await client.triggerReprocess('12', 'motivo')).toMatchObject({ kind: 'ACCEPTED', status });
      } finally { global.fetch = original; }
    }
  });
});

describe('PROD inspection and role template', () => {
  it('the inspection file can only read and every block is a single SELECT', () => {
    const blocks = inspect.parseBlocks(fs.readFileSync(inspect.SQL_FILE, 'utf8'));
    expect(blocks.length).toBeGreaterThanOrEqual(20);
    expect(() => inspect.assertReadOnly(blocks)).not.toThrow();
    expect(() => inspect.assertReadOnly([{ name: 'bad', sql: 'DELETE FROM core.documentos' }])).toThrow();
    expect(() => inspect.assertReadOnly([{ name: 'bad', sql: 'SELECT 1; DROP TABLE x' }])).toThrow();
  });
  it('the worker role template is guarded, takes the password from a psql variable and grants no legacy function or table', () => {
    const template = read('20261024_016_caterpillar_worker_role_prod.template.sql');
    expect(template).toContain("current_database() <> 'daubert_global'");
    expect(template).toContain("PASSWORD :'worker_password'");
    expect(template).not.toMatch(/PASSWORD '[^:]/);
    expect(template).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL)/i);
    expect(template).not.toMatch(/GRANT EXECUTE ON FUNCTION (ops\.fn_crear_ejecucion_automatizacion|operacion\.reservar_folios|operacion\.fn_registrar_remision_generada|ops\.fn_finalizar_ejecucion_automatizacion|ops\.fn_registrar_fallo_ejecucion)/);
  });
});

describe('PROD inspection connection guard', () => {
  const test = 'postgres://postgres:s3cret-pw@localhost:5432/daubert_hub_test';
  const reuse = ['--reuse-postgres-from-test-url'];
  it('reuses the postgres account only for daubert_global on localhost:5432, read-only from the first statement, without leaking the password', () => {
    const config = inspect.resolveConnection({ TEST_DATABASE_URL_MIGRATOR: test }, reuse);
    expect(config).toMatchObject({ host: 'localhost', port: 5432, database: 'daubert_global', user: 'postgres' });
    expect(config.options).toContain('default_transaction_read_only=on');
    expect(config.password).toBe('s3cret-pw');
    for (const bad of [
      ['postgres://postgres:s3cret-pw@db.example.com:5432/daubert_hub_test', 'localhost'],
      ['postgres://postgres:s3cret-pw@localhost:5433/daubert_hub_test', 'localhost'],
      ['postgres://other:s3cret-pw@localhost:5432/daubert_hub_test', 'postgres account'],
      ['postgres://postgres:s3cret-pw@localhost:5432/daubert_global', 'daubert_hub_test'],
      ['postgres://postgres:s3cret-pw@localhost:5432/daubert_hub_test?options=-c%20default_transaction_read_only%3Doff', 'query parameters']
    ] as const) {
      let message = '';
      try { inspect.resolveConnection({ TEST_DATABASE_URL_MIGRATOR: bad[0] }, reuse); } catch (error) { message = (error as Error).message; }
      expect(message, bad[0]).toContain(bad[1]);
      expect(message).not.toContain('s3cret-pw');
    }
  });
  it('the dedicated read-only variable must name daubert_global, differ from the TEST url and cannot be mixed with self-test', () => {
    expect(inspect.resolveConnection({ PROD_DATABASE_URL_READONLY: 'postgres://ro:pw@localhost:5432/daubert_global' }, []).database).toBe('daubert_global');
    expect(() => inspect.resolveConnection({ PROD_DATABASE_URL_READONLY: 'postgres://ro:pw@localhost:5432/daubert_hub_test' }, [])).toThrow('daubert_global');
    expect(() => inspect.resolveConnection({ TEST_DATABASE_URL_MIGRATOR: test }, ['--self-test', ...reuse])).toThrow('mutually exclusive');
    expect(() => inspect.resolveConnection({}, [])).toThrow('is not set');
  });
  it('rejects side-effect functions, row locks and writes even when disguised as a SELECT', () => {
    for (const sql of ["SELECT pg_advisory_lock(1)", "SELECT nextval('operacion.reservas_folios_reserva_id_seq')", "SELECT pg_terminate_backend(1)", "SELECT set_config('x','y',false)",
      "SELECT pg_read_file('x')", "SELECT lo_import('x')", "SELECT * FROM core.documentos FOR UPDATE", "SELECT * INTO t FROM core.documentos", "WITH x AS (DELETE FROM core.documentos RETURNING 1) SELECT * FROM x"])
      expect(() => inspect.assertReadOnly([{ name: 'bad', sql }]), sql).toThrow();
  });
});

describe('PROD candidate built from the LIVE production export', () => {
  const liveProd = readJson(prodPrepare.PROD_FILE);
  const legacyCopy = readJson(resolve(root, 'n8n/workflows/remisiones-caterpillar/prod/workflow.json'));
  const candidateText = JSON.stringify(candidate);

  it('has the real production folders and routes and no placeholder left, so --require-live is satisfied', () => {
    expect(candidateText).not.toContain('<WINDOWS_USER>');
    expect(candidateText).toContain('HERRAMIENTAS AUTOMATIZACION');
    expect(candidateText).toContain('SOLICITUD DE MATERIAL');
    expect(String(node(candidate, 'Detectar archivos CAT1').parameters.jsCode)).toBe(String(node(liveProd, 'Detectar archivos CAT1').parameters.jsCode));
  });
  it('the live export matches the older sanitized copy node by node (so the five PROD "differences" of the first comparison were only the sanitizer)', () => {
    // The sanitized copy only differs by the Windows user inside the paths; credential ids are ignored by the comparison.
    const sep = String.fromCharCode(92).repeat(4); // the code text holds doubled backslashes and JSON doubles them again
    const asSanitized = JSON.parse(JSON.stringify(liveProd).split(`C:${sep}Users${sep}06${sep}`).join(`C:${sep}Users${sep}<WINDOWS_USER>${sep}`)) as Workflow;
    const comparison = prodPrepare.compareWorkflows(legacyCopy, asSanitized);
    expect(comparison.parameters).toEqual([]);
    expect(comparison.connections).toEqual({ onlyReference: [], onlyExported: [] });
  });
  it('keeps the live webhook (path, Header Auth reference), schedule and active flag semantics: inactive candidate, nothing automatic enabled, no workflow id, own webhook id', () => {
    const webhook = node(candidate, 'Webhook Reproceso CAT (PROD)');
    expect(webhook.parameters.path).toBe('cat-reprocess');
    expect(webhook.credentials).toEqual(node(liveProd, 'Webhook Reproceso CAT (PROD)').credentials);
    expect(candidate.active).toBe(false);
    expect(candidate).not.toHaveProperty('id');
    // Only the webhook node carries a webhookId: its own, fixed and DIFFERENT from the live workflow's (n8n 2.27.4 serves /webhook/cat-reprocess only for a webhook that has one).
    const withWebhookId = (candidate.nodes as Array<{ name: string; webhookId?: string }>).filter(n => n.webhookId).map(n => n.name);
    expect(withWebhookId).toEqual(['Webhook Reproceso CAT (PROD)']);
    expect((webhook as { webhookId?: string }).webhookId).toMatch(/^[0-9a-f-]{36}$/);
    expect((webhook as { webhookId?: string }).webhookId).not.toBe((node(liveProd, 'Webhook Reproceso CAT (PROD)') as { webhookId?: string }).webhookId);
    expect(node(candidate, 'Schedule Trigger').parameters).toEqual(node(liveProd, 'Schedule Trigger').parameters);
    expect(node(candidate, 'Schedule Trigger').disabled).toBe(true);
    expect(webhook.disabled).toBe(true);
  });
  it('the comparison tool tells cosmetic editor rewrites apart from real changes, and sees edges, credential names and flags', () => {
    const edited = JSON.parse(JSON.stringify(full)) as Workflow;
    const reserve = node(edited, 'Reservar folios PG');
    reserve.parameters.query = String(reserve.parameters.query).replace(/^=/, '').replace('SELECT * FROM', 'SELECT  *\n  FROM');
    const real = node(edited, 'Finalizar ejecución PG');
    real.parameters.query = String(real.parameters.query).replace('fn_finalizar_caterpillar_test', 'fn_finalizar_ejecucion_automatizacion');
    const result = prodPrepare.compareWorkflows(full, edited) as unknown as { parameters: Array<{ node: string; kind: string }> };
    expect(result.parameters.find(p => p.node === 'Reservar folios PG')?.kind).toMatch(/^cosmetic/);
    expect(result.parameters.find(p => p.node === 'Finalizar ejecución PG')?.kind).toBe('parameters differ');
  });
});
