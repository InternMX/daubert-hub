import type { FieldKey } from './family-registry';

// Modelo ÚNICO de incidencias de las Hojas de Manufactura. Cualquier problema técnico o dato pendiente (de los parsers de Title y Code, de la conciliación, de la coherencia técnica,
// del mapeo a la plantilla o de la validación de la familia) se expresa con esta estructura. El `id` es estable y describe la CAUSA (código + campo afectado), no el texto:
// dos orígenes que describen la misma causa comparten id y se cuentan una sola vez; dos causas distintas del mismo campo tienen ids distintos.
// Es la estructura de TechnicalNotice ampliada (id, nivel, mensaje + código, campos, sección, origen y efecto en la vista previa).

/** 1) INFORMACION: dato útil que no pide acción. 2) PENDIENTE: requiere confirmación o captura. 3) CONTRADICCION: dos fuentes o reglas no coinciden. 4) ERROR: impide completar la especificación. */
export type NivelIncidencia = 'INFORMACION' | 'PENDIENTE' | 'CONTRADICCION' | 'ERROR';

export type SeccionIncidencia = 'familia' | 'bind' | 'datos' | 'color' | 'capas' | 'composicion' | 'medidas' | 'vista-previa';

export type OrigenIncidencia = 'TITLE' | 'CODE' | 'CONCILIACION' | 'BIND' | 'SISTEMA' | 'FORMULARIO' | 'PLANTILLA';

export interface Incidencia {
  /** Identidad estable de la causa: `CODIGO` o `CODIGO:campo`. */
  id: string;
  codigo: string;
  nivel: NivelIncidencia;
  /** Campos del formulario afectados (vacío si es de sección). Con un solo campo la incidencia se muestra en el campo; con varios, en la sección. */
  campos: FieldKey[];
  seccion: SeccionIncidencia;
  /** Mensaje completo, que se muestra UNA vez donde el usuario puede corregir el problema. */
  mensaje: string;
  /** Texto breve para resúmenes y para la vista previa (sin repetir el mensaje completo). */
  resumen?: string;
  origen: OrigenIncidencia;
  /** ¿Afecta directamente la representación del documento? (dato técnico faltante que impide el dibujo, valor que no se imprime, texto que puede desbordarse). */
  afectaVistaPrevia: boolean;
  /** ¿El usuario puede reconocerla expresamente? Aplica a contradicciones y avisos de revisión; nunca a errores ni a datos faltantes. El reconocimiento caduca si cambian los datos que la originaron. */
  reconocible: boolean;
}

export const ORDEN_NIVEL: Record<NivelIncidencia, number> = { ERROR: 0, CONTRADICCION: 1, PENDIENTE: 2, INFORMACION: 3 };

export const idIncidencia = (codigo: string, campos: readonly string[] = []): string => (campos.length === 0 ? codigo : `${codigo}:${[...campos].sort().join('+')}`);

interface Datos { codigo: string; nivel: NivelIncidencia; campos?: FieldKey[]; seccion: SeccionIncidencia; mensaje: string; resumen?: string; origen: OrigenIncidencia; afectaVistaPrevia?: boolean; reconocible?: boolean; id?: string }

export function incidencia(d: Datos): Incidencia {
  const campos = d.campos ?? [];
  return { id: d.id ?? idIncidencia(d.codigo, campos), codigo: d.codigo, nivel: d.nivel, campos, seccion: d.seccion, mensaje: d.mensaje, ...(d.resumen ? { resumen: d.resumen } : {}), origen: d.origen, afectaVistaPrevia: d.afectaVistaPrevia ?? false, reconocible: d.reconocible ?? d.nivel === 'CONTRADICCION' };
}

/**
 * Une incidencias de la misma causa (mismo id): conserva la de mayor severidad, la primera redacción y la unión de los campos. No compara textos.
 * El orden de entrada decide la redacción: pasa primero la fuente autoritativa.
 */
export function consolidarIncidencias(lista: readonly Incidencia[]): Incidencia[] {
  const porId = new Map<string, Incidencia>();
  for (const actual of lista) {
    const previa = porId.get(actual.id);
    if (!previa) { porId.set(actual.id, actual); continue; }
    porId.set(actual.id, {
      ...previa,
      nivel: ORDEN_NIVEL[actual.nivel] < ORDEN_NIVEL[previa.nivel] ? actual.nivel : previa.nivel,
      campos: [...new Set([...previa.campos, ...actual.campos])],
      afectaVistaPrevia: previa.afectaVistaPrevia || actual.afectaVistaPrevia
    });
  }
  return [...porId.values()].sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
}
