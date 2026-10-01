// core.empresas.ruta_dropbox is a path RELATIVE to the Dropbox root that n8n resolves itself
// (e.g. `FLETES/TRANSPORTES KARINA`). Every existing row is persisted with "/" as separator, so "/"
// is the canonical persisted form; "\" is accepted on input (Windows users paste it that way) and
// normalized. Absolute locations (drive letters, UNC, POSIX roots) are rejected: the Dropbox root is
// n8n's concern, never the Hub's.
//
// core.empresas_notificacion_pago.ruta_destino is NOT NULL and is consumed by n8n with "\" separators
// and literal placeholders ({ANIO}, {MES_NUM}, {MES_NOMBRE_TITULO}) that n8n substitutes per month.
// The Hub only derives it from ruta_dropbox; the browser never sends it.

export type DropboxPathErrorCode =
  | 'DROPBOX_PATH_ABSOLUTE'
  | 'DROPBOX_PATH_TRAVERSAL'
  | 'DROPBOX_PATH_EMPTY_SEGMENT'
  | 'DROPBOX_PATH_SEGMENT_WHITESPACE'
  | 'DROPBOX_PATH_INVALID_CHARACTER'
  | 'DROPBOX_PATH_TOO_LONG';

export class DropboxPathError extends Error {
  constructor(readonly code: DropboxPathErrorCode) {
    super(code);
    this.name = 'DropboxPathError';
  }
}

export const DROPBOX_PATH_MAX_LENGTH = 200;

const SEPARATOR = '\\';
const PAYMENT_DESTINATION_SUFFIX = ['PAGOS', 'NOTIFICACIONES DE PAGO', '{ANIO}', '{MES_NUM}.- {MES_NOMBRE_TITULO}'].join(SEPARATOR);

// Same value as the column default of core.empresas_notificacion_pago.ruta_destino. Used when a
// company has no ruta_dropbox: the column is NOT NULL, so "no path" is represented by the schema default.
export const DEFAULT_PAYMENT_DESTINATION_PATH = PAYMENT_DESTINATION_SUFFIX;

// Characters Windows/Dropbox reject in names, control characters, plus braces so a path can never
// smuggle its own {PLACEHOLDER} into ruta_destino.
// eslint-disable-next-line no-control-regex
const INVALID_CHARACTERS = /[<>:"|?*{}\u0000-\u001f]/;

// undefined/null/blank => null (no path). A non-blank value must be a valid relative path; the result
// is the canonical "/"-separated form. Throws DropboxPathError otherwise.
export function normalizeDropboxPath(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // "C:\x", "C:x", "\\server\share", "//server/share", "/abs", "\abs" — all absolute or rooted.
  if (/^[A-Za-z]:/.test(trimmed) || /^[\\/]/.test(trimmed)) throw new DropboxPathError('DROPBOX_PATH_ABSOLUTE');
  if (INVALID_CHARACTERS.test(trimmed)) throw new DropboxPathError('DROPBOX_PATH_INVALID_CHARACTER');
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, '');
  const segments = withoutTrailingSeparators.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === '') throw new DropboxPathError('DROPBOX_PATH_EMPTY_SEGMENT');
    if (segment === '.' || segment === '..') throw new DropboxPathError('DROPBOX_PATH_TRAVERSAL');
    if (segment !== segment.trim() || segment.endsWith('.')) throw new DropboxPathError('DROPBOX_PATH_SEGMENT_WHITESPACE');
  }
  const canonical = segments.join('/');
  if (canonical.length > DROPBOX_PATH_MAX_LENGTH) throw new DropboxPathError('DROPBOX_PATH_TOO_LONG');
  return canonical;
}

// `<ruta_dropbox with "\">\PAGOS\NOTIFICACIONES DE PAGO\{ANIO}\{MES_NUM}.- {MES_NOMBRE_TITULO}`.
// Accepts either separator; a null/blank path yields the schema default (never a partial path).
export function buildPaymentDestinationPath(dropboxPath: string | null | undefined): string {
  const canonical = normalizeDropboxPath(dropboxPath);
  if (canonical === null) return DEFAULT_PAYMENT_DESTINATION_PATH;
  return [...canonical.split('/'), PAYMENT_DESTINATION_SUFFIX].join(SEPARATOR);
}

// ---- Destination protection when ruta_dropbox changes -----------------------------------------
// Historical companies carry their own ruta_destino template (same folder prefix as ruta_dropbox, but a
// different sub-path than the standard one). n8n consumes ruta_destino as stored, so a change of
// ruta_dropbox must move ONLY the prefix and keep the stored sub-path byte for byte.
//   NEW        no stored destination yet            -> standard destination for the new path
//   UNCHANGED  the path did not really change       -> leave the stored value alone
//   STANDARD   stored == standard(previous path)    -> regenerate the standard for the new path
//   HISTORICAL stored = <previous path>\<sub-path>  -> <new path>\<same sub-path> (clearing the path leaves it alone)
//   UNRELATED  stored does not start with the previous path -> leave it alone (never guessed, never overwritten)
export type DestinationChangeKind = 'NEW' | 'UNCHANGED' | 'STANDARD' | 'HISTORICAL' | 'UNRELATED';

export interface DestinationChangeDecision {
  kind: DestinationChangeKind;
  // null = keep the stored ruta_destino exactly as it is.
  destination: string | null;
}

// "\"-form of a STORED ruta_dropbox. Legacy rows are not revalidated here, so this never throws.
function storedPathWithSeparator(path: string | null | undefined): string | null {
  if (path === null || path === undefined) return null;
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  if (trimmed === '') return null;
  return trimmed.split(/[\\/]/).join(SEPARATOR);
}

export function resolveDestinationAfterDropboxChange(input: {
  previousDropboxPath: string | null | undefined;
  nextDropboxPath: string | null | undefined;
  currentDestination: string | null | undefined;
}): DestinationChangeDecision {
  const previous = storedPathWithSeparator(input.previousDropboxPath);
  // The new path must be valid (same DropboxPathError as before); it arrives canonical from the service.
  const nextCanonical = normalizeDropboxPath(input.nextDropboxPath);
  const next = nextCanonical === null ? null : nextCanonical.split('/').join(SEPARATOR);
  const standardForNext = next === null ? DEFAULT_PAYMENT_DESTINATION_PATH : next + SEPARATOR + PAYMENT_DESTINATION_SUFFIX;
  const current = input.currentDestination;

  if (current === null || current === undefined || current.trim() === '') return { kind: 'NEW', destination: standardForNext };
  if (previous === next) return { kind: 'UNCHANGED', destination: null };

  const standardForPrevious = previous === null ? PAYMENT_DESTINATION_SUFFIX : previous + SEPARATOR + PAYMENT_DESTINATION_SUFFIX;
  if (current === standardForPrevious) return { kind: 'STANDARD', destination: standardForNext };

  // Belongs to the previous path only on a whole-segment boundary ("A\B" is not a prefix of "A\BC\x"),
  // compared case-insensitively like Windows paths, with something left after the separator.
  if (previous !== null && current.length > previous.length + 1 && current.slice(0, previous.length).toLowerCase() === previous.toLowerCase() && current.charAt(previous.length) === SEPARATOR) {
    if (next === null) return { kind: 'HISTORICAL', destination: null };
    return { kind: 'HISTORICAL', destination: next + SEPARATOR + current.slice(previous.length + 1) };
  }
  return { kind: 'UNRELATED', destination: null };
}

// ---- Suggestion (phase 1.2) -------------------------------------------------------------------
// Pure, backend-owned proposal for ruta_dropbox from company type + commercial name. It never
// persists anything and is never used for ruta_destino unless the user confirms it as the actual
// path (which then goes through normalizeDropboxPath like any other input).
export type SuggestibleCompanyType = 'PROVEEDOR' | 'SERVICIO' | 'FLETE' | 'CLIENTE';

export const COMPANY_TYPE_DROPBOX_FOLDERS: Readonly<Record<SuggestibleCompanyType, string>> = {
  PROVEEDOR: 'PROVEEDORES',
  SERVICIO: 'PROVEEDOR DE SERVICIOS',
  FLETE: 'FLETES',
  CLIENTE: 'CLIENTES'
};

// Windows-invalid name characters (< > : " / \ | ? *), control characters and braces (a path must not
// carry its own {PLACEHOLDER}) become a space, so "A/B" stays readable as "A B".
// eslint-disable-next-line no-control-regex
const NAME_UNSAFE_CHARACTERS = /[<>:"/\\|?*{}\u0000-\u001f]/g;

function cleanSegmentEnd(value: string): string {
  return value.replace(/[\s.]+$/, '');
}

// Returns "<FOLDER>/<NAME>" or null when there is nothing safe to suggest (unknown type, blank name, a
// name made only of unsafe characters/dots). Accents, Ñ, digits and inner punctuation are kept. The
// result is always accepted by normalizeDropboxPath (verified before returning).
export function suggestDropboxPath(companyType: string | null | undefined, commercialName: string | null | undefined): string | null {
  if (!companyType || !Object.prototype.hasOwnProperty.call(COMPANY_TYPE_DROPBOX_FOLDERS, companyType)) return null;
  const folder = COMPANY_TYPE_DROPBOX_FOLDERS[companyType as SuggestibleCompanyType];
  let name = cleanSegmentEnd((commercialName ?? '').replace(NAME_UNSAFE_CHARACTERS, ' ').replace(/\s+/g, ' ').trim());
  if (name === '') return null;
  const room = DROPBOX_PATH_MAX_LENGTH - folder.length - 1;
  if (name.length > room) name = cleanSegmentEnd(name.slice(0, room));
  if (name === '' || name === '.' || name === '..') return null;
  const candidate = `${folder}/${name}`;
  try {
    return normalizeDropboxPath(candidate) === candidate ? candidate : null;
  } catch {
    return null;
  }
}
