// Audi has no trusted catalog for its unstructured error_mensaje values. Deny by default:
// never forward persisted text. Only null represents the absence of a recorded diagnostic.
export function audiDiagnostic(message: string | null): string | null {
  return message === null ? null : 'La ejecución registró un error. Consulta los registros autorizados para más información.';
}

export function audiSourceFilename(filename: string | null): string | null {
  return filename?.split(/[\\/]/).pop()?.trim() || null;
}
