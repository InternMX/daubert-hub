// Exact `normalizar` from n8n's "Clasificar con catalogo" (PROD export).
// The filename prefix/suffix removal is separate: the supplied value is already an alias.
export function normalizePaymentAlias(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function requiresPermanentAliasConfirmation(alias: string): boolean {
  return /^\d[\d ]*$/.test(alias) || /\d{6,}/.test(alias)
    || /\b(FACTURA|FOLIO|DOCUMENTO|COMPROBANTE|TEMP|TEMPORAL|UUID)\b/.test(alias)
    || /^[A-F0-9]{8}(?: [A-F0-9]{4}){3} [A-F0-9]{12}$/.test(alias);
}
