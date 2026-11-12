import type { ResponsableImpreso } from './draft-layer';

// Bloque de firmas de los PDF FINALIZADOS con responsables (1 a 3). NO modifica las plantillas aprobadas: reutiliza los dos recuadros que ya existen en todas (`firma_elaboro` y
// `firma_aprobo`, con la geometría propia de cada familia) y, solo cuando hay tres responsables, añade un tercer recuadro y reparte el ancho de la zona de firmas en tres partes iguales.
// Los borradores y las vistas previas conservan el marcador «SIN FIRMA» de la plantilla (ayuda visual de trabajo). En un PDF FINALIZADO un responsable sin imagen deja su espacio vacío, con la
// línea de firma, el nombre y la función debajo: la ausencia de imagen no significa que alguien haya firmado, y una firma manuscrita posterior solo existe en el ejemplar impreso.
// Los responsables son OPCIONALES (Generó incluido): uno sin nombre ni imagen no imprime nada y su recuadro queda en blanco, conservando la posición de los demás; sin ninguno, la sección queda vacía.

const FUNCION: Record<ResponsableImpreso['funcion'], string> = { GENERO: 'Generó', REVISO: 'Revisó', APROBO: 'Aprobó' };
const MIME_PERMITIDOS = new Set(['image/png', 'image/jpeg']);
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const escapar = (t: string): string => t.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

export const FUNCION_IMPRESA = FUNCION;

function bloque(r: ResponsableImpreso): string {
  const nombre = r.nombre.replace(/\s+/g, ' ').trim();
  const conImagen = Boolean(r.firma && MIME_PERMITIDOS.has(r.firma.tipoMime));
  // Responsable no capturado (sin nombre ni firma): no se imprime nada (ni línea ni función); su recuadro queda en blanco y conserva su posición.
  if (!nombre && !conImagen) return '';
  const imagen = r.firma && MIME_PERMITIDOS.has(r.firma.tipoMime)
    ? `<img alt="" src="data:${r.firma.tipoMime};base64,${r.firma.contenido.toString('base64')}">`
    : '';                                    // sin imagen el espacio queda VACÍO (para firmar a mano en el ejemplar impreso): no se imprime ningún texto sustituto
  return `<div class="resp" data-posicion="${r.posicion}"><div class="resp-img">${imagen}</div><div class="resp-linea"></div><div class="resp-nombre">${escapar(r.nombre.replace(/\s+/g, ' ').trim().slice(0, 120))}</div><div class="resp-funcion">${FUNCION[r.funcion]}</div></div>`;
}

const CSS_BASE = `<style>
  .firma-bloque .resp { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; text-align: center; overflow: hidden; }
  .firma-bloque .resp-img { flex: 1 1 auto; min-height: 0; display: flex; align-items: flex-end; justify-content: center; }
  .firma-bloque .resp-img img { width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
  .firma-bloque .resp-linea { flex: 0 0 auto; border-top: 0.6pt solid #000; margin: 1pt 3pt 1.5pt; }
  .firma-bloque .resp-nombre { flex: 0 0 auto; font-size: 7.5pt; line-height: 1.05; font-weight: bold; max-height: 17.6pt; overflow: hidden; word-break: break-word; }
  .firma-bloque .resp-funcion { flex: 0 0 auto; font-size: 7.5pt; line-height: 1.1; color: #333; }
</style>`;
// Tres responsables: la zona de firmas se reparte en tres columnas iguales (porcentajes: cada familia conserva su propio ancho y alto de zona).
const CSS_TRES = `<style>
  .firmas-zona .firma-bloque { top: 0 !important; height: 100% !important; width: 32.4% !important; }
  .firmas-zona .firma-elaboro { left: 0.6% !important; }
  .firmas-zona .firma-aprobo { left: 33.8% !important; }
  .firmas-zona .firma-extra { left: 67% !important; }
</style>`;

export interface BloquesFirma { primero: string; segundo: string; tercero: string | null }

export function bloquesDeFirma(responsables: readonly ResponsableImpreso[]): BloquesFirma {
  const ordenados = [...responsables].sort((a, b) => a.posicion - b.posicion).slice(0, 3);
  return { primero: ordenados[0] ? bloque(ordenados[0]) : '', segundo: ordenados[1] ? bloque(ordenados[1]) : '', tercero: ordenados[2] ? bloque(ordenados[2]) : null };
}

/** Añade los estilos de los recuadros y, con tres responsables, el tercer recuadro dentro de la zona de firmas existente. */
export function integrarBloquesFirma(html: string, bloques: BloquesFirma): string {
  let salida = html;
  if (bloques.tercero !== null) {
    const apertura = '<div class="firmas-zona" id="seccion-firmas" data-seccion="firmas">';
    if (!salida.includes(apertura)) throw new Error('La plantilla compuesta no tiene la zona de firmas esperada.');
    // El recuadro adicional se coloca por posición absoluta (como los otros dos): su lugar en el árbol no afecta la maquetación.
    salida = salida.replace(apertura, () => `${apertura}
      <div class="firma-bloque firma-extra" id="firma_extra">${bloques.tercero}</div>`);
  }
  if (!salida.includes('</body>')) throw new Error('La plantilla compuesta no tiene </body>.');
  return salida.replace('</body>', () => `${CSS_BASE}${bloques.tercero !== null ? CSS_TRES : ''}</body>`);
}
