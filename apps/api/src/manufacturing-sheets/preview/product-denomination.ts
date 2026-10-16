import { normalizarTitulo } from '../bind-product-interpreter/title-parser';

// Solo denominaciones técnicas explícitas; no se copia el título comercial completo a Producto.
export function denominacionEspecifica(texto: string): string | null {
  return /\b(?:ROLLO\s+VCI\s*\+\s*UV\s+TERMOENCOGIBLE|ROLLO\s+CONTINUO|ROLLO\s+VCI|BOLSA\s+(?:PLANA|CON\s+FUELLES?))\b/i.exec(texto)?.[0] ?? null;
}

export function claseDenominacion(texto: string): string | null {
  const t = normalizarTitulo(texto);
  if (/\bTERMOENCOG\w*\b/.test(t)) return 'TERMO';
  if (/\bROLLO\s+(?:VCI|CONTINUO)\b/.test(t)) return 'ROLLO';
  if (/\bBOLSA\s+CON\s+FUELLES?\b/.test(t)) return 'FUELLE';
  if (/\bBOLSA\s+PLANA\b/.test(t)) return 'PLANA';
  return null;
}
