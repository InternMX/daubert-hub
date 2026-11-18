/** Entrega un archivo al usuario desde un Blob (mismo mecanismo que el PDF de borrador). */
export function guardarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url; enlace.download = nombre; enlace.rel = 'noopener';
  document.body.appendChild(enlace); enlace.click(); enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
