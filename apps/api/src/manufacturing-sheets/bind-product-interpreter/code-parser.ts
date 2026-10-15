import type { CodigoInterpretado, Resina } from './bind-product.types';

/**
 * Interpretación AUXILIAR del código DCMX: prefijo variable de cliente + F (Film) / P (Paper) + resina + consecutivo, con segmentos adicionales
 * posibles. El prefijo y el consecutivo no tienen longitud fija. El resultado nunca sobrescribe lo identificado en el título ni determina la familia.
 */
const CODIGO = /^(?<prefijo>[A-Z0-9]*?[A-Z])(?<material>[FP])(?<resina>CP5000|PMG|NAT|ESD|XOW)(?<consecutivo>\d+)(?<resto>.*)$/;

export function interpretarCodigo(code: string): CodigoInterpretado {
  const limpio = (code ?? '').trim().toUpperCase();
  const m = CODIGO.exec(limpio);
  if (!m?.groups) return { interpretable: false, prefijoCliente: null, material: null, resina: null, consecutivo: null, segmentosAdicionales: [] };
  const { prefijo, material, resina, consecutivo, resto } = m.groups as Record<string, string>;
  return {
    interpretable: true,
    prefijoCliente: prefijo ?? null,
    material: material === 'F' ? 'FILM' : 'PAPER',
    resina: (resina ?? null) as Resina | null,
    consecutivo: consecutivo ?? null,
    segmentosAdicionales: (resto ?? '').split(/[-_./\s]+/).filter(Boolean)
  };
}
