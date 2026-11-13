// Capa EXCLUSIVA del modo borrador (PDF): identifica el documento como borrador dentro del propio HTML compuesto, no como una superposición de la interfaz. Se integra en la composición
// de la vista previa (SheetPreviewService) y NO modifica ninguna plantilla aprobada, perfil ni geometría:
//   · `position: fixed` en los márgenes de la página Carta (franja superior y pie): queda fuera del flujo, no desplaza ni solapa medidas, dibujos ni tablas, y se repite si hubiera más de una página.
//   · Texto fijo (sin datos del usuario): no hay nada que escapar.
// Las firmas siguen siendo las de la plantilla («SIN FIRMA»): no se usan firmas escaneadas ni folios.

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
// Versión FINALIZADA: el PDF respeta visualmente la plantilla original. NO se añade ninguna leyenda superior («PRUEBA · NO VÁLIDO PARA PRODUCCIÓN») ni pie de página
// (revisión, fecha, indicación TEST, huella, «No implica aprobación oficial», nombres). Toda esa trazabilidad vive en PostgreSQL y en el historial de Daubert Hub; la identificación
// de TEST está en la interfaz. Los responsables y las firmas se imprimen únicamente en los espacios que ya tiene la plantilla (ver signature-blocks.ts).
// ---------------------------------------------------------------------------------------------------------------------
export interface InfoFinalizada {
  revision: number;
  /** yyyy-mm-dd de la finalización. */
  finalizadoEn: string;
  /** Datos de trazabilidad del documento almacenado (ya NO se imprimen en el PDF). */
  elaboro: string;
  reviso?: string | null;
  autorizo?: string | null;
  /** Huella (SHA-256) de la copia de la especificación (se conserva en PostgreSQL; no se imprime). */
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

/**
 * Versión finalizada: valida los datos de trazabilidad recibidos y devuelve el HTML de la plantilla SIN ninguna capa añadida (ni encabezado, ni pie, ni marca): no hay elementos
 * fuera de la plantilla que puedan desplazar, solapar o paginar nada. La huella y la revisión siguen viajando al documento almacenado, no al PDF.
 */
export function aplicarCapaFinalizada(html: string, info: InfoFinalizada): string {
  if (!Number.isInteger(info.revision) || info.revision < 1) throw new Error('Revisión no válida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(info.finalizadoEn)) throw new Error('Fecha de finalización no válida.');
  if (!/^[0-9a-f]{12,64}$/.test(info.huella)) throw new Error('Huella no válida.');
  if (!html.includes('</body>')) throw new Error('La plantilla compuesta no tiene </body>.');
  return html;
}
