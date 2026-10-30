import type { FieldKey } from '../services/manufacturingFamilies';
import { anclaDe, SECCION_ETIQUETA, type Incidencia, type Reconocimientos } from './incidencias';

// Navegación a una incidencia (compartida por el resumen de validación y la sección «Finalizar hoja»): lógica sin componentes.

/** Contexto de las incidencias que consume su presentación y la navegación. */
export interface IncidenciasContexto {
  lista: Incidencia[];
  visible: (key: FieldKey) => boolean;
  valores: (key: FieldKey) => string;
  reconocidas: Reconocimientos;
  reconocer: (i: Incidencia) => void;
  deshacer: (i: Incidencia) => void;
  /** Tras pulsar «Validar especificación» también se muestran los datos faltantes en su campo. */
  validado: boolean;
  /** Ids de las incidencias a las que el usuario navegó con «Ir»: su aviso concreto se muestra aunque aún no haya validado. */
  reveladas: ReadonlySet<string>;
  revelar: (id: string) => void;
  /** Estado de la revisión del backend: mientras no hay respuesta vigente no se afirma que no hay incidencias. */
  revision: 'vigente' | 'revisando' | 'no-disponible';
  /** Gestor documental: ids de los datos obligatorios pendientes para finalizar; su campo muestra una indicación discreta aunque aún no se haya intentado finalizar. */
  pendientes?: ReadonlySet<string>;
}

/** Resalta un momento el control al que se navega (se restaura el estilo previo). */
function destacar(destino: HTMLElement | null | undefined): void {
  if (!destino) return;
  const { outline, outlineOffset, borderRadius } = destino.style;
  destino.style.outline = '2px solid #ed6c02';
  destino.style.outlineOffset = '4px';
  destino.style.borderRadius = '4px';
  setTimeout(() => { destino.style.outline = outline; destino.style.outlineOffset = outlineOffset; destino.style.borderRadius = borderRadius; }, 2500);
}

export const idMensaje = (id: string): string => `incidencia-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** Lleva al usuario al problema: muestra su aviso concreto, desplaza la pantalla, enfoca el control y lo asocia con el mensaje (aria-describedby). */
export function localizar(i: Incidencia, ctx: IncidenciasContexto): void {
  ctx.revelar(i.id);
  const ancla = anclaDe(i, ctx.visible);
  const mover = (): void => {
    const destino = ancla.tipo === 'campo'
      ? document.querySelector<HTMLElement>(`[data-field="${ancla.campo}"]`)
      : document.querySelector<HTMLElement>(`section[aria-label="${SECCION_ETIQUETA[ancla.seccion]}"]`);
    destino?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const control = destino?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, [role=combobox], [role=radio]');
    const mensaje = document.getElementById(idMensaje(i.id));
    if (control && mensaje) {
      const previos = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      if (!previos.includes(mensaje.id)) control.setAttribute('aria-describedby', [...previos, mensaje.id].join(' '));
    }
    control?.focus({ preventScroll: true });
    destacar(destino);
  };
  // El aviso se monta tras el siguiente renderizado: se espera a que exista antes de asociarlo y enfocar.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(mover)); else setTimeout(mover, 0);
}

