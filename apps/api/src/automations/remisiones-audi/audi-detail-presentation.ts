// Diagnostics are unstructured workflow text. Only short, plain business messages may leave
// the API; paths, credentials, payloads and technical dumps are deliberately withheld.
export function audiDiagnostic(message: string | null): string | null {
  if (!message?.trim()) return null;
  const text = message.trim();
  if (text.length > 300 || !/^[\p{L}\p{N}\s.,;:¡!¿?()'"–—-]+$/u.test(text)
    || /[\r\n\t]|password|contrase[ñn]a|secret|token|authorization|bearer|api.?key|credential|credencial|stack|query|select\b|insert\b|update\b|delete\b|postgres|sql\b|payload|ruta\b|path\b|https?:|file:|[a-z]:/i.test(text)) {
    return 'Existe un diagnóstico registrado cuyo contenido técnico no se muestra.';
  }
  return text;
}

export function audiSourceFilename(filename: string | null): string | null {
  return filename?.split(/[\\/]/).pop()?.trim() || null;
}
