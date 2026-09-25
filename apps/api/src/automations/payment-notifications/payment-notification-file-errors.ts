// File-level errors: n8n records a PDF it could not associate with any company (so there is no
// empresa_id yet) as one line in core.correos_notificacion_pago.detalle_error, e.g.
//
//   13.-KARINA MEZA.pdf: ALIAS_NO_CATALOGADO - KARINA MEZA | HASH=<sha256>
//
// Production may store several records separated by newlines (LF/CRLF/CR) AND/OR several records on
// the same line separated by " | ", e.g. `<rec1> | HASH=<h1> | <rec2> | HASH=<h2>`. Splitting on "|" is
// therefore not possible (every record itself contains "| HASH=").
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

// Strategy: the only reliable record boundary is the terminator `| HASH=<64 hex>` (followed by end of
// text, a newline, or a " | " separator). The text is scanned once for terminators; the text between
// two terminators is one candidate record, which must then match `<fileName>: <CODE>[ - <detail>]`.
// - errorCode is an open pattern (no whitelist): future codes parse without code changes.
// - detail is optional (null when absent/empty) and can never contain a terminator, because a
//   terminator always closes the record.
// - A record whose HASH is missing/invalid has no terminator, so it is dropped rather than guessed;
//   any leftover text before a later valid terminator (e.g. an invalid-hash record's remains) is
//   discarded up to its last "HASH=" token so it never leaks into the next record.
const TERMINATOR = /\|\s*HASH=([0-9a-fA-F]{64})(?![0-9a-fA-F])(?=[ \t]*(?:$|[\r\n]|\|))/g;
const RECORD = /^(.+?):\s+([A-Z][A-Z0-9_]*)(?:\s+-(?:\s+(.*))?)?$/;
const HASH_TOKEN = /HASH=\S*/g;

export function parsePaymentNotificationFileErrors(detalleError: string | null | undefined): PaymentNotificationFileError[] {
  if (typeof detalleError !== 'string' || detalleError.trim() === '') return [];
  const fileErrors: PaymentNotificationFileError[] = [];
  let recordStart = 0;
  for (const terminator of detalleError.matchAll(TERMINATOR)) {
    const fileHash = terminator[1]!;
    const candidate = lastRecordText(detalleError.slice(recordStart, terminator.index));
    recordStart = terminator.index + terminator[0].length;
    const match = RECORD.exec(candidate);
    if (!match) continue;
    const fileName = match[1]!.trim();
    if (!fileName) continue;
    const detail = match[3]?.trim();
    fileErrors.push({ fileName, errorCode: match[2]!, detail: detail ? detail : null, fileHash });
  }
  return fileErrors;
}

// A candidate may be preceded by unrelated lines (records never span lines, so only the last line
// counts) and by the remains of a previous record whose HASH was invalid (cut after its last
// "HASH=" token and the " | " separator that follows it).
function lastRecordText(segment: string): string {
  const lastLine = segment.split(/\r\n|\n|\r/).map((line) => line.trim()).filter((line) => line !== '').pop() ?? '';
  let text = lastLine;
  for (const token of lastLine.matchAll(HASH_TOKEN)) text = lastLine.slice(token.index + token[0].length);
  return text.replace(/^\s*\|\s*/, '').trim();
}
