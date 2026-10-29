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
