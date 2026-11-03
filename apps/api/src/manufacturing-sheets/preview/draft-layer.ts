// Capa EXCLUSIVA del modo borrador (PDF): identifica el documento como borrador dentro del propio HTML compuesto, no como una superposición de la interfaz. Se integra en la composición
// de la vista previa (SheetPreviewService) y NO modifica ninguna plantilla aprobada, perfil ni geometría:
//   · `position: fixed` en los márgenes de la página Carta (franja superior y pie): queda fuera del flujo, no desplaza ni solapa medidas, dibujos ni tablas, y se repite si hubiera más de una página.
//   · Texto fijo (sin datos del usuario): no hay nada que escapar.
// Las firmas siguen siendo las de la plantilla («SIN FIRMA»): no se usan firmas escaneadas ni folios.

import { FUNCION_IMPRESA } from './signature-blocks';

export const MARCA_BORRADOR = 'BORRADOR · SIN APROBAR';
export const MARCA_INCOMPLETO = 'BORRADOR INCOMPLETO · FALTAN DATOS · SIN APROBAR';
export const PIE_BORRADOR = 'Documento de demostración: no es una hoja emitida · Firmas: SIN FIRMA';

const CAPA_CSS = `<style>
  .marca-borrador, .marca-borrador-pie { position: fixed; left: 0; right: 0; text-align: center; pointer-events: none; z-index: 2147483647; font-family: Calibri, Carlito, "Segoe UI", Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .marca-borrador { top: 11pt; font-size: 10.5pt; font-weight: 700; letter-spacing: 0.06em; color: #C00000; }
  .marca-borrador-pie { bottom: 9pt; font-size: 7.5pt; color: #595959; }
</style>`;

/** Inserta la capa de borrador antes de `</body>`. `completo` = datos técnicos completos para la familia (si no, el documento se identifica además como INCOMPLETO). */
export function aplicarCapaBorrador(html: string, completo: boolean): string {
  const capa = `${CAPA_CSS}\n<div class="marca-borrador" data-modo="${completo ? 'borrador' : 'incompleto'}">${completo ? MARCA_BORRADOR : MARCA_INCOMPLETO}</div>\n<div class="marca-borrador-pie">${PIE_BORRADOR}</div>\n`;
  if (!html.includes('</body>')) throw new Error('La plantilla compuesta no tiene </body>: no se puede identificar el borrador.');
  return html.replace('</body>', () => `${capa}</body>`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Capa de la versión FINALIZADA (TEST): «PRUEBA · NO VÁLIDO PARA PRODUCCIÓN». No dice «BORRADOR · SIN APROBAR» (ya no es un borrador) ni «APROBADA»/«EMITIDA»:
// una finalización de prueba no es una aprobación oficial. Mismo mecanismo que el borrador (position: fixed en los márgenes; no toca plantillas ni geometrías).
// ---------------------------------------------------------------------------------------------------------------------
export const MARCA_PRUEBA = 'PRUEBA · NO VÁLIDO PARA PRODUCCIÓN';

export interface InfoFinalizada {
  revision: number;
  /** yyyy-mm-dd de la finalización. */
  finalizadoEn: string;
  /** Nombres IMPRESOS (texto del usuario; se escapa). «Revisó» solo si existe una confirmación autenticada vigente. */
  elaboro: string;
  reviso?: string | null;
  autorizo?: string | null;
  /** Huella (SHA-256) de la copia de la especificación; se imprimen los primeros 12 caracteres. */
  huella: string;
  /** Responsables impresos (1 a 3) con su imagen de firma opcional. Sin este campo se conserva el comportamiento anterior (firmas «SIN FIRMA»). */
  responsables?: ResponsableImpreso[];
}

export interface ResponsableImpreso {
  posicion: number;
  funcion: 'GENERO' | 'REVISO' | 'APROBO';
  nombre: string;
  firma: { tipoMime: string; contenido: Buffer; sha256: string } | null;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
const nombreImpreso = (v: string): string => esc(v.replace(/\s+/g, ' ').trim().slice(0, 60));

const CAPA_FINAL_CSS = `<style>
  .marca-prueba, .marca-prueba-pie { position: fixed; left: 0; right: 0; text-align: center; pointer-events: none; z-index: 2147483647; font-family: Calibri, Carlito, "Segoe UI", Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .marca-prueba { top: 11pt; font-size: 10.5pt; font-weight: 700; letter-spacing: 0.06em; color: #C00000; }
  .marca-prueba-pie { bottom: 9pt; font-size: 7.5pt; color: #595959; line-height: 1.25; }
</style>`;

/** Inserta la capa de la versión finalizada de TEST antes de `</body>`. */
export function aplicarCapaFinalizada(html: string, info: InfoFinalizada): string {
  if (!Number.isInteger(info.revision) || info.revision < 1) throw new Error('Revisión no válida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(info.finalizadoEn)) throw new Error('Fecha de finalización no válida.');
  if (!/^[0-9a-f]{12,64}$/.test(info.huella)) throw new Error('Huella no válida.');
  const rev = String(info.revision).padStart(2, '0');
  const responsables = info.responsables && info.responsables.length > 0
    ? [...[...info.responsables].sort((x, y) => x.posicion - y.posicion).map((r) => `${FUNCION_IMPRESA[r.funcion]}: ${nombreImpreso(r.nombre)}`), ...(info.reviso ? [`Revisión registrada: ${nombreImpreso(info.reviso)}`] : []), ...(info.responsables.some((r) => r.firma) ? [] : ['Firmas: SIN FIRMA'])].join(' · ')
    : [`Elaboró: ${nombreImpreso(info.elaboro)}`, `Revisó: ${info.reviso ? nombreImpreso(info.reviso) : 'sin revisión registrada'}`, ...(info.autorizo ? [`Autorizó: ${nombreImpreso(info.autorizo)}`] : []), 'Firmas: SIN FIRMA'].join(' · ');
  const capa = `${CAPA_FINAL_CSS}\n<div class="marca-prueba" data-modo="finalizada-prueba">${MARCA_PRUEBA}</div>\n<div class="marca-prueba-pie">Revisión ${rev} · Finalizada en TEST el ${info.finalizadoEn} · Huella ${info.huella.slice(0, 12)} · No implica aprobación oficial<br>${responsables}</div>\n`;
  if (!html.includes('</body>')) throw new Error('La plantilla compuesta no tiene </body>: no se puede identificar la versión de prueba.');
  return html.replace('</body>', () => `${capa}</body>`);
}
