// Min/max display only — never proof that every folio in the interval exists (Phase 10F §15).
export function folioRangeLabel(firstFolio: string | null, lastFolio: string | null): string {
  if (firstFolio === null || lastFolio === null) return '—';
  if (firstFolio === lastFolio) return firstFolio;
  return `${firstFolio}–${lastFolio}`;
}
