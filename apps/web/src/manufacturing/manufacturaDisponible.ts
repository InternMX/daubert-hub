import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/authContext.core';
import { MANUFACTURING_UI_VISIBLE } from '../automations/automationRoutes';
import { capacidadesDocumentales } from '../services/manufacturingDocuments';
import { fijarEntornoEmision, type EntornoEmision } from './entornoEmision';

type Estado = 'desconocido' | 'disponible' | 'no-disponible';
type Capacidades = { firmas: boolean; entorno?: EntornoEmision };

interface Sesion {
  usuarioId: string;
  estado: Estado;
  solicitud?: AbortController;
  pendiente?: Promise<void>;
}

let sesion: Sesion | undefined;
let disponibleParaPruebas = false;
const oyentes = new Set<() => void>();

function avisar() {
  oyentes.forEach((oyente) => oyente());
}

function limpiarSesion() {
  const anterior = sesion;
  sesion = undefined;
  anterior?.solicitud?.abort();
  fijarEntornoEmision(undefined);
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
    // Preserve the shared request across React's synchronous effect remounts.
    queueMicrotask(() => {
      if (oyentes.size === 0) limpiarSesion();
    });
  };
}

function capacidadesValidas(body: unknown): body is Capacidades {
  if (typeof body !== 'object' || body === null || !('firmas' in body) || typeof body.firmas !== 'boolean') return false;
  return !('entorno' in body) || body.entorno === 'PRUEBA' || body.entorno === 'PRODUCCION';
}

function consultar(usuarioId: string, revalidar: boolean): Promise<void> | undefined {
  if (!MANUFACTURING_UI_VISIBLE || disponibleParaPruebas) return;
  if (sesion?.usuarioId !== usuarioId) {
    limpiarSesion();
    sesion = { usuarioId, estado: 'desconocido' };
  }
  const actual = sesion;
  if (actual.pendiente) return actual.pendiente;
  if (!revalidar && actual.estado !== 'desconocido') return;

  const solicitud = new AbortController();
  actual.solicitud = solicitud;
  actual.estado = 'desconocido';
  actual.pendiente = Promise.resolve().then(async () => {
    let body: unknown;
    try {
      if (!solicitud.signal.aborted) body = await capacidadesDocumentales(solicitud.signal);
    } catch {
      // All transport and HTTP failures leave the module unavailable.
    }
    if (sesion !== actual) return;
    actual.solicitud = undefined;
    actual.pendiente = undefined;
    if (!solicitud.signal.aborted && capacidadesValidas(body)) {
      fijarEntornoEmision(body.entorno);
      actual.estado = 'disponible';
    } else {
      fijarEntornoEmision(undefined);
      actual.estado = 'no-disponible';
    }
    avisar();
  });
  avisar();
  return actual.pendiente;
}

export function revalidarManufactura(usuarioId: string): Promise<void> | undefined {
  return consultar(usuarioId, true);
}

export function useManufacturaVisible(): { visible: boolean; estado: Estado } {
  const { user } = useAuth();
  const usuarioId = MANUFACTURING_UI_VISIBLE ? user?.id : undefined;
  useEffect(() => {
    if (usuarioId !== undefined) void consultar(usuarioId, false);
    else if (sesion) {
      limpiarSesion();
      avisar();
    }
  }, [usuarioId]);

  const estado = useSyncExternalStore<Estado>(suscribir, () => {
    if (usuarioId === undefined) return 'desconocido';
    if (disponibleParaPruebas) return 'disponible';
    return sesion?.usuarioId === usuarioId ? sesion.estado : 'desconocido';
  }, () => 'desconocido');

  return { visible: MANUFACTURING_UI_VISIBLE && estado === 'disponible', estado };
}

export function marcarManufacturaDisponibleParaPruebas(disponible = true): void {
  if (import.meta.env.MODE !== 'test') return;
  limpiarSesion();
  disponibleParaPruebas = disponible;
  avisar();
}
