import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { adaptCaterpillarNormalizedItems } from '../src/automations/remisiones-caterpillar/caterpillar-operational-manifest.adapter';
import { buildCaterpillarOperationalManifest, type NormalizedCaterpillarLine } from '../src/automations/remisiones-caterpillar/caterpillar-operational-manifest';

const folder = resolve(__dirname, '../../../n8n/workflows/remisiones-caterpillar/candidate-5678');
const load = createRequire(resolve(folder, 'prepare-candidate.cjs'));
const { outputFile, sourceFixtureFile, holdCode, ioNames } = load('./prepare-candidate.cjs');
const { createCaterpillarManifestV1 } = load('./manifest-v1.generated.cjs');
const { createCaterpillarWindowsTestSafety } = load('./runtime-test-safety.cjs');
const { readCaterpillarOperationalContent } = load('./manifest-transport.cjs');
/* eslint-disable @typescript-eslint/no-explicit-any -- n8n item/node payloads are untyped JSON in this offline fixture test */
type Item = { json: Record<string, any> };
type Workflow = { nodes: Array<{ name: string; parameters: Record<string, any> }> };
/* eslint-enable @typescript-eslint/no-explicit-any */
const source = JSON.parse(readFileSync(sourceFixtureFile, 'utf8')) as Workflow & { connections: unknown; nodeStructure: unknown };
const candidate = JSON.parse(readFileSync(outputFile, 'utf8')) as Workflow;
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')) as Record<string, Item[]>;
const vectors = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-manifest-v1.json'), 'utf8')) as {
  base: NormalizedCaterpillarLine[]; canonicalJson: string;
  vectors: Array<{ name: string; patch: Partial<NormalizedCaterpillarLine>; equivalent: boolean }>;
};
const js = createCaterpillarManifestV1();
const normal = fixture.normal!;
const torreon = fixture.torreonBeforeGrouping!.map(item => ({ json: { ...item.json, planta_codigo: 'TORREON', subplanta_codigo: 'PLANTA_2' } }));

// Execute only isolated Code bodies against synthetic rows/catalogues, never an n8n workflow.
// Only path is allowed; fs, PostgreSQL and external processes are unavailable to this harness.
function normalize(workflow: Workflow, items: Item[], date = '20/10/2026') {
  const first = items[0]!.json;
  const rows: unknown[][] = Array.from({ length: 7 }, () => Array(11).fill(''));
  rows[3]![5] = date; rows[3]![7] = 'CAT_REMISION_V1';
  Object.assign(rows[6]!, { 0: 'CODIGO', 3: 'DESCRIPCION', 8: 'CANTIDAD BOLSAS/HOJAS', 9: 'CANTIDAD ROLLOS/PAQUETE', 10: 'OC CLIENTE' });
  for (const item of items) {
    const row = Array(11).fill('');
    row[0] = item.json.codigo; row[3] = 'Producto sintético'; row[10] = item.json.orden_compra;
    row[['ROLLOS', 'PAQUETES'].includes(item.json.unidad_remision) ? 9 : 8] = item.json.cantidad_numerica;
    rows.push(row);
  }
  const context = { cliente_grupo: first.cliente_grupo, planta_codigo: first.planta_codigo,
    subplanta_codigo: first.subplanta_codigo, documento_origen_id: 'synthetic-doc', ejecucion_id: 'synthetic-exec',
    file_name: 'PROGRAMACION PRUEBA.xlsx', scripts_dir: 'synthetic/scripts' };
  const catalog = {
    productos_map: Object.fromEntries(items.map(item => [item.json.codigo, {
      ...context, codigo_excel: item.json.codigo, unidad_remision: item.json.unidad_remision,
      numero_parte: item.json.numero_parte, activo: 'SI'
    }])),
    clientes_map: { synthetic: { ...context, cliente_remision: first.cliente, rfc: first.rfc } }
  };
  const lookup = (name: string) => {
    if (name === 'Propagar ejecución PG') return { first: () => ({ json: context }) };
    if (name === 'Preparar catálogo CAT') return { first: () => ({ json: catalog }) };
    throw new Error('Unexpected external lookup');
  };
  const requireOnlyPath = (name: string) => { if (name === 'path') return path; throw new Error('I/O forbidden in synthetic harness'); };
  const code = workflow.nodes.find(n => n.name === 'Normalizar datos CAT')!.parameters.jsCode;
  return new Function('$input', '$', '$execution', 'require', code)({ all: () => rows.map(json => ({ json })) }, lookup, { id: 'synthetic' }, requireOnlyPath) as Item[];
}
function prepareReservation(items: Item[]) {
  return new Function('$input', candidate.nodes.find(n => n.name === 'Preparar reserva folios PG')!.parameters.jsCode)({ all: () => items }) as Item[];
}

describe('Windows TEST candidate — offline only', () => {
  it('preserves topology and rejects every operational action before any I/O (portable fixture, no Downloads needed)', () => {
    const full = candidate as Workflow & { connections: unknown; active: boolean };
    expect(full.connections).toEqual(source.connections);
    expect(full.nodes.map(n => { const node = n as typeof n & { id: string; type: string }; return [node.id,node.name,node.type]; })).toEqual(source.nodeStructure);
    expect(full.active).toBe(false);
    let holds = 0;
    for (const raw of full.nodes) {
      const node = raw as typeof raw & { type: string; disabled?: boolean; credentials?: unknown };
      expect(node.credentials).toBeUndefined();
      if (/\.(scheduleTrigger|manualTrigger|webhook)$/.test(node.type)) expect(node.disabled).toBe(true);
      else if (ioNames.includes(node.name)) {
        expect(node.parameters.jsCode).toContain(holdCode);
        expect(() => new Function('require',node.parameters.jsCode)(() => { throw new Error('I/O forbidden'); })).toThrow('CAT_TEST_5678_NOT_APPROVED'); holds++;
      } else if (/\.(postgres|readWriteFile|executeCommand)$/.test(node.type)) {
        const expression = node.parameters.query || node.parameters.command || node.parameters.fileName || node.parameters.fileSelector;
        expect(() => new Function('return ('+expression.slice(3,-2)+');')()).toThrow('CAT_TEST_5678_NOT_APPROVED'); holds++;
      }
    }
    expect(holds).toBe(24);
  });
  it('matches the original canonical byte vector', () => {
    expect(JSON.stringify(js.buildCaterpillarOperationalManifest(vectors.base))).toBe(vectors.canonicalJson);
  });
  it.each(vectors.vectors)('derivation preserves V1 vector $name', ({ patch, equivalent }) => {
    const changed = vectors.base.map(line => ({ ...line, ...patch }));
    expect(js.compareCaterpillarOperationalContent(vectors.base, changed)).toEqual({ contentEquivalent: equivalent, deliveryIdentity: 'UNCONFIRMED' });
    expect(js.buildCaterpillarOperationalManifest(changed)).toEqual(buildCaterpillarOperationalManifest(changed));
  });
  it.each([['normal', normal], ['Torreon real scope', torreon]] as const)('preserves original outputs/order/cardinality for %s', (_name, items) => {
    const before = JSON.stringify(items);
    const original = normalize(source, items);
    const proposed = normalize(candidate, items);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop the transport field before comparing
    expect(proposed.map(({ json: { cat_operational_content: _content, ...json } }) => ({ json }))).toEqual(original);
    expect(proposed).toHaveLength(original.length);
    const content = readCaterpillarOperationalContent(proposed);
    expect(content).toEqual(adaptCaterpillarNormalizedItems(items));
    expect(content.deliveryIdentity).toBe('UNCONFIRMED');
    expect(prepareReservation(proposed)[0]!.json).toMatchObject({ cantidad: original.length, cat_operational_content: content });
    expect(JSON.stringify(items)).toBe(before);
  });
  it.each([['normal', normal], ['Torreon', torreon]] as const)('retains repeated occurrences for %s', (_name, items) => {
    const repeated = [...items, structuredClone(items[0]!)];
    const proposed = normalize(candidate, repeated);
    const content = readCaterpillarOperationalContent(proposed);
    expect(content.manifest.documents.flatMap((d: { lines: unknown[] }) => d.lines)).toHaveLength(3);
    expect(proposed.length).toBe(items === torreon ? 1 : 3);
    expect(proposed.map(i => i.json.codigo)).toEqual(normalize(source, repeated).map(i => i.json.codigo));
  });
  it('captures Torreon before loss of parts, decimal precision and canonical units', () => {
    const result = normalize(candidate, torreon);
    expect(result[0]!.json).toMatchObject({ codigo: 'OC_00042', es_remision_torreon_agrupada: true });
    expect(result[0]!.json.cat_operational_content.manifest).toMatchObject({ scope: ['CAT_TORREON', 'TORREON', 'PLANTA_2', 'Cliente Torreón sintético', ''],
      documents: [{ purchaseOrder: '00042', lines: [['TOR-A', '0001-A', '00042', 1.234567, 'PIEZAS'], ['TOR-B', '', '00042', 3, 'PAQUETES']] }] });
    expect(() => js.adaptCaterpillarNormalizedItems(result)).toThrow(/pre-grouping/);
  });
  it.each(['29/02/2024', '31/12/2026'])('accepts valid F4 %s', date => {
    expect(normalize(candidate, normal, date)[0]!.json.cat_operational_content.manifest.deliveryDate).toBe(date.split('/').reverse().join('-'));
  });
  it.each(['31/02/2026', '29/02/2025', '2026-10-20', ''])('rejects invalid F4 %s', date => {
    expect(() => normalize(candidate, normal, date)).toThrow();
  });
  it('preserves normalization errors before manifest calculation', () => {
    const invalid = structuredClone(normal); invalid[0]!.json.orden_compra = '';
    expect(() => normalize(candidate, invalid)).toThrow(/falta OC/);
  });
  it('makes manifest available before reservation and after the SQL response projection', () => {
    const remissions = normalize(candidate, normal);
    const prepared = prepareReservation(remissions);
    const lookup = (name: string) => name === 'Normalizar datos CAT' ? { all: () => remissions } : { first: () => prepared[0] };
    const assigned = new Function('$input', '$', candidate.nodes.find(n => n.name === 'Asignar folios PG CAT')!.parameters.jsCode)(
      { first: () => ({ json: { reserva_id: 'synthetic', folio_inicial: '100', folio_final: '101', cantidad: '2' } }) }, lookup) as Item[];
    expect(assigned.map(i => i.json.folio_numero)).toEqual(['100', '101']);
    expect(assigned.map(i => i.json.cat_operational_content)).toEqual(remissions.map(i => i.json.cat_operational_content));
    delete prepared[0]!.json.cat_operational_content;
    expect(() => new Function('$input', '$', candidate.nodes.find(n => n.name === 'Asignar folios PG CAT')!.parameters.jsCode)(
      { first: () => ({ json: {} }) }, lookup)).toThrow(/TRANSPORT_INVALID/);
  });
  it.each(['absent', 'inconsistent', 'wrong count', 'confirmed identity'])('rejects %s transport', mode => {
    const items = normalize(candidate, normal);
    if (mode === 'absent') delete items[0]!.json.cat_operational_content;
    if (mode === 'inconsistent') items[1]!.json.cat_operational_content = { ...items[1]!.json.cat_operational_content, deliveryIdentity: 'OTHER' };
    if (mode === 'wrong count') items.pop();
    if (mode === 'confirmed identity') items[0]!.json.cat_operational_content.deliveryIdentity = 'CONFIRMED';
    expect(() => prepareReservation(items)).toThrow(/TRANSPORT_INVALID/);
  });
});

describe('Windows TEST path/identity policies — virtual filesystem only', () => {
  const root = 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
  function virtual() {
    const fs = {
      realpathSync: vi.fn((p: string) => { if (p.includes('missing')) throw new Error('ENOENT'); return p.includes('escape') ? 'D:\\outside' : p; }),
      lstatSync: vi.fn((p: string) => ({ isSymbolicLink: () => p.includes('junction') })),
      readFileSync: vi.fn(() => 'synthetic'), writeFileSync: vi.fn(), unlinkSync: vi.fn(), mkdirSync: vi.fn()
    };
    return { fs, safety: createCaterpillarWindowsTestSafety(fs, { sep: '\\', win32: path.win32 }) };
  }
  it('allows only existing real TEST files', () => {
    const { fs, safety } = virtual(); expect(safety.fs.readFileSync(root + '\\existing.xlsx')).toBe('synthetic');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
  it.each(['..\\other', 'missing.pdf', 'junction\\a', 'escape\\a', 'a:stream', '*.xlsx', 'NUL', 'dir.\\file'])('rejects unsafe TEST-relative path %s', tail => {
    expect(() => virtual().safety.existingPath(root + '\\' + tail)).toThrow(/PATH_UNVERIFIED/);
  });
  it.each(['C:\\outside\\Pruebas\\a.xlsx', root + '_EVIL\\a.xlsx', 'relative.xlsx', '\\\\host\\share\\a', 'D:\\a.xlsx'])('rejects external/alternative path %s', p => {
    expect(() => virtual().safety.existingPath(p)).toThrow(/PATH_UNVERIFIED/);
  });
  it.each(['mkdirSync', 'writeFileSync', 'unlinkSync', 'renameSync', 'copyFileSync'])('keeps %s blocked even for existing in-root targets', method => {
    const { fs, safety } = virtual();
    expect(() => safety.fs[method](root + '\\existing.xlsx', 'x')).toThrow(/NOT_APPROVED/);
    expect(fs.writeFileSync).not.toHaveBeenCalled(); expect(fs.unlinkSync).not.toHaveBeenCalled(); expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
  it('rejects POSIX and an unapproved identity policy', () => {
    expect(() => createCaterpillarWindowsTestSafety({}, path.posix).existingPath(root)).toThrow(/PATH_UNVERIFIED/);
    expect(() => virtual().safety.verifyIdentity({}, null)).toThrow(/NOT_APPROVED/);
  });
  const functions = ['core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)', 'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)',
    'operacion.reservar_folios_para_ejecucion(bigint,text,integer)', 'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)',
    'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)', 'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)', 'ops.fn_resolver_ejecucion_para_reproceso(bigint)'];
  const approved = { user: 'synthetic_test', server: 'synthetic-server', port: '5432', companyId: '1', series: ['SYNTHETIC'], privilegeFingerprint: 'reviewed-synthetic' };
  const report = { database: 'daubert_hub_test', ...approved, roleAdministrative: false, schemaCreate: false, directBusinessWrites: false, companyActive: true, reservationsConsistent: true,
    functions: functions.map(signature => ({ signature, available: true, executable: true })), series: [{ code: 'SYNTHETIC', active: true }] };
  it('accepts reviewed diagnostics without lifting the operational hold', () => {
    const { safety } = virtual(); expect(safety.verifyIdentity(report, approved)).toBe(true); expect(() => safety.hold()).toThrow(/NOT_APPROVED/);
  });
  it.each([{ database: 'daubert_global' }, { user: 'postgres' }, { server: 'other' }, { port: '9999' }, { companyId: '2' }, { companyActive: false },
    { roleAdministrative: true }, { schemaCreate: true }, { directBusinessWrites: true }, { privilegeFingerprint: 'changed' }, { functions: [] }, { series: [] }, { reservationsConsistent: false }])('rejects identity/permission drift %j', changes => {
    expect(() => virtual().safety.verifyIdentity({ ...report, ...changes }, approved)).toThrow(/NOT_APPROVED/);
  });
});
