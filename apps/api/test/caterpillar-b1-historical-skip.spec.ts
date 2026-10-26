import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runSegment } = require('./support/n8n-segment-runner.cjs') as {
  runSegment: (workflow: Workflow, options: Record<string, unknown>) => { trace: string[]; reached: Record<string, Item[]>; outputs: Record<string, Item[]> };
};

// B1: an already-emitted legacy document (no snapshot) comes back from the protected SQL entry as the VALUE 'HISTORICAL_LOCKED'. On the automatic scan that exact
// value skips the file and returns to the loop; reprocess and every other result keep failing closed. The REAL node bodies, IF expressions and connections of the
// exported workflows are executed here; PostgreSQL, files and commands are stubs. Nothing is imported or run in n8n.
type Item = { json: Record<string, unknown> };
type Node = { name: string; type: string; credentials?: Record<string, { name?: string }>; disabled?: boolean; parameters: Record<string, unknown> };
type Workflow = { active: boolean; nodes: Node[]; connections: Record<string, { main: Array<Array<{ node: string }>> }> };
const folder = resolve(__dirname, '../../../n8n/workflows/remisiones-caterpillar');
const load = (file: string) => JSON.parse(readFileSync(resolve(folder, file), 'utf8')) as Workflow;
const profiles: Array<[string, Workflow, string]> = [
  ['FULL TEST', load('candidate-015/caterpillar-test-015.FULL.INACTIVE.json'), 'CAT_TEST_015'],
  ['PROD candidate', load('candidate-016-prod/caterpillar-prod-016.CANDIDATE.INACTIVE.json'), 'CAT_015']
];

const SAVE = 'Guardar snapshot admisión CAT';
const CHECK = '¿Histórico ya emitido?';
const SKIP = 'Omitir histórico CAT';
const VERIFY = 'Verificar snapshot CAT';
const PREPARE_RESERVATION = 'Preparar reserva folios PG';
const LOOP = 'Loop Over Items';
const document = (id: string, name: string, mode?: string): Item => ({ json: { documento_origen_id: id, file_name: name, file_path: `X:\\${name}`, hash_archivo: `h-${id}`, ...(mode ? { mode } : {}) } });
const normalized: Item = { json: { marker: 'normalized-items' } };

describe.each(profiles)('B1 historical skip — %s', (_label, workflow, prefix) => {
  const node = (name: string) => workflow.nodes.find(n => n.name === name)!;
  const targets = (name: string, output: number) => (workflow.connections[name]?.main[output] ?? []).map(t => t.node);
  // Everything the scan does when PostgreSQL answers `estado` for a document in the given mode.
  const scan = (estado: unknown, source: Item) => runSegment(workflow, { start: CHECK, items: [{ json: { estado } }], stopAt: [LOOP, PREPARE_RESERVATION],
    outputs: { 'Propagar documento origen PG': [source], 'Normalizar datos CAT': [normalized] } });

  it('is wired as a branch: true skips back to the loop, false is the unchanged mandatory path to the verifier', () => {
    expect(targets(SAVE, 0)).toEqual([CHECK]);
    expect(targets(CHECK, 0)).toEqual([SKIP]);
    expect(targets(CHECK, 1)).toEqual([VERIFY]);
    expect(targets(SKIP, 0)).toEqual([LOOP]);
    expect(targets(VERIFY, 0)).toEqual([PREPARE_RESERVATION]);
    // The skip node has exactly one outgoing edge: nothing leads from it to reservation, folios, registration or finalization except through the loop's own entry.
    expect(workflow.connections[SKIP]!.main).toHaveLength(1);
    const incoming = Object.entries(workflow.connections).filter(([, e]) => e.main.flat().some(t => t.node === VERIFY)).map(([n]) => n);
    expect(incoming).toEqual([CHECK]);
  });

  it('the skip node does no I/O, touches no PostgreSQL and cannot appear on a path to the gate', () => {
    const body = String(node(SKIP).parameters.jsCode);
    expect(body).not.toMatch(/require\(|fs\.|child_process|fetch\(|\$node\[|Postgres|ops\.|operacion\./);
    expect(node(SKIP).type).toBe('n8n-nodes-base.code');
    expect(node(CHECK).type).toBe('n8n-nodes-base.if');
    expect(node(SKIP).credentials).toBeUndefined();
    expect(node(CHECK).credentials).toBeUndefined();
  });

  it('automatic scan + HISTORICAL_LOCKED: the file is skipped with an identifiable SKIPPED_HISTORICAL result and the loop continues', () => {
    const result = scan('HISTORICAL_LOCKED', document('268', 'PRUEBA PG FINAL2.xlsx'));
    expect(result.trace).toEqual([CHECK, SKIP]);
    expect(Object.keys(result.reached)).toEqual([LOOP]);
    expect(result.reached[LOOP]![0]!.json).toEqual({
      resultado: 'SKIPPED_HISTORICAL', motivo: expect.stringContaining('HISTORICAL_LOCKED'), snapshot_estado: 'HISTORICAL_LOCKED',
      documento_origen_id: '268', file_name: 'PRUEBA PG FINAL2.xlsx', file_path: 'X:\\PRUEBA PG FINAL2.xlsx', hash_archivo: 'h-268'
    });
    expect(result.trace).not.toContain(VERIFY);
  });

  it('reprocess + HISTORICAL_LOCKED still fails closed at the verifier (no skip, no reservation)', () => {
    expect(() => scan('HISTORICAL_LOCKED', document('268', 'x.xlsx', 'REPROCESS'))).toThrow(`${prefix}_SNAPSHOT_NOT_STORED`);
  });

  it.each([['CONFLICT'], ['UNAVAILABLE'], ['NOT_FOUND'], [undefined], [null], [''], ['historical_locked'], ['HISTORICAL_LOCKED '], [' HISTORICAL_LOCKED'], [true], [1], ['STORED2']])(
    'automatic scan + %j is NOT skipped: it reaches the verifier and aborts', estado => {
      expect(() => scan(estado, document('1', 'x.xlsx'))).toThrow(`${prefix}_SNAPSHOT_NOT_STORED`);
    });

  it.each([['STORED'], ['ALREADY_STORED']])('automatic scan + %s continues on the normal path to the reservation preparation with the original normalized items', estado => {
    const result = scan(estado, document('2', 'new.xlsx'));
    expect(result.trace).toEqual([CHECK, VERIFY]);
    expect(Object.keys(result.reached)).toEqual([PREPARE_RESERVATION]);
    expect(result.reached[PREPARE_RESERVATION]).toEqual([normalized]);
  });

  it('the mode comes from the real per-item context: the automatic detector never sets REPROCESS and the reprocess entry always does', () => {
    const detector = String(node('Detectar archivos CAT1').parameters.jsCode);
    expect(detector).not.toMatch(/mode:\s*["']REPROCESS["']/);
    expect(String(node('Detectar archivo REPROCESS CAT1').parameters.jsCode)).toContain('mode: "REPROCESS"');
    expect(String(node('Preparar archivo CAT').parameters.jsCode)).toContain('...json');
    expect(String(node('Propagar documento origen PG').parameters.jsCode)).toContain('...base');
    expect(String(node(CHECK).parameters.conditions)).toBeDefined();
    const condition = JSON.stringify(node(CHECK).parameters);
    expect(condition).toContain('Propagar documento origen PG');
    expect(condition).toContain('HISTORICAL_LOCKED');
  });

  it('loop continuity: a skipped historical followed by a new file reaches the normal reservation path on the next iteration', () => {
    const first = scan('HISTORICAL_LOCKED', document('268', 'historico.xlsx'));
    const second = scan('STORED', document('400', 'nuevo.xlsx'));
    expect(Object.keys(first.reached)).toEqual([LOOP]);
    expect(Object.keys(second.reached)).toEqual([PREPARE_RESERVATION]);
  });

  it('a PostgreSQL error (connection, permission, P0002, 22023) raised by the snapshot call propagates untouched: no skip node runs', () => {
    for (const code of ['ECONNREFUSED', '42501', 'P0002', '22023', '55000']) {
      const boom = () => { throw Object.assign(new Error(`pg ${code}`), { code }); };
      let trace: string[] = [];
      expect(() => {
        const result = runSegment(workflow, { start: SAVE, items: [{ json: {} }], stubs: { [SAVE]: boom }, stopAt: [LOOP, PREPARE_RESERVATION], outputs: {} });
        trace = result.trace;
      }).toThrow(`pg ${code}`);
      expect(trace).toEqual([]);
    }
  });

  it('keeps every other protection: the Postgres nodes, the gate and the loop are untouched', () => {
    const postgres = workflow.nodes.filter(n => n.type.endsWith('.postgres'));
    expect(postgres.map(n => n.name)).toContain(SAVE);
    expect(postgres.every(n => !String(n.parameters.query).includes('SKIPPED'))).toBe(true);
    const reach = (without: string) => {
      const seen = new Set<string>(); const queue = ['Schedule Trigger', 'When clicking ‘Execute workflow’', 'Webhook Reproceso CAT (TEST)', 'Webhook Reproceso CAT (PROD)'].filter(n => workflow.connections[n]);
      while (queue.length) { const n = queue.shift()!; if (seen.has(n) || n === without) continue; seen.add(n); for (const t of (workflow.connections[n]?.main ?? []).flat()) queue.push(t.node); }
      return seen;
    };
    expect(reach(VERIFY).has('Reservar folios PG')).toBe(false);
    expect(reach(CHECK).has('Reservar folios PG')).toBe(false);
    expect(reach('¿Puede emitir CAT?').has('Asignar folios PG CAT')).toBe(false);
  });
});

describe('paste file for the live FULL TEST', () => {
  it('contains exactly the two B1 nodes of the generated FULL (same parameters), connected to each other, and nothing else', () => {
    const paste = JSON.parse(readFileSync(resolve(folder, 'candidate-015/b1-historical-skip.FULL.paste.json'), 'utf8')) as Workflow;
    const full = profiles[0]![1];
    expect(paste.nodes.map(n => n.name)).toEqual([CHECK, SKIP]);
    for (const n of paste.nodes) expect(n.parameters).toEqual(full.nodes.find(x => x.name === n.name)!.parameters);
    expect(paste.connections).toEqual({ [CHECK]: { main: [[{ node: SKIP, type: 'main', index: 0 }]] } });
  });
});

describe('PROD candidate — still inactive and still production', () => {
  const prod = profiles[1]![1];
  const live = load('prod/workflow.live-20261023.json');
  it('is inactive with Schedule and Webhook disabled, no pinned data, and a dedicated credential by name on every Postgres node', () => {
    expect(prod.active).toBe(false);
    expect(prod.nodes).toHaveLength(62);
    for (const n of prod.nodes.filter(x => /\.(scheduleTrigger|webhook)$/.test(x.type))) expect(n.disabled).toBe(true);
    for (const n of prod.nodes.filter(x => x.type.endsWith('.postgres'))) expect(n.credentials).toEqual({ postgres: { name: 'Postgres produccion CAT (n8n_cat_prod)' } });
    expect(JSON.stringify(prod)).not.toMatch(/CAT_TEST_|_caterpillar_test|Pruebas\\\\REMISIONES|<WINDOWS_USER>/);
  });
  it('keeps the live production detector, routes, enabled processes, cutoff, schedule and webhook byte for byte', () => {
    const same = (name: string) => expect(prod.nodes.find(n => n.name === name)!.parameters, name).toEqual(live.nodes.find(n => n.name === name)!.parameters);
    ['Schedule Trigger', 'Detectar archivos CAT1', 'Filtrar archivos nuevos', 'Webhook Reproceso CAT (PROD)', 'Preparar archivo CAT', 'Registrar log error CAT'].forEach(same);
    const detector = String(prod.nodes.find(n => n.name === 'Detectar archivos CAT1')!.parameters.jsCode);
    expect(detector).toContain('"CATERPILLAR_P2|P2|"');
    expect(detector).toContain('"CAT_P3_P4_P5_P6|P5|"');
    expect(detector).toContain('"CAT_P3_P4_P5_P6|P6|"');
    expect((detector.match(/new Set\(\[[\s\S]*?\]\)/) ?? [''])[0].match(/CAT\w*\|/g)).toHaveLength(3);
  });
  it('differs from the live production workflow only by the validated logic nodes (the two new B1 nodes among them)', () => {
    const liveNames = new Set(live.nodes.map(n => n.name));
    const added = prod.nodes.filter(n => !liveNames.has(n.name)).map(n => n.name).sort();
    expect(added).toEqual(expect.arrayContaining([CHECK, SKIP]));
    for (const n of prod.nodes.filter(x => liveNames.has(x.name) && !x.type.endsWith('.postgres') && !x.type.endsWith('.stickyNote') && !/^(Normalizar datos CAT|Preparar reserva folios PG|Asignar folios PG CAT|Registrar remisión PG|Finalizar ejecución PG|Preparar error CAT|Registrar fallo PG|Responder reproceso aceptado|Mapear resultado creación reproceso CAT|¿Puede emitir CAT\?|Validar elegibilidad reproceso CAT|Detectar archivo REPROCESS CAT1|Normalizar y validar entrada reproceso CAT)$/.test(x.name))) {
      expect(n.parameters, n.name).toEqual(live.nodes.find(x => x.name === n.name)!.parameters);
    }
  });
});
