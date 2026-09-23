// Shared presentation rules for a COMPLETADA remission-generation execution (Audi and
// Caterpillar), so both sources render title/context with the same singular/plural and
// folio-range conventions instead of two independently hand-written copies (Phase 12A.6).

export function formatGeneratedRemissionsTitle(generatedCount: number): string {
  return generatedCount === 1 ? '1 remisión generada' : `${generatedCount} remisiones generadas`;
}

// Only ever states a folio range when it is truthful: the aggregate (count/min/max) must prove
// every folio in [min, max] was actually generated, i.e. the range is contiguous. MIN/MAX alone
// cannot guarantee that — e.g. folios 969, 970, 973 have min=969/max=973/count=3, which is NOT
// the same as "969–973" (that would wrongly imply 971 and 972 were also generated). Returns null
// for a non-contiguous aggregate or missing/invalid data, rather than fabricating a range or an
// alternate comma-separated list (Phase 12A.6a).
export function formatGeneratedFolioRange(generatedCount: number, minimumFolio: string | null, maximumFolio: string | null): string | null {
  const minimum = positiveBigInt(minimumFolio);
  const maximum = positiveBigInt(maximumFolio);
  if (minimum === null || maximum === null || !Number.isInteger(generatedCount) || generatedCount < 1) return null;
  if (generatedCount === 1) return minimum === maximum ? `Folio ${minimum}` : null;
  return BigInt(generatedCount) === maximum - minimum + 1n ? `Folios ${minimum}–${maximum}` : null;
}

function positiveBigInt(value: string | null): bigint | null {
  if (!value) return null;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}
