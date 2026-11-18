import { BadRequestException } from '@nestjs/common';
import type { Incidencia } from '../manufacturing-sheets/preview/incidencias';
import type { BindGuardado, EspecificacionDocumento, IncidenciaReconocida } from './documents.types';

const CLAVE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Nombres de clave con aspecto de credencial: la base los rechaza en cualquier nivel (fn_claves_validas); aquí se anticipa el error con un mensaje claro. */
const CLAVE_CREDENCIAL = /(authorization|bearer|api_?key|subscription|password|passwd|secret|token|credential|cookie)/i;
const MAX_PROCEDENCIA = 120;
const MAX_RECONOCIDAS = 60;

export interface EntradaEspecificacion {
  datos: Record<string, unknown>;
  bind?: BindGuardado;
  procedencia?: Record<string, unknown>;
  colorPersonalizado?: { nombre?: string; hex?: string };
  incidenciasReconocidas?: IncidenciaReconocida[];
}

function claveValida(clave: string): boolean {
  return CLAVE.test(clave) && !CLAVE_CREDENCIAL.test(clave);
}

/** Solo textos (los campos de la hoja son cadenas); los valores NO se inspeccionan: una descripción puede contener cualquier palabra. */
function soloTextos(origen: Record<string, unknown> | undefined, maxLongitud: number, maxEntradas: number, nombre: string): Record<string, string> {
  const salida: Record<string, string> = {};
  // `undefined` = campo opcional NO enviado. Con `transform: true` el ValidationPipe entrega una instancia del DTO cuyas propiedades opcionales ausentes existen con valor `undefined`
  // (p. ej. `modalidad` en Bolsa Plana 1); no son datos del usuario y no se guardan. Cualquier valor DEFINIDO que no sea texto (número, null, objeto…) sigue rechazándose.
  const entradas = Object.entries(origen ?? {}).filter(([, valor]) => valor !== undefined);
  if (entradas.length > maxEntradas) throw new BadRequestException(`«${nombre}» tiene demasiados campos.`);
  for (const [clave, valor] of entradas) {
    if (!claveValida(clave)) throw new BadRequestException(`«${nombre}» contiene un nombre de campo no permitido.`);
    if (typeof valor !== 'string') throw new BadRequestException(`«${nombre}.${clave}» debe ser texto.`);
    if (valor.length > maxLongitud) throw new BadRequestException(`«${nombre}.${clave}» es demasiado largo.`);
    salida[clave] = valor;
  }
  return salida;
}

/**
 * Construye la copia que se guarda: solo secciones conocidas, claves de identificador y valores de texto. `datos.codigo` SIEMPRE se iguala al código del documento (es la identidad del
 * documento; no puede divergir de ella). Devuelve un objeto nuevo (no conserva referencias del cuerpo recibido).
 */
export function construirEspecificacion(entrada: EntradaEspecificacion, codigoDocumento: string): EspecificacionDocumento {
  const datos = soloTextos(entrada.datos, 600, 80, 'datos');
  datos.codigo = codigoDocumento;
  const salida: EspecificacionDocumento = { datos };
  if (entrada.bind) {
    const b: BindGuardado = {};
    for (const [k, v] of Object.entries(entrada.bind)) {
      if (v === undefined) continue;
      if (!['Code', 'Title', 'Description', 'Weight', 'CreationDate'].includes(k)) throw new BadRequestException('«bind» contiene un campo no permitido.');
      (b as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(b).length > 0) salida.bind = b;
  }
  if (entrada.procedencia && Object.keys(entrada.procedencia).length > 0) salida.procedencia = soloTextos(entrada.procedencia, 40, MAX_PROCEDENCIA, 'procedencia');
  if (entrada.colorPersonalizado && (entrada.colorPersonalizado.nombre || entrada.colorPersonalizado.hex)) salida.colorPersonalizado = { ...entrada.colorPersonalizado };
  if (entrada.incidenciasReconocidas && entrada.incidenciasReconocidas.length > 0) {
    if (entrada.incidenciasReconocidas.length > MAX_RECONOCIDAS) throw new BadRequestException('Demasiados reconocimientos.');
    salida.incidenciasReconocidas = entrada.incidenciasReconocidas.map((r) => ({ id: r.id, huella: r.huella }));
  }
  return salida;
}

/**
 * Huella de los datos que originaron una incidencia: MISMA fórmula que el cliente (`huella` en apps/web/src/manufacturing/incidencias.ts): causa, redacción y valor actual de cada
 * campo afectado. El servidor la recalcula con la copia GUARDADA, de modo que un reconocimiento enviado por el cliente solo vale si coincide con los datos que realmente se guardan.
 */
export function huellaIncidencia(incidencia: Pick<Incidencia, 'id' | 'mensaje' | 'campos'>, datos: Record<string, string>): string {
  return JSON.stringify([incidencia.id, incidencia.mensaje, incidencia.campos.map((campo) => datos[campo] ?? '')]);
}

export function estaReconocida(incidencia: Incidencia, datos: Record<string, string>, reconocidas: readonly IncidenciaReconocida[] | undefined): boolean {
  if (!incidencia.reconocible) return false;
  const huella = huellaIncidencia(incidencia, datos);
  return (reconocidas ?? []).some((r) => r.id === incidencia.id && r.huella === huella);
}

/** Impiden confirmar la revisión o finalizar: errores y contradicciones no reconocidas con los datos guardados (igual que `bloquea` del cliente). */
export function incidenciasQueBloquean(incidencias: readonly Incidencia[], datos: Record<string, string>, reconocidas: readonly IncidenciaReconocida[] | undefined): Incidencia[] {
  return incidencias.filter((i) => i.nivel === 'ERROR' || (i.nivel === 'CONTRADICCION' && !estaReconocida(i, datos, reconocidas)));
}
