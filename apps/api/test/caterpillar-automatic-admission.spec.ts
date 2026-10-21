import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createCaterpillarAdmissionCandidate as candidate, createCaterpillarAdmissionSnapshot as snapshot,
  decideCaterpillarAutomaticAdmission as decide, normalizeCaterpillarProgrammingName as normalizeName,
  type CaterpillarAdmissionHistoryEntry, type CaterpillarAdmissionInput } from '../src/automations/remisiones-caterpillar/caterpillar-automatic-admission';
import { CaterpillarExecutionsRepository } from '../src/automations/remisiones-caterpillar/caterpillar-executions.repository';
import { CaterpillarExecutionsService } from '../src/automations/remisiones-caterpillar/caterpillar-executions.service';

type Item = { json: Record<string, unknown> };
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')) as { normal: Item[]; torreonBeforeGrouping: Item[] };
function input(fileName = 'PROGRAMACION 001.xlsx', patch: Record<string, unknown> = {}, sourceCompanyId = '1207'): CaterpillarAdmissionInput {
  return { sourceCompanyId, fileName, normalizedItems: fixture.normal.map(item => ({ json: { ...item.json, ...patch } })) };
}
function history(source = input(), changes: Partial<CaterpillarAdmissionHistoryEntry> = {}): CaterpillarAdmissionHistoryEntry {
  return { documentId: '10', sourceCompanyId: source.sourceCompanyId, fileName: source.fileName, executionId: '20',
    executionState: 'COMPLETADA', generatedCount: 2, cancelledCount: 0, pendingCount: 0,
    admissionSnapshot: snapshot(candidate(source)), ...changes };
}
const assess = (source: CaterpillarAdmissionInput, entries: CaterpillarAdmissionHistoryEntry[] = []) => decide(candidate(source), { complete: true, entries });

describe('Caterpillar automatic admission — pure policy, no DB or emission', () => {
  it('admits a new name/content but never grants permission to reserve or confirms delivery identity', () => {
    expect(assess(input())).toMatchObject({ decision: 'ADMIT', reason: 'NEW_NAME_AND_CONTENT', canReserveFolios: false,
      requiresAtomicDatabaseCheck: true, deliveryIdentity: 'UNCONFIRMED' });
  });
  it('admits a legitimate new name with different content', () => {
    expect(assess(input('PROGRAMACION 002.xlsx', { cantidad_numerica: 12 }), [history()])).toMatchObject({ decision: 'ADMIT' });
  });
  it('blocks the same processed file', () => {
    expect(assess(input(), [history()])).toMatchObject({ decision: 'BLOCK', reason: 'PROGRAM_ALREADY_EMITTED', matchingDocumentIds: ['10'], matchingExecutionIds: ['20'] });
  });
  it('blocks a modified/saved Excel with the same programming name despite physical and operational changes', () => {
    expect(assess(input('PROGRAMACION 001.xlsx', { hash_archivo: 'new-physical-hash', cantidad_numerica: 99, orden_compra: 'CHANGED-OC' }),
      [history(input('PROGRAMACION 001.xlsx', { hash_archivo: 'old-physical-hash' }))])).toMatchObject({ decision: 'BLOCK', reason: 'PROGRAM_ALREADY_EMITTED' });
  });
  it('ignores operational folders for the logical key', () => {
    const a = input('PROGRAMACION 001.xlsx', { file_path: 'synthetic/input/a.xlsx' });
    const b = input('PROGRAMACION 001.xlsx', { file_path: 'synthetic/moved/a.xlsx' });
    expect(candidate(a).programmingKey).toBe(candidate(b).programmingKey);
    expect(assess(b, [history(a)]).decision).toBe('BLOCK');
  });
  it('normalizes case, Unicode NFC, whitespace and Excel extensions only', () => {
    expect(normalizeName('  programacio\u0301n   001.XLSM ')).toBe('PROGRAMACIÓN 001');
    expect(normalizeName('PROGRAMACIÓN 001.xlsx')).toBe(normalizeName('programación 001.xls'));
    expect(normalizeName('PROGRAMACION-001.xlsx')).not.toBe(normalizeName('PROGRAMACION 001.xlsx'));
    expect(assess(input(' programacion   001.xlsm '), [history()]).decision).toBe('BLOCK');
  });
  it.each(['../x.xlsx', 'C:\\private\\x.xlsx', 'folder/x.xlsx', '~$temp.xlsx', '.xlsx', 'no-extension'])('rejects invalid basename %s', name => {
    expect(() => candidate(input(name))).toThrow();
  });
  it('marks a renamed/re-exported identical manifest for review, not as a confirmed duplicate', () => {
    expect(assess(input('RENAMED.xlsx', { hash_archivo: 'reexported', file_path: 'synthetic/renamed.xlsx' }), [history()]))
      .toMatchObject({ decision: 'REVIEW', reason: 'MANIFEST_MATCH_REVIEW', canReserveFolios: false });
  });
  it('admits an updated AND renamed file if both policy keys differ (documented heuristic limit)', () => {
    expect(assess(input('RENAMED.xlsx', { cantidad_numerica: 77 }), [history()])).toMatchObject({ decision: 'ADMIT' });
  });
  it('checks older emitted versions, not just the newest failed document/hash', () => {
    const newer = history(input('PROGRAMACION 001.xlsx', { cantidad_numerica: 5 }), { documentId: '11', executionId: '21', executionState: 'ERROR', generatedCount: 0 });
    expect(assess(input('PROGRAMACION 001.xlsx', { cantidad_numerica: 8 }), [newer, history()]))
      .toMatchObject({ decision: 'BLOCK', reason: 'PROGRAM_ALREADY_EMITTED', matchingDocumentIds: ['10'] });
  });
  it('detects identical content in an older version even if newer content differs', () => {
    expect(assess(input('OTHER.xlsx'), [history(input('OTHER-OLD.xlsx', { cantidad_numerica: 33 }), { documentId: '11', executionId: '21' }), history()]))
      .toMatchObject({ decision: 'REVIEW', reason: 'MANIFEST_MATCH_REVIEW' });
  });
  it.each([
    { executionState: 'COMPLETADA', generatedCount: 0, cancelledCount: 2 },
    { executionState: 'CANCELADA', generatedCount: 0 }
  ])('keeps cancelled programming blocked without regeneration authorization %j', changes => {
    expect(assess(input('PROGRAMACION 001.xlsx', { cantidad_numerica: 44 }), [history(input(), changes)]))
      .toMatchObject({ decision: 'BLOCK', reason: 'REGENERATION_AUTHORIZATION_REQUIRED' });
  });
  it('does not forget historical emission when all remissions are now cancelled and the file is renamed', () => {
    expect(assess(input('NEW-NAME.xlsx'), [history(input(), { generatedCount: 0, cancelledCount: 2 })]))
      .toMatchObject({ decision: 'REVIEW', reason: 'MANIFEST_MATCH_REVIEW' });
  });
  it('reviews renamed cancelled programming even when cancellation occurred before emitting remissions', () => {
    expect(assess(input('NEW-NAME.xlsx'), [history(input(), { executionState: 'CANCELADA', generatedCount: 0 })]))
      .toMatchObject({ decision: 'REVIEW', reason: 'MANIFEST_MATCH_REVIEW' });
  });
  it('blocks a concurrent attempt for the same name even with different content/hash', () => {
    expect(assess(input('PROGRAMACION 001.xlsx', { cantidad_numerica: 8 }), [history(input(), { executionState: 'PROCESANDO', generatedCount: 0 })]))
      .toMatchObject({ decision: 'BLOCK', reason: 'PROGRAM_IN_PROGRESS' });
  });
  it('reviews renamed equivalent content that another execution is still processing', () => {
    expect(assess(input('RENAME.xlsx'), [history(input(), { executionState: 'PROCESANDO', generatedCount: 0 })]))
      .toMatchObject({ decision: 'REVIEW', reason: 'MANIFEST_MATCH_REVIEW' });
  });
  it('two simultaneous empty-history assessments are NOT an exclusive database claim', async () => {
    const results = await Promise.all([Promise.resolve(assess(input())), Promise.resolve(assess(input()))]);
    expect(results.every(r => r.decision === 'ADMIT' && !r.canReserveFolios && r.requiresAtomicDatabaseCheck)).toBe(true);
  });
  it('does not bypass manual reprocessing for an ERROR without emitted remissions', () => {
    expect(assess(input(), [history(input(), { executionState: 'ERROR', generatedCount: 0 })]))
      .toMatchObject({ decision: 'BLOCK', reason: 'MANUAL_REPROCESS_REQUIRED' });
  });
  it.each([{ cliente_grupo: 'OTHER_CLIENT_GROUP' }, { planta_codigo: 'P6' }, { subplanta_codigo: 'OTHER' }])('separates verified client/plant/subplant scope %j', scope => {
    expect(assess(input('PROGRAMACION 001.xlsx', scope), [history()]).decision).toBe('ADMIT');
  });
  it.each([{ cliente: 'Nombre actualizado del mismo cliente' }, { rfc: 'UPDATED-TEST' }])('does not create another logical namespace from descriptive client data %j', change => {
    expect(assess(input('PROGRAMACION 001.xlsx', change), [history()]).decision).toBe('BLOCK');
  });
  it('separates source-company ownership', () => {
    expect(assess(input('PROGRAMACION 001.xlsx', {}, '1'), [history()]).decision).toBe('ADMIT');
  });
  it('does not confuse Torreon subplants sharing the same documentary series', () => {
    const torreon = (subplant: string): CaterpillarAdmissionInput => ({ sourceCompanyId: '1207', fileName: 'TORREON.xlsx',
      normalizedItems: fixture.torreonBeforeGrouping.map(i => ({ json: { ...i.json, planta_codigo: 'TORREON', subplanta_codigo: subplant } })) });
    expect(assess(torreon('PLANTA_2'), [history(torreon(''))]).decision).toBe('ADMIT');
  });
  it('an analyzed document without execution/emission does not itself count as processed', () => {
    expect(assess(input(), [history(input(), { executionId: null, executionState: null, generatedCount: 0 })]).decision).toBe('ADMIT');
  });
  it.each([null, {}, { version: 'OLD' }, { version: 'CAT_ADMISSION_V1', programmingKey: 'spoofed', manifestCanonical: candidate(input()).manifestCanonical },
    { ...snapshot(candidate(input())), manifestCanonical: '{bad-json' }])('fails closed for absent/unreliable historical metadata %j', admissionSnapshot => {
    expect(assess(input('NEW.xlsx', { cantidad_numerica: 9 }), [history(input(), { admissionSnapshot })]))
      .toMatchObject({ decision: 'REVIEW', reason: 'HISTORY_UNAVAILABLE' });
  });
  it('does not treat missing storage/coverage as an empty history', () => {
    expect(decide(candidate(input()), { complete: false, entries: [] })).toMatchObject({ decision: 'REVIEW', reason: 'HISTORY_UNAVAILABLE' });
  });
  it('fails closed for unknown execution states or inconsistent counters', () => {
    for (const changes of [{ executionState: 'UNKNOWN' }, { generatedCount: -1 }, { executionId: null }]) {
      expect(assess(input('NEW.xlsx'), [history(input(), changes)]).reason).toBe('HISTORY_UNAVAILABLE');
    }
  });
});

describe('Caterpillar admission reader/service — mocked database only', () => {
  function service(row: unknown) {
    const findAutomaticAdmissionHistory = vi.fn().mockResolvedValue(row);
    const webhook = { triggerReprocess: vi.fn() };
    return { reader: findAutomaticAdmissionHistory, webhook, service: new CaterpillarExecutionsService(
      { findAutomaticAdmissionHistory } as never, {} as never, webhook as never, {} as never) };
  }
  it('uses one read-only query with every version/attempt, no hash/ruta/latest filter, and no uninstalled-column reference', async () => {
    const query = vi.fn().mockResolvedValue([{ database_name: 'daubert_hub_test', snapshot_storage_ready: false, entries: [] }]);
    const repo = new CaterpillarExecutionsRepository({ query } as never);
    await repo.findAutomaticAdmissionHistory('1207');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(parameters).toEqual(['1207']);
    expect(sql).toContain("a.codigo = 'REMISIONES_CATERPILLAR'");
    expect(sql).toContain("current_database()='daubert_hub_test'");
    expect(sql).toContain("to_jsonb(d)->'caterpillar_admission'");
    expect(sql).toContain("NULLIF(to_jsonb(d)->'caterpillar_admission','null'::jsonb) IS NOT NULL");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|LIMIT|DISTINCT ON)\b|hash_archivo\s*=|ruta_archivo\s*=/i);
    expect(sql).not.toContain('d.caterpillar_admission');
    expect(sql).toContain("r.estatus='CANCELADA'");
  });
  it('connects the internal decision to the repository without triggering n8n or any write', async () => {
    const state = service({ database_name: 'daubert_hub_test', snapshot_storage_ready: true, entries: [history()] });
    expect(await state.service.assessAutomaticAdmission(input())).toMatchObject({ decision: 'BLOCK', reason: 'PROGRAM_ALREADY_EMITTED' });
    expect(state.reader).toHaveBeenCalledWith('1207');
    expect(state.webhook.triggerReprocess).not.toHaveBeenCalled();
  });
  it.each([null, { database_name: 'daubert_global', snapshot_storage_ready: true, entries: [] },
    { database_name: 'daubert_hub_test', snapshot_storage_ready: false, entries: [] }])('does not admit missing metadata/storage or another environment %j', async row => {
    await expect(service(row).service.assessAutomaticAdmission(input())).resolves.toMatchObject({ decision: 'REVIEW', reason: 'HISTORY_UNAVAILABLE' });
  });
  it('rejects invalid input before querying', async () => {
    const state = service(null);
    await expect(state.service.assessAutomaticAdmission(input('folder/x.xlsx'))).rejects.toBeInstanceOf(BadRequestException);
    expect(state.reader).not.toHaveBeenCalled();
  });
});
