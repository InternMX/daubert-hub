import 'reflect-metadata';

/**
 * vitest (esbuild) NO emite `design:paramtypes`, y sin ellos el ValidationPipe no valida ni transforma el cuerpo. `tsc`/`nest build` sí los emite (se verifica con `dist`: p. ej. create → [CreateClientDto, Object]).
 * Este ayudante declara los mismos metadatos para que las pruebas HTTP ejerzan la validación y transformación REALES de los DTO con la configuración efectiva de la API.
 */
export function emitirTiposDeParametros(controlador: { prototype: object }, tipos: Record<string, unknown[]>): void {
  for (const [metodo, lista] of Object.entries(tipos)) Reflect.defineMetadata('design:paramtypes', lista, controlador.prototype, metodo);
}
