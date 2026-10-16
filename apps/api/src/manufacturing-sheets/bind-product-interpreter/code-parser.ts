import type { CodigoInterpretado, Resina } from './bind-product.types';

/**
 * Interpretación AUXILIAR del código DCMX: prefijo variable de cliente + F (Film) / P (Paper) + clave de resina o material + segmentos opcionales + consecutivo.
 * El prefijo, los segmentos y el consecutivo no tienen longitud fija (no se asumen tres letras iniciales ni tres dígitos finales). El resultado nunca sobrescribe lo identificado
 * en el título ni determina la familia de manufactura: solo aporta SUGERENCIAS cuando el título omite un dato.
 *
 * Claves reconocidas: PMG, CP, NAT, LDPE, ESD, XOW y PWnn (papel: PW30, PW33…). «CP» es la familia CP5000: cuando le siguen dígitos (CP5000 + consecutivo, o CP + 5010…) el código
 * NO permite separarlos con certeza, así que no se parte (`claveAmbigua`, sin consecutivo). Si la letra F/P es implausible para la clave (p. ej. «P» + PMG, donde la P podría
 * pertenecer al prefijo), el material queda ambiguo (`materialAmbiguo`) y no se sugiere.
 */
const CODIGO = /^(?<prefijo>[A-Z0-9]*?[A-Z])(?<material>[FP])(?<clave>PW\d{2}|PMG|LDPE|NAT|ESD|XOW|CP)(?<resto>.*)$/;

const SIN_INTERPRETACION: CodigoInterpretado = {
  interpretable: false, prefijoCliente: null, material: null, materialAmbiguo: false, claveMaterial: null, claveAmbigua: false, resina: null, consecutivo: null, segmentosAdicionales: []
};

// La clave del código que corresponde a una casilla de Composición. LDPE (polietileno natural) se asocia a Natural en el histórico; CP es la familia CP5000.
const RESINA_DE_CLAVE: Record<string, Resina | null> = { PMG: 'PMG', CP: 'CP5000', NAT: 'NAT', LDPE: 'NAT', ESD: 'ESD', XOW: 'XOW' };
const CLAVES_SOLO_FILM = new Set(['PMG', 'LDPE', 'ESD', 'XOW', 'CP']);

export function interpretarCodigo(code: string): CodigoInterpretado {
  const limpio = (code ?? '').trim().toUpperCase();
  const m = CODIGO.exec(limpio);
  if (!m?.groups) return SIN_INTERPRETACION;
  const { prefijo, material, clave, resto } = m.groups as Record<string, string>;
  const esPapel = (clave as string).startsWith('PW');
  const claveAmbigua = clave === 'CP' && /^\d/.test(resto as string);
  let consecutivo: string | null = null;
  let segmentos: string[] = [];
  if (!claveAmbigua) {
    // Resto = [separadores] [segmento de letras, p. ej. OC] [consecutivo numérico] [sufijos separados por - _ . / espacio]
    const r = /^[-_./\s]*(?<segmento>[A-Z]*)(?<numero>\d+)?(?<sufijos>.*)$/.exec(resto as string);
    const numero = r?.groups?.numero ?? null;
    if (numero === null) return SIN_INTERPRETACION;                      // sin consecutivo numérico no es un código DCMX interpretable (p. ej. «SCHFPMG»)
    consecutivo = numero;
    segmentos = [r?.groups?.segmento ?? '', ...(r?.groups?.sufijos ?? '').split(/[-_./\s]+/)].filter(Boolean);
  }
  const materialLetra = material === 'F' ? 'FILM' : 'PAPER';
  // Combinaciones implausibles: Paper con una resina de film, o Film con una clave de papel.
  const implausible = (materialLetra === 'PAPER' && CLAVES_SOLO_FILM.has(clave as string)) || (materialLetra === 'FILM' && esPapel);
  return {
    interpretable: true,
    prefijoCliente: prefijo ?? null,
    material: implausible ? null : materialLetra,
    materialAmbiguo: implausible,
    claveMaterial: clave ?? null,
    claveAmbigua,
    resina: RESINA_DE_CLAVE[clave as string] ?? null,
    consecutivo,
    segmentosAdicionales: segmentos
  };
}
