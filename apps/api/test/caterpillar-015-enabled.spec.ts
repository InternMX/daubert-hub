import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Offline evidence for the two staged, inactive copies and for the path confinement they embed. No n8n, no PostgreSQL, no TEST tree access.
const folder = resolve(__dirname, '../../../n8n/workflows/remisiones-caterpillar/candidate-015');
const load = createRequire(resolve(folder, 'prepare-enabled.cjs'));
const { catConfinedPath, catCommandArg, createCaterpillarConfinedFs, WRITE_SUBTREES, TEMP_SUBTREE } = load('./confined-fs.cjs');
const { stage, outputs, blockedFile, ROOT, CAT_TEST_CREDENTIAL } = load('./prepare-enabled.cjs');
type Node = { name: string; type: string; disabled?: boolean; credentials?: unknown; parameters: Record<string, unknown> };
type Workflow = { name: string; active: boolean; nodes: Node[]; connections: Record<string, { main: Array<Array<{ node: string }>> }> };
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Workflow;
const blocked = read(blockedFile);
const inspect = read(outputs.INSPECT);
const full = read(outputs.FULL);
const node = (w: Workflow, prefix: string) => w.nodes.find(n => n.name.startsWith(prefix))!;
const HOLD_STATEMENT = "throw new Error('CAT_TEST_5678_NOT_APPROVED');";
const expression = (value: unknown) => String(value).replace(/^=\{\{/, '').replace(/\}\}$/, '');
const evaluate = (value: unknown, context: Record<string, unknown>) => new Function('$json', '$node', `return ${expression(value)}`)(context.json, context.node);
const sub = (name: string) => `${ROOT}\\${name}`;

describe('confined paths', () => {
  it.each([[sub('00_ARCHIVOS A PROCESAR\\a.xlsx')], [sub('00_ARCHIVOS A PROCESAR/a.xlsx')], [ROOT.toLowerCase() + '\\x.xlsx']])('reads inside the TEST root: %s', value => {
    expect(catConfinedPath(value, ROOT, [''])).toMatch(/\.xlsx$/);
  });
  it.each([
    [sub('..\\Otra\\x.pdf')], [ROOT + '2\\x.pdf'], ['D:\\Pruebas\\x.pdf'], ['\\\\server\\share\\x.pdf'], [sub('02_SALIDAS\\x.pdf:stream')], [sub('02_SALIDAS\\x.pdf.')],
    [sub('02_SALIDAS\\CON')], [sub('02_SALIDAS\\a\u0001b.pdf')], [''], ['C:\\Users\\06\\Documents\\Dropbox\\Remisiones CAT\\x.pdf'], [sub('02_SALIDAS\\*.pdf')]
  ])('rejects %j', value => { expect(() => catConfinedPath(value, ROOT, [''])).toThrow('CAT_TEST_PATH_REJECTED'); });
  it('limits writes to the permitted subtrees', () => {
    for (const ok of WRITE_SUBTREES) expect(catConfinedPath(sub(ok + '\\x'), ROOT, WRITE_SUBTREES)).toBeTruthy();
    for (const bad of ['00_ARCHIVOS A PROCESAR\\x', '05_ARCHIVOS AUXILIARES\\SCRIPTS\\convertir-cat-pdf.ps1', '06_ARCHIVOS TEMPORALES\\html\\x', '06_ARCHIVOS TEMPORALES']) {
      expect(() => catConfinedPath(sub(bad), ROOT, WRITE_SUBTREES)).toThrow('CAT_TEST_PATH_REJECTED');
    }
  });
  it.each(['&', ';', '$x', '%TEMP%', '`', "'", '(', ','])('refuses command metacharacters in %j', fragment => {
    expect(() => catCommandArg(sub('02_SALIDAS\\a' + fragment + 'b'), ROOT, ['02_SALIDAS'])).toThrow('CAT_TEST_PATH_REJECTED');
  });
});

describe.skipIf(process.platform !== 'win32')('confined filesystem (temporary tree, never the real TEST root)', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cat015-'));
  const root = path.join(temp, 'REMISIONES CAT');
  for (const dir of ['02_SALIDAS', '03_LOGS', '00_ARCHIVOS A PROCESAR', '06_ARCHIVOS TEMPORALES\\cat-test-5678\\E1']) mkdirSync(path.join(root, dir), { recursive: true });
  const hold = () => { throw new Error('CAT_TEST_5678_NOT_APPROVED'); };
  const reads = ['existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync', 'readFileSync'];
  const base = { root, fs: new Proxy({}, { get: (_t, m: string) => (reads.includes(m) ? (fs as never as Record<string, unknown>)[m] : hold) }) };
  const safety = createCaterpillarConfinedFs(fs, path, base, catConfinedPath, WRITE_SUBTREES, TEMP_SUBTREE) as { fs: typeof fs };
  const at = (relative: string) => path.join(root, relative);
  it('allows only mkdir/write/unlink inside the write subtrees', () => {
    safety.fs.mkdirSync(at('02_SALIDAS\\nuevo'), { recursive: true });
    safety.fs.writeFileSync(at('03_LOGS\\x.log'), 'ok');
    expect(existsSync(at('03_LOGS\\x.log'))).toBe(true);
    expect(() => safety.fs.writeFileSync(at('00_ARCHIVOS A PROCESAR\\x.xlsx'), 'no')).toThrow('CAT_TEST_PATH_REJECTED');
    expect(() => safety.fs.writeFileSync(path.join(temp, 'fuera.txt'), 'no')).toThrow('CAT_TEST_PATH_REJECTED');
    expect(() => safety.fs.mkdirSync(at('..\\fuera'))).toThrow('CAT_TEST_PATH_REJECTED');
  });
  it('deletes only .html files of the per-execution temporary tree', () => {
    writeFileSync(at('06_ARCHIVOS TEMPORALES\\cat-test-5678\\E1\\a.html'), 'x');
    writeFileSync(at('06_ARCHIVOS TEMPORALES\\cat-test-5678\\E1\\a.pdf'), 'x');
    writeFileSync(at('03_LOGS\\b.html'), 'x');
    safety.fs.unlinkSync(at('06_ARCHIVOS TEMPORALES\\cat-test-5678\\E1\\a.html'));
    expect(existsSync(at('06_ARCHIVOS TEMPORALES\\cat-test-5678\\E1\\a.html'))).toBe(false);
    expect(() => safety.fs.unlinkSync(at('06_ARCHIVOS TEMPORALES\\cat-test-5678\\E1\\a.pdf'))).toThrow('CAT_TEST_PATH_REJECTED');
    expect(() => safety.fs.unlinkSync(at('03_LOGS\\b.html'))).toThrow('CAT_TEST_PATH_REJECTED');
  });
  it('keeps every other mutator denied, including bulk and rename operations', () => {
    for (const method of ['rmSync', 'rmdirSync', 'renameSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'symlinkSync']) {
      expect(() => (safety.fs as never as Record<string, () => void>)[method]!()).toThrow('CAT_TEST_5678_NOT_APPROVED');
    }
    rmSync(temp, { recursive: true, force: true });
  });
});

describe('staged copies', () => {
  it('are regenerable from the blocked candidate and always inactive', () => {
    expect(stage(blocked, 'INSPECT')).toEqual(inspect);
    expect(stage(blocked, 'FULL')).toEqual(full);
    for (const w of [inspect, full]) {
      expect(w.active).toBe(false);
      expect(node(w, 'Schedule Trigger').disabled).toBe(true);
      expect(node(w, 'Webhook Reproceso').disabled).toBe(true);
      expect(node(w, 'When clicking').disabled).toBe(false);
      expect(JSON.stringify(w)).not.toMatch(/daubert_global|Postgres produccion|XBIHVwg46DQuJc5S|9Ngnrpi16b6GtOAX|"cat-reprocess"/);
    }
  });
  it('INSPECT cannot touch PostgreSQL, write files or run commands, and ends before the snapshot is saved', () => {
    for (const n of inspect.nodes.filter(x => /\.(postgres|executeCommand)$/.test(x.type))) expect(JSON.stringify(n.parameters), n.name).toContain(HOLD_STATEMENT.slice(7, -2));
    for (const name of ['Guardar copia en entrada', 'Guardar HTML temporal']) expect(JSON.stringify(node(inspect, name).parameters)).toContain('CAT_TEST_5678_NOT_APPROVED');
    expect(inspect.nodes.every(n => !n.credentials)).toBe(true);
    expect(node(inspect, 'Resolver documento origen PG').type).toMatch(/\.code$/);
    expect(inspect.connections['Preparar snapshot admisi\u00F3n CAT']!.main).toEqual([[]]);
    expect(inspect.connections['Leer archivo detectado']!.main[0]![0]!.node).toBe('Extraccion de informacion de excel');
  });
  it('FULL removes the unconditional holds only where a confined or protected replacement exists', () => {
    for (const n of full.nodes.filter(x => /\.(postgres|executeCommand|readWriteFile)$/.test(x.type))) expect(JSON.stringify(n.parameters), n.name).not.toContain('CAT_TEST_5678_NOT_APPROVED');
    for (const n of full.nodes.filter(x => /\.code$/.test(x.type))) expect(String(n.parameters.jsCode), n.name).not.toContain(`// CAT_TEST_IO_HOLD\n${HOLD_STATEMENT}`);
    for (const n of full.nodes.filter(x => x.type.endsWith('.postgres'))) expect(n.credentials).toEqual(CAT_TEST_CREDENTIAL);
    expect(full.nodes.filter(n => n.credentials).length).toBe(full.nodes.filter(n => n.type.endsWith('.postgres')).length);
    expect((node(full, 'Webhook Reproceso').parameters as { path: string }).path).toBe('cat-test-reprocess-015');
    const sql = full.nodes.filter(n => n.type.endsWith('.postgres')).map(n => String(n.parameters.query)).join('\n');
    expect(sql).not.toMatch(/fn_crear_ejecucion_automatizacion|reservar_folios_para_ejecucion|fn_registrar_remision_generada|fn_finalizar_ejecucion_automatizacion|fn_registrar_fallo_ejecucion/);
    expect(sql).toContain('fn_guardar_snapshot_caterpillar_test');
  });
  it('FULL file nodes accept only confined paths and PowerShell nodes only the fixed TEST scripts', () => {
    const copy = node(full, 'Guardar copia en entrada').parameters.fileName;
    const ctx = (p: string) => ({ node: { 'Preparar archivo CAT': { json: { copy_file_path: p } } } });
    const run = (p: string) => new Function('$node', `return ${expression(copy)}`)(ctx(p).node);
    expect(run(sub('01_ENTRADA\\a.xlsx'))).toBe(sub('01_ENTRADA\\a.xlsx'));
    expect(() => run(sub('00_ARCHIVOS A PROCESAR\\a.xlsx'))).toThrow('CAT_TEST_PATH_REJECTED');
    const command = node(full, 'Convertir PDF CAT').parameters.command;
    const json = { pdf_script_path: sub(`05_ARCHIVOS AUXILIARES\\SCRIPTS\\convertir-cat-pdf.ps1`), temp_dir: sub(`${TEMP_SUBTREE}\\123`), output_dir: sub('02_SALIDAS') };
    expect(evaluate(command, { json })).toBe(`powershell -NoProfile -ExecutionPolicy Bypass -File "${json.pdf_script_path}" -TempDir "${json.temp_dir}" -OutDir "${json.output_dir}"`);
    for (const change of [{ pdf_script_path: sub('05_ARCHIVOS AUXILIARES\\SCRIPTS\\otro.ps1') }, { temp_dir: sub('06_ARCHIVOS TEMPORALES\\html') }, { output_dir: 'D:\\x' },
      { output_dir: sub('02_SALIDAS\\a" ; calc ; "') }]) expect(() => evaluate(command, { json: { ...json, ...change } })).toThrow('CAT_TEST_PATH_REJECTED');
  });
  it('every embedded Code body still compiles after the transformation', () => {
    for (const w of [inspect, full]) for (const n of w.nodes.filter(x => x.type.endsWith('.code'))) {
      expect(() => new Function('$input', '$', '$execution', 'require', String(n.parameters.jsCode)), n.name).not.toThrow();
    }
  });
});

describe('FAILURE TEST copy', () => {
  const failure = read(outputs.FAILURE);
  it('is regenerable, inactive and differs from FULL only in the failure injection and terminal ERROR finalization', () => {
    expect(stage(blocked, 'FAILURE')).toEqual(failure);
    expect(failure.name).toMatch(/FAILURE TEST$/);
    expect(failure.active).toBe(false);
    expect(node(failure, 'Schedule Trigger').disabled).toBe(true);
    expect(node(failure, 'Webhook Reproceso').disabled).toBe(true);
    expect(node(failure, 'Webhook Reproceso').parameters.path).not.toBe(node(full, 'Webhook Reproceso').parameters.path);
    expect(failure.connections).toEqual(full.connections);
    const changed = failure.nodes.filter(n => JSON.stringify(n) !== JSON.stringify(full.nodes.find(m => m.name === n.name))).map(n => n.name).sort();
    expect(changed).toEqual(['Convertir PDF CAT', 'Preparar error CAT', 'Registrar fallo PG', 'Webhook Reproceso CAT (TEST)']);
    expect(JSON.stringify(failure)).not.toMatch(/daubert_global|Postgres produccion|XBIHVwg46DQuJc5S|9Ngnrpi16b6GtOAX/);
  });
  it('fails the conversion with a non-zero exit through the existing error output, and finalizes through the owner-checked entry', () => {
    const convert = node(failure, 'Convertir PDF CAT');
    expect(String(convert.parameters.command)).toMatch(/exit 1/);
    expect((convert as unknown as { onError: string }).onError).toBe('continueErrorOutput');
    expect(failure.connections['Convertir PDF CAT']!.main[1]!.map(c => c.node)).toEqual(['Preparar error CAT']);
    const query = String(node(failure, 'Registrar fallo PG').parameters.query);
    expect(query).toMatch(/fn_finalizar_caterpillar_test\(\$1::bigint, \$2::text, 'ERROR', \$3::text, \$4::text\)/);
    expect(query).not.toMatch(/fn_fallo|fn_registrar_fallo/);
  });
});
