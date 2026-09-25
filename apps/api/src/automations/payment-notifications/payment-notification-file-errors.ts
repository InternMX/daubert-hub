// File-level errors: n8n records a PDF it could not associate with any company (so there is no
// empresa_id yet) as one line in core.correos_notificacion_pago.detalle_error, e.g.
//
//   13.-KARINA MEZA.pdf: ALIAS_NO_CATALOGADO - KARINA MEZA | HASH=<sha256>
//
// These are a different universe from core.resultados_notificacion_pago (per-company LISTO/MANUAL/
// ERROR/OMITIDO, which requires correo_id + empresa_id). They are only surfaced here as structured
// data — never converted into fake per-company result rows. n8n remains the source of truth and the
// only owner of selective reprocessing (it re-reads these same HASH values by correo_id).
//
// Parsing lives in the backend so the frontend only renders already-structured data. The parser is
// pure and never throws: anything that cannot be guaranteed to honor the contract (no valid SHA-256,
// malformed line, legacy free text) is skipped rather than guessed.

export interface PaymentNotificationFileError {
  fileName: string;
  errorCode: string;
  detail: string | null;
  fileHash: string;
}

// <fileName>: <ERROR_CODE>[ - <detail>] | HASH=<64 hex>
// - fileName is lazy so it ends at the first ": <CODE>" that lets the rest of the line match.
// - errorCode is an open pattern (no whitelist): future codes parse without code changes.
// - detail is optional; the lazy match stops at the final " | HASH=" segment.
const FILE_ERROR_LINE = /^(.+?):\s+([A-Z][A-Z0-9_]*)(?:\s+-\s+(.*?))?\s*\|\s*HASH=([0-9a-fA-F]{64})\s*$/;

export function parsePaymentNotificationFileErrors(detalleError: string | null | undefined): PaymentNotificationFileError[] {
  if (typeof detalleError !== 'string' || detalleError.trim() === '') return [];
  const fileErrors: PaymentNotificationFileError[] = [];
  for (const line of detalleError.split(/\r\n|\n|\r/)) {
    const match = FILE_ERROR_LINE.exec(line.trim());
    if (!match) continue;
    const [, fileName, errorCode, detail, fileHash] = match;
    const trimmedFileName = fileName!.trim();
    if (!trimmedFileName) continue;
    const trimmedDetail = detail?.trim();
    fileErrors.push({ fileName: trimmedFileName, errorCode: errorCode!, detail: trimmedDetail ? trimmedDetail : null, fileHash: fileHash! });
  }
  return fileErrors;
}
