import { useSyncExternalStore } from 'react';

/**
 * Entorno de emisión de los documentos de Manufactura, tal como lo informa el servidor (GET /documents/capabilities): PRUEBA en TEST y PRODUCCION en PROD.
 * Hasta que el servidor responda se asume PRUEBA (el rótulo más cauteloso). La interfaz nunca decide el entorno por su cuenta: solo lo muestra.
 */
export type EntornoEmision = 'PRUEBA' | 'PRODUCCION';

let actual: EntornoEmision = 'PRUEBA';
const oyentes = new Set<() => void>();

export function fijarEntornoEmision(entorno: EntornoEmision | undefined): void {
  const siguiente: EntornoEmision = entorno === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBA';
  if (siguiente === actual) return;
  actual = siguiente;
  oyentes.forEach((oyente) => oyente());
}

export function useEntornoEmision(): { entorno: EntornoEmision; esPrueba: boolean; texto: string } {
  const entorno = useSyncExternalStore((cb) => { oyentes.add(cb); return () => { oyentes.delete(cb); }; }, () => actual, () => 'PRUEBA' as EntornoEmision);
  return { entorno, esPrueba: entorno === 'PRUEBA', texto: entorno === 'PRODUCCION' ? 'PRODUCCIÓN' : 'PRUEBA' };
}
