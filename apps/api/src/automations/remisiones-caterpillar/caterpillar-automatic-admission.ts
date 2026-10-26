import { adaptCaterpillarNormalizedItems } from './caterpillar-operational-manifest.adapter';
import { buildCaterpillarOperationalManifest, type NormalizedCaterpillarLine } from './caterpillar-operational-manifest';

export interface CaterpillarAdmissionInput {
  sourceCompanyId: string;
  fileName: string;
  normalizedItems: unknown;
}
export interface CaterpillarAdmissionCandidate {
  sourceCompanyId: string;
  normalizedName: string;
  programmingKey: string;
  scopeKey: string;
  manifestCanonical: string;
}
export interface CaterpillarAdmissionSnapshot {
  version: 'CAT_ADMISSION_V1';
  programmingKey: string;
  manifestCanonical: string;
}
export interface CaterpillarAdmissionHistoryEntry {
  documentId: string;
  sourceCompanyId: string;
  fileName: string;
  executionId: string | null;
  executionState: string | null;
  generatedCount: number;
  cancelledCount: number;
  pendingCount: number;
  admissionSnapshot: unknown;
}
export interface CaterpillarAdmissionHistory {
  complete: boolean;
  entries: readonly CaterpillarAdmissionHistoryEntry[];
}
export type CaterpillarAdmissionReason = 'NEW_NAME_AND_CONTENT' | 'PROGRAM_IN_PROGRESS' | 'PROGRAM_ALREADY_EMITTED'
  | 'REGENERATION_AUTHORIZATION_REQUIRED' | 'MANUAL_REPROCESS_REQUIRED' | 'MANIFEST_MATCH_REVIEW' | 'HISTORY_UNAVAILABLE' | 'LEGACY_NAME_MATCH';
export interface CaterpillarAdmissionDecision {
  decision: 'ADMIT' | 'BLOCK' | 'REVIEW';
  reason: CaterpillarAdmissionReason;
  programmingKey: string;
  matchingDocumentIds: string[];
  matchingExecutionIds: string[];
  // This advisory result is NEVER a claim, authorization or right to reserve/emit.
  canReserveFolios: false;
  requiresAtomicDatabaseCheck: true;
  deliveryIdentity: 'UNCONFIRMED';
  legacyContentUnverifiedDocumentIds: string[];
}
const snapshotVersion = 'CAT_ADMISSION_V1';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const keyText = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
function companyId(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n) throw new Error('Invalid source company ID');
  return value;
}
export function normalizeCaterpillarProgrammingName(fileName: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not contain
  if (typeof fileName !== 'string' || /[\\/:*?"<>|\x00-\x1f]/.test(fileName) || fileName.trim().startsWith('~$')) throw new Error('Expected an Excel basename, not a path');
  const match = /^(.*)\.(xlsx|xlsm|xls)$/i.exec(fileName.trim());
  if (!match || !keyText(match[1]!)) throw new Error('Invalid Excel programming name');
  // Excel extension is not programming identity. Preserve punctuation, dates and digits.
  return keyText(match[1]!);
}
function keys(sourceCompanyId: string, fileName: string, scope: readonly string[]) {
  // Existing routing scope: descriptive client name/RFC must not create a bypass namespace.
  const parts = [companyId(sourceCompanyId), ...scope.slice(0, 3).map(keyText)];
  return { scopeKey: JSON.stringify(parts), programmingKey: JSON.stringify([snapshotVersion, ...parts, normalizeCaterpillarProgrammingName(fileName)]) };
}
export function createCaterpillarAdmissionCandidate(input: CaterpillarAdmissionInput): CaterpillarAdmissionCandidate {
  const { manifest } = adaptCaterpillarNormalizedItems(input.normalizedItems);
  return { sourceCompanyId: companyId(input.sourceCompanyId), normalizedName: normalizeCaterpillarProgrammingName(input.fileName),
    ...keys(input.sourceCompanyId, input.fileName, manifest.scope), manifestCanonical: JSON.stringify(manifest) };
}
export function createCaterpillarAdmissionSnapshot(candidate: CaterpillarAdmissionCandidate): CaterpillarAdmissionSnapshot {
  return { version: snapshotVersion, programmingKey: candidate.programmingKey, manifestCanonical: candidate.manifestCanonical };
}

export function readCaterpillarAdmissionSnapshot(value: unknown, sourceCompanyId: string, fileName: string): CaterpillarAdmissionSnapshot | null {
  if (!record(value) || value.version !== snapshotVersion || typeof value.programmingKey !== 'string' || typeof value.manifestCanonical !== 'string') return null;
  const scope = historicalScope(value.manifestCanonical);
  if (!scope) return null;
  try {
    if (value.programmingKey !== keys(sourceCompanyId, fileName, scope).programmingKey) return null;
    return { version: snapshotVersion, programmingKey: value.programmingKey, manifestCanonical: value.manifestCanonical };
  } catch { return null; }
}

// Reuse V1 to validate persisted canonical JSON. Never invent historical OC/unit/numeric quantities.
function historicalScope(canonical: unknown): readonly string[] | null {
  try {
    if (typeof canonical !== 'string') return null;
    const manifest: unknown = JSON.parse(canonical);
    if (!record(manifest) || !Array.isArray(manifest.scope) || manifest.scope.length !== 5 ||
      !manifest.scope.every(v => typeof v === 'string') || typeof manifest.deliveryDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(manifest.deliveryDate) || !Array.isArray(manifest.documents)) return null;
    const scope = manifest.scope as string[];
    const lines: NormalizedCaterpillarLine[] = [];
    for (const document of manifest.documents) {
      if (!record(document) || typeof document.purchaseOrder !== 'string' || !Array.isArray(document.lines)) return null;
      for (const tuple of document.lines) {
        if (!Array.isArray(tuple) || tuple.length !== 5 || !tuple.slice(0, 3).every(v => typeof v === 'string') ||
          tuple[2] !== document.purchaseOrder || typeof tuple[3] !== 'number' || typeof tuple[4] !== 'string') return null;
        lines.push({ cliente_grupo: scope[0]!, planta_codigo: scope[1]!, subplanta_codigo: scope[2]!, cliente: scope[3]!, rfc: scope[4]!,
          fecha_entrega: manifest.deliveryDate.split('-').reverse().join('/'), codigo: tuple[0], numero_parte: tuple[1],
          orden_compra: tuple[2], cantidad_numerica: tuple[3], unidad_remision: tuple[4] });
      }
    }
    return JSON.stringify(buildCaterpillarOperationalManifest(lines)) === canonical ? scope : null;
  } catch { return null; }
}

export function decideCaterpillarAutomaticAdmission(candidate: CaterpillarAdmissionCandidate, history: CaterpillarAdmissionHistory): CaterpillarAdmissionDecision {
  const legacyIds = new Set<string>();
  const result = (decision: CaterpillarAdmissionDecision['decision'], reason: CaterpillarAdmissionReason,
    matches: readonly CaterpillarAdmissionHistoryEntry[] = []): CaterpillarAdmissionDecision => ({
    decision, reason, programmingKey: candidate.programmingKey,
    matchingDocumentIds: [...new Set(matches.map(row => row.documentId))],
    matchingExecutionIds: [...new Set(matches.flatMap(row => row.executionId ? [row.executionId] : []))],
    canReserveFolios: false, requiresAtomicDatabaseCheck: true, deliveryIdentity: 'UNCONFIRMED',
    legacyContentUnverifiedDocumentIds: [...legacyIds]
  });
  if (!history.complete) return result('REVIEW', 'HISTORY_UNAVAILABLE');
  const relevant: Array<{ row: CaterpillarAdmissionHistoryEntry; programmingKey: string; manifestCanonical: string }> = [];
  const legacyNameMatches: CaterpillarAdmissionHistoryEntry[] = [];
  for (const row of history.entries) {
    if (row.sourceCompanyId !== candidate.sourceCompanyId) continue;
    if (![row.generatedCount, row.cancelledCount, row.pendingCount].every(n => Number.isInteger(n) && n >= 0) ||
      (row.executionId === null ? row.executionState !== null || row.generatedCount + row.cancelledCount + row.pendingCount > 0 :
        !['PROCESANDO', 'COMPLETADA', 'ERROR', 'CANCELADA'].includes(row.executionState ?? ''))) return result('REVIEW', 'HISTORY_UNAVAILABLE');
    const snapshot = row.admissionSnapshot;
    if (snapshot === null && row.executionId !== null) {
      legacyIds.add(row.documentId);
      let oldName;
      try { oldName = normalizeCaterpillarProgrammingName(row.fileName); } catch { return result('REVIEW', 'HISTORY_UNAVAILABLE'); }
      if (oldName === candidate.normalizedName) legacyNameMatches.push(row);
      continue; // Protect name across the company; NEVER infer a historical plant/manifest.
    }
    const scope = record(snapshot) ? historicalScope(snapshot.manifestCanonical) : null;
    if (!record(snapshot) || snapshot.version !== snapshotVersion || !scope) return result('REVIEW', 'HISTORY_UNAVAILABLE');
    let historicalKeys;
    try { historicalKeys = keys(row.sourceCompanyId, row.fileName, scope); } catch { return result('REVIEW', 'HISTORY_UNAVAILABLE'); }
    if (snapshot.programmingKey !== historicalKeys.programmingKey) return result('REVIEW', 'HISTORY_UNAVAILABLE');
    if (historicalKeys.scopeKey === candidate.scopeKey) relevant.push({ row, programmingKey: historicalKeys.programmingKey, manifestCanonical: snapshot.manifestCanonical as string });
  }
  if (legacyNameMatches.length) return result('REVIEW', 'LEGACY_NAME_MATCH', legacyNameMatches);
  const sameName = relevant.filter(entry => entry.programmingKey === candidate.programmingKey).map(entry => entry.row);
  const running = sameName.filter(row => row.executionState === 'PROCESANDO');
  if (running.length) return result('BLOCK', 'PROGRAM_IN_PROGRESS', running);
  const cancelled = sameName.filter(row => row.executionState === 'CANCELADA' || row.cancelledCount > 0);
  if (cancelled.length) return result('BLOCK', 'REGENERATION_AUTHORIZATION_REQUIRED', cancelled);
  const emitted = sameName.filter(row => row.executionState === 'COMPLETADA' || row.generatedCount > 0);
  if (emitted.length) return result('BLOCK', 'PROGRAM_ALREADY_EMITTED', emitted);
  const failed = sameName.filter(row => row.executionState === 'ERROR' || row.pendingCount > 0);
  if (failed.length) return result('BLOCK', 'MANUAL_REPROCESS_REQUIRED', failed);
  const contentMatches = relevant.filter(entry => entry.manifestCanonical === candidate.manifestCanonical &&
    (entry.row.executionState === 'PROCESANDO' || entry.row.executionState === 'COMPLETADA' || entry.row.executionState === 'CANCELADA' || entry.row.generatedCount + entry.row.cancelledCount > 0)).map(entry => entry.row);
  if (contentMatches.length) return result('REVIEW', 'MANIFEST_MATCH_REVIEW', contentMatches);
  return result('ADMIT', 'NEW_NAME_AND_CONTENT');
}
