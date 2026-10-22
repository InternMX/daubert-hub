import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptCaterpillarNormalizedItems } from '../src/automations/remisiones-caterpillar/caterpillar-operational-manifest.adapter';

// Offline structural/pure-body evidence for the 015 candidate. Nothing here imports, activates or executes an n8n workflow
// and nothing connects to PostgreSQL: PostgreSQL behaviour is covered (in memory only) by caterpillar-atomic-admission.spec.ts.
type Item = { json: Record<string, unknown> };
type Node = { id: string; name: string; type: string; disabled?: boolean; credentials?: unknown; parameters: Record<string, unknown> };
type Workflow = { name: string; active: boolean; pinData: unknown; nodes: Node[]; connections: Record<string, { main: Array<Array<{ node: string }>> }> };
const folder = resolve(__dirname, '../../../n8n/workflows/remisiones-caterpillar/candidate-015');
const workflow = JSON.parse(readFileSync(resolve(folder, 'caterpillar-test-015.PROPOSED.BLOCKED.json'), 'utf8')) as Workflow;
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')) as Record<string, Item[]>;
const node = (name: string) => workflow.nodes.find(n => n.name === name)!;
const code = (name: string) => node(name).parameters.jsCode as string;
const hold = 'CAT_TEST_5678_NOT_APPROVED';
const queryReplacement = (n: Node) => String((n.parameters.options as { queryReplacement: string }).queryReplacement);

function run(name: string, input: Item[], lookups: Record<string, Item> = {}, executionId = 'W1') {
  const lookup = (n: string) => {
    const item = lookups[n];
    if (!item) throw new Error('No data for ' + n);
    return { first: () => item, all: () => [item] };
  };
  return new Function('$input', '$', '$execution', 'require', code(name))({ all: () => input, first: () => input[0] }, lookup, { id: executionId },
    (m: string) => { if (m === 'path') return path; throw new Error('I/O forbidden'); }) as Item[];
}
const normal = fixture.normal!;
const adapted = (items: Item[]) => items.map(i => ({ json: { ...i.json, cat_operational_content: adaptCaterpillarNormalizedItems(items) } }));
const docContext = (extra: Record<string, unknown> = {}) => ({ json: { documento_origen_id: '41', file_name: 'PROG.xlsx', mode: undefined, ...extra } });
const prep = (items: Item[], extra: Record<string, unknown> = {}) => run('Preparar reserva folios PG', items, { 'Propagar documento origen PG': docContext(extra) })[0]!.json;
const gateRow = (change: Record<string, unknown> = {}) => ({ json: { decision: 'ADMIT', reason: 'ACQUIRED', can_emit: true, worker_id: 'W1', ejecucion_id: '900',
  reserva_id: '70', folio_inicial: '1000', folio_final: '1001', cantidad: 2, legacy_unverified: 0, ...change } });
const admit = (row: Item, preparation: Record<string, unknown>, executionId = 'W1') =>
  run('Propagar admisión CAT', [row], { 'Preparar reserva folios PG': { json: preparation }, 'Propagar documento origen PG': docContext() }, executionId)[0]!.json;

const entries = ['Schedule Trigger', 'When clicking “Execute workflow”', 'Webhook Reproceso CAT (TEST)'].filter(n => workflow.connections[n]);
  const reach = (without: string) => {
    const seen = new Set<string>(); const queue = [...entries];
    while (queue.length) { const n = queue.shift()!; if (seen.has(n) || n === without) continue; seen.add(n);
      for (const t of (workflow.connections[n]?.main ?? []).flat()) queue.push(t.node); }
    return seen;
  };

describe('015 candidate — inactive and still blocked', () => {
  it('is inactive, has no credentials/pinData and keeps every external action behind the unconditional hold', () => {
    expect(workflow.active).toBe(false);
    expect(workflow.pinData).toEqual({});
    for (const n of workflow.nodes) {
      expect(n.credentials).toBeUndefined();
      if (/\.(scheduleTrigger|manualTrigger|webhook)$/.test(n.type)) expect(n.disabled).toBe(true);
      if (/\.(postgres|executeCommand|readWriteFile)$/.test(n.type)) {
        const expression = JSON.stringify(n.parameters);
        expect(expression, n.name).toContain(hold);
      }
    }
  });
  it('contains no direct use of the five legacy functions the worker role loses, and only the protected entries', () => {
    const sql = workflow.nodes.filter(n => n.type.endsWith('.postgres')).map(n => String(n.parameters.query)).join('\n');
    expect(sql).not.toMatch(/fn_crear_ejecucion_automatizacion|reservar_folios_para_ejecucion|fn_registrar_remision_generada|fn_finalizar_ejecucion_automatizacion|fn_registrar_fallo_ejecucion/);
    for (const fn of ['fn_admitir_reservar_caterpillar_test', 'fn_reprocesar_reservar_caterpillar_test', 'fn_registrar_remision_caterpillar_test',
      'fn_finalizar_caterpillar_test', 'fn_fallo_caterpillar_test', 'fn_resolver_ejecucion_para_reproceso', 'fn_crear_o_resolver_documento']) expect(sql).toContain(fn);
  });
  it('has no dangling connections or references to the removed pre-admission execution nodes', () => {
    const names = new Set(workflow.nodes.map(n => n.name));
    for (const [from, entry] of Object.entries(workflow.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const t of entry.main.flat()) expect(names.has(t.node), t.node).toBe(true);
    }
    const executable = workflow.nodes.filter(n => n.type.endsWith('.code')).map(n => n.parameters.jsCode as string).join('\n');
    expect(executable).not.toMatch(/\$\("(Propagar ejecución PG|Crear o recuperar ejecución PG)"\)/);
  });
  it('no emission, registration or folio assignment is reachable except through the proven admission result', () => {
    expect(reach('').has('Asignar folios PG CAT')).toBe(true);
    expect(reach('¿Puede emitir CAT?').has('Asignar folios PG CAT')).toBe(false);
    expect(reach('Propagar admisión CAT').has('Registrar remisión PG')).toBe(false);
    const preds = Object.entries(workflow.connections).filter(([, e]) => e.main.flat().some(t => t.node === 'Asignar folios PG CAT')).map(([n]) => n);
    expect(preds).toEqual(['¿Puede emitir CAT?']);
    const chain = ['Normalizar datos CAT', 'Preparar snapshot admisión CAT', 'Guardar snapshot admisión CAT', 'Verificar snapshot CAT', 'Preparar reserva folios PG', 'Reservar folios PG', 'Propagar admisión CAT'];
    chain.slice(0, -1).forEach((from, i) => expect(workflow.connections[from]!.main[0]).toEqual([{ node: chain[i + 1], type: 'main', index: 0 }]));
    // Skipping or failing the capture leaves the reservation unreachable: the snapshot is a mandatory predecessor of the gate.
    expect(reach('Verificar snapshot CAT').has('Reservar folios PG')).toBe(false);
    expect(reach('Guardar snapshot admisión CAT').has('Reservar folios PG')).toBe(false);
  });
  it('gate parameters use the real server worker and the parent id only for reprocess', () => {
    const reserve = node('Reservar folios PG');
    expect(String(reserve.parameters.query)).toContain('fn_reprocesar_reservar_caterpillar_test');
    expect(queryReplacement(reserve)).toContain('String($execution.id)');
    expect(queryReplacement(reserve)).toContain('$json.reproceso_de_id || $json.documento_origen_id');
    for (const name of ['Registrar remisión PG', 'Finalizar ejecución PG']) expect(queryReplacement(node(name))).toContain('String($execution.id)');
  });
});

describe('015 candidate — pure node bodies against synthetic data (no n8n, no PostgreSQL)', () => {
  const items = adapted(normal.map(i => ({ json: { ...i.json, planta_codigo: 'P5', subplanta_codigo: '' } })));
  it('prepares series and quantity with no prior execution', () => {
    const p = prep(items);
    expect(p).toMatchObject({ documento_origen_id: '41', serie_codigo: 'REMISION_CAT_P5', cantidad: items.length, reproceso_de_id: null });
    expect(p).not.toHaveProperty('ejecucion_id');
  });
  it('requires a consistent reprocess context (mode and parent together)', () => {
    expect(prep(items, { mode: 'REPROCESS', reproceso_de_id: '12' })).toMatchObject({ reproceso_de_id: '12', mode: 'REPROCESS' });
    expect(() => prep(items, { mode: 'REPROCESS' })).toThrow('CAT_TEST_015_REPROCESS_CONTEXT_INVALID');
    expect(() => prep(items, { reproceso_de_id: '12' })).toThrow('CAT_TEST_015_REPROCESS_CONTEXT_INVALID');
  });
  it('keeps one reservation per Torreon document while all repeated partidas stay in the manifest', () => {
    const base = fixture.torreonBeforeGrouping!.map(i => ({ json: { ...i.json, planta_codigo: 'TORREON', subplanta_codigo: 'PLANTA_2' } }));
    const raw = [...base, structuredClone(base[0]!)];
    const content = adaptCaterpillarNormalizedItems(raw);
    const grouped = content.manifest.documents.map(() => ({ json: { planta_codigo: 'TORREON', subplanta_codigo: 'PLANTA_2', cat_operational_content: content } }));
    const p = prep(grouped);
    expect(p).toMatchObject({ serie_codigo: 'REMISION_CAT_TORREON', cantidad: content.manifest.documents.length });
    expect(content.manifest.documents.flatMap(d => d.lines)).toHaveLength(raw.length);
  });
  const preparation = () => ({ documento_origen_id: '41', mode: null, reproceso_de_id: null, serie_codigo: 'REMISION_CAT_P5', cantidad: 2, cat_operational_content: {} });
  it('first emission: only a fully proven result of THIS worker gives the right to emit', () => {
    expect(admit(gateRow(), preparation())).toMatchObject({ puede_emitir: true, ejecucion_id: '900', reserva_id: '70', folio_inicial: '1000', cantidad: 2 });
    expect(() => admit(gateRow({ worker_id: 'OTHER' }), preparation())).toThrow('CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN');
    expect(() => admit(gateRow(), preparation(), 'W2')).toThrow('CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN');
    expect(() => admit(gateRow({ folio_final: '1005' }), preparation())).toThrow('CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN');
    expect(() => admit(gateRow({ reserva_id: null }), preparation())).toThrow('CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN');
    expect(() => admit(gateRow({ reason: 'REPROCESS_ACQUIRED' }), preparation())).toThrow('CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN');
  });
  it('already processed / second worker: no right to emit and the foreign execution is never adopted', () => {
    for (const reason of ['PROGRAM_IN_PROGRESS', 'PROGRAM_ALREADY_EMITTED', 'MANUAL_REPROCESS_REQUIRED']) {
      const out = admit(gateRow({ decision: 'BLOCK', reason, can_emit: false, worker_id: 'OTHER', ejecucion_id: '555', reserva_id: null, folio_inicial: null, folio_final: null, cantidad: null }), preparation());
      expect(out).toMatchObject({ puede_emitir: false, admision_reason: reason, ejecucion_ajena_id: '555' });
      expect(out).not.toHaveProperty('ejecucion_id');
      expect(out).not.toHaveProperty('reserva_id');
    }
    expect(() => admit(gateRow({ decision: 'ADMIT', can_emit: false }), preparation())).toThrow('CAT_TEST_015_ADMISSION_WITHOUT_RESERVATION');
  });
  it('same-worker retry keeps the same execution and reservation', () => {
    expect(admit(gateRow({ reason: 'OWNED_RETRY' }), preparation())).toMatchObject({ puede_emitir: true, ejecucion_id: '900', reserva_id: '70' });
  });
  it('reprocess accepts only REPROCESS_ACQUIRED/OWNED_RETRY and answers the child id with a sanitized status', () => {
    const rp = { ...preparation(), mode: 'REPROCESS', reproceso_de_id: '12' };
    const ok = admit(gateRow({ reason: 'REPROCESS_ACQUIRED' }), rp);
    expect(ok).toMatchObject({ puede_emitir: true, mode: 'REPROCESS', reproceso_de_id: '12' });
    expect(run('Mapear resultado creación reproceso CAT', [{ json: ok }])[0]!.json).toMatchObject({ reproceso_status: 'PROCESSING', reproceso_status_valido: true, reproceso_ejecucion_hija_id: '900' });
    expect(() => admit(gateRow({ reason: 'ACQUIRED' }), rp)).toThrow('CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN');
    const duplicate = admit(gateRow({ decision: 'BLOCK', reason: 'REPROCESS_IN_PROGRESS', can_emit: false, worker_id: 'OTHER', ejecucion_id: '901', reserva_id: null, folio_inicial: null, folio_final: null, cantidad: null }), rp);
    expect(run('Mapear resultado creación reproceso CAT', [{ json: duplicate }])[0]!.json).toMatchObject({ reproceso_status: 'ALREADY_PROCESSING', reproceso_status_valido: true, reproceso_ejecucion_hija_id: '901', puede_emitir: false });
    const done = admit(gateRow({ decision: 'BLOCK', reason: 'ALREADY_REPROCESSED', can_emit: false, worker_id: null, ejecucion_id: '901', reserva_id: null, folio_inicial: null, folio_final: null, cantidad: null }), rp);
    expect(run('Mapear resultado creación reproceso CAT', [{ json: done }])[0]!.json).toMatchObject({ reproceso_status: 'ALREADY_REPROCESSED', reproceso_status_valido: true });
  });
  it.each(['REPROCESS_SNAPSHOT_REQUIRED', 'PARENT_NOT_REPROCESSABLE', 'PARENT_HAS_ACTIVE_REMISSIONS', 'OTHER_DOCUMENT_CONFLICT_REVIEW'])('reprocess rejection %s fails closed (never "accepted")', reason => {
    const out = admit(gateRow({ decision: 'REVIEW', reason, can_emit: false, worker_id: null, ejecucion_id: '12', reserva_id: null, folio_inicial: null, folio_final: null, cantidad: null }),
      { ...preparation(), mode: 'REPROCESS', reproceso_de_id: '12' });
    expect(run('Mapear resultado creación reproceso CAT', [{ json: out }])[0]!.json).toMatchObject({ reproceso_status: null, reproceso_status_valido: false });
  });
  it('assignment requires the proven right and carries the gate execution into registration', () => {
    const lookups = { 'Normalizar datos CAT': { json: {} }, 'Preparar reserva folios PG': { json: {} } };
    expect(() => run('Asignar folios PG CAT', [{ json: { puede_emitir: false } }], lookups)).toThrow();
    expect(code('Asignar folios PG CAT')).toContain('ejecucion_id: String(reserva.ejecucion_id)');
    expect(code('Asignar folios PG CAT')).toContain('CAT_TEST_015_NO_EMISSION_RIGHT');
  });
  const errorOf = (admission: Record<string, unknown> | null, current: Record<string, unknown> = { error: { message: 'boom', node: { name: 'Normalizar datos CAT' } } }) => {
    const lookups: Record<string, Item> = { 'Propagar documento origen PG': docContext(), 'Preparar archivo CAT': { json: { file_name: 'PROG.xlsx' } } };
    if (admission) lookups['Propagar admisión CAT'] = { json: admission };
    return run('Preparar error CAT', [{ json: current }], lookups)[0]!.json;
  };
  it('failure BEFORE admission never gets an execution to fail (no admission, foreign result, or stale loop context)', () => {
    expect(errorOf(null)).toMatchObject({ fallo_previo_admision: true, ejecucion_id: '' });
    expect(errorOf({ puede_emitir: false, ejecucion_ajena_id: '555', documento_origen_id: '41' })).toMatchObject({ fallo_previo_admision: true, ejecucion_id: '' });
    expect(errorOf({ puede_emitir: true, ejecucion_id: '900', documento_origen_id: '40' })).toMatchObject({ fallo_previo_admision: true, ejecucion_id: '' });
    expect(errorOf({ puede_emitir: true, ejecucion_id: '900', documento_origen_id: '41' }, { ejecucion_id: '777', error: { message: 'x' } })).toMatchObject({ ejecucion_id: '900' });
  });
  it('failure AFTER the reservation targets only the proven own execution', () => {
    expect(errorOf({ puede_emitir: true, ejecucion_id: '900', documento_origen_id: '41' })).toMatchObject({ fallo_previo_admision: false, ejecucion_id: '900', n8n_execution_id: 'W1' });
    expect(workflow.connections['¿Ejecución propia confirmada?']!.main.map(o => o.map(t => t.node))).toEqual([['Registrar fallo PG'], ['Registrar log error CAT']]);
  });
  it('snapshot capture sends only the canonical V1 manifest, with Torreon partidas captured before grouping', () => {
    const base = fixture.torreonBeforeGrouping!.map(i => ({ json: { ...i.json, planta_codigo: 'TORREON', subplanta_codigo: 'PLANTA_2' } }));
    const raw = [...base, structuredClone(base[0]!)];
    const content = adaptCaterpillarNormalizedItems(raw);
    const grouped = content.manifest.documents.map(() => ({ json: { cat_operational_content: content } }));
    const out = run('Preparar snapshot admisión CAT', grouped, { 'Propagar documento origen PG': docContext() })[0]!.json;
    expect(out).toEqual({ documento_origen_id: '41', manifest_canonical: JSON.stringify(content.manifest) });
    expect(grouped.length).toBeLessThan(raw.length);
    expect((JSON.parse(String(out.manifest_canonical)) as { documents: Array<{ lines: unknown[] }> }).documents.flatMap(d => d.lines)).toHaveLength(raw.length);
    expect(() => run('Preparar snapshot admisión CAT', [{ json: {} }], { 'Propagar documento origen PG': docContext() })).toThrow('CAT_TEST_015_SNAPSHOT_INPUT_INVALID');
    expect(() => run('Preparar snapshot admisión CAT', grouped, { 'Propagar documento origen PG': { json: {} } })).toThrow('CAT_TEST_015_SNAPSHOT_INPUT_INVALID');
    expect(String(node('Guardar snapshot admisión CAT').parameters.query)).toContain('ops.fn_guardar_snapshot_caterpillar_test');
  });
  it.each(['STORED', 'ALREADY_STORED'])('snapshot %s continues with the ORIGINAL normalized items and the same document/worker context', estado => {
    const original = { json: { documento_origen_id: '41', mode: null, marker: 'normalized' } };
    const out = run('Verificar snapshot CAT', [{ json: { estado } }], { 'Normalizar datos CAT': original });
    expect(out).toEqual([original]);
  });
  it.each([['CONFLICT'], ['HISTORICAL_LOCKED'], ['UNAVAILABLE'], [undefined], ['stored']])('snapshot result %s aborts before the gate, so no execution or folios can follow', estado => {
    expect(() => run('Verificar snapshot CAT', [{ json: { estado } }], { 'Normalizar datos CAT': { json: {} } })).toThrow('CAT_TEST_015_SNAPSHOT_NOT_STORED');
  });
  it('contains no PROD database, credential or workflow references', () => {
    const text = JSON.stringify(workflow);
    expect(text).not.toMatch(/daubert_global|Postgres produccion|XBIHVwg46DQuJc5S|9Ngnrpi16b6GtOAX|cat-reprocess"|"credentials"/);
  });
  it('keeps the reprocess path (webhook, eligibility, protected gate) behind the same mandatory snapshot capture', () => {
    expect(workflow.nodes.find(n => n.name === 'Webhook Reproceso CAT (TEST)')!.disabled).toBe(true);
    expect(reach('Verificar snapshot CAT').has('Reservar folios PG')).toBe(false);
    expect(String(node('Reservar folios PG').parameters.query)).toContain('fn_reprocesar_reservar_caterpillar_test');
    expect(workflow.connections['¿Es reproceso?']!.main.map(o => o.map(t => t.node))).toEqual([['Mapear resultado creación reproceso CAT'], ['¿Puede emitir CAT?']]);
  });
});
