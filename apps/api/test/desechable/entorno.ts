import { Pool } from 'pg';
import { afterAll } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import type { InfoFinalizada } from '../../src/manufacturing-sheets/preview/draft-layer';
import type { FamilyCode } from '../../src/manufacturing-sheets/preview/family-registry';
import type { PreviewFormData } from '../../src/manufacturing-sheets/preview/sheet-data.mapper';
import { nombreArchivoFinalizado } from '../../src/manufacturing-sheets/preview/sheet-pdf.service';
import type { BindReviewContext } from '../../src/manufacturing-sheets/preview/technical-coherence';
import { DocumentsRepository } from '../../src/manufacturing-documents/documents.repository';
import { DocumentsService } from '../../src/manufacturing-documents/documents.service';
import type { ActorDocumental } from '../../src/manufacturing-documents/documents.types';
import { SheetEngine, type EvaluacionHoja, type PdfFinalizado } from '../../src/manufacturing-documents/sheet-engine.port';

// Conexiones FIJAS a la instancia desechable (127.0.0.1:55434, contenedor temporal creado por global-setup). Nada se lee de DATABASE_* ni TEST_DATABASE_URL.
const PUERTO = 55434;
const base = { host: '127.0.0.1', port: PUERTO, database: 'daubert_hub_test' };

/** Rol de la aplicación (daubert_hub_test_user): sin DDL, sin DELETE, con RLS. */
export const poolApp = new Pool({ ...base, user: 'daubert_hub_test_user', password: 'scratch', max: 8 });
/** Administrador de la instancia desechable: SOLO para inspeccionar (auditoría, filas ocultas por RLS). */
export const poolAdmin = new Pool({ ...base, user: 'postgres', password: 'scratch', max: 2 });
afterAll(async () => { await poolApp.end(); await poolAdmin.end(); });

// Cuentas de la réplica (ver instancia-desechable.cjs): 1 ADMIN, 2 y 3 GENERAL, 4 GENERAL inactiva, 5 ADMIN.
const CUENTAS = {
  1: { email: 'admin1@example.invalid', displayName: 'Admin Uno', role: 'ADMIN' },
  2: { email: 'g2@example.invalid', displayName: 'General Dos', role: 'GENERAL' },
  3: { email: 'g3@example.invalid', displayName: 'General Tres', role: 'GENERAL' },
  4: { email: 'g4@example.invalid', displayName: 'Inactivo Cuatro', role: 'GENERAL' },
  5: { email: 'admin5@example.invalid', displayName: 'Admin Cinco', role: 'ADMIN' }
} as const;
let peticiones = 0;
export function actor(n: keyof typeof CUENTAS): ActorDocumental {
  peticiones += 1;
  const c = CUENTAS[n];
  return { userId: String(n), email: c.email, displayName: c.displayName, role: c.role, requestId: `desechable-${n}-${peticiones}` };
}

/** Motor de hojas simulado (sin Chrome): permite probar la lógica documental con evaluaciones y fallos controlados. La integración con el motor real se prueba aparte. */
export class MotorFalso extends SheetEngine {
  disponible = true;
  evaluacion: EvaluacionHoja = { completo: true, faltantes: [], bloqueado: null, incidencias: [] };
  fallarRender = false;
  retardoMs = 0;
  renders: Array<{ familia: FamilyCode; datos: PreviewFormData; contexto: BindReviewContext | undefined; info: InfoFinalizada; variante: string | null }> = [];
  async evaluar(): Promise<EvaluacionHoja> { return this.evaluacion; }
  async generarFinalizada(familia: FamilyCode, datos: PreviewFormData, contexto: BindReviewContext | undefined, info: InfoFinalizada, variante: string | null): Promise<PdfFinalizado> {
    this.renders.push({ familia, datos, contexto, info, variante });
    if (this.retardoMs) await new Promise((r) => setTimeout(r, this.retardoMs));
    if (this.fallarRender) throw new Error('fallo simulado del render');
    return { pdf: Buffer.from(`%PDF-1.4 simulado ${datos.codigo} REV${info.revision} ${info.huella}`), filename: nombreArchivoFinalizado(datos.codigo ?? '', variante, info.revision) };
  }
}

export function crearServicio(motor: SheetEngine = new MotorFalso()): { service: DocumentsService; repo: DocumentsRepository; motor: SheetEngine } {
  const repo = new DocumentsRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService);
  return { service: new DocumentsService(repo, motor), repo, motor };
}

let contador = 0;
/** Código único por prueba (la app no puede borrar filas: cada prueba usa su propio documento). */
export const codigoUnico = (prefijo = 'DOC'): string => { contador += 1; return `${prefijo}${Date.now().toString(36).toUpperCase()}${contador}`.slice(0, 40); };

export const DATOS_BASE = { codigo: 'X', descripcion: 'Bolsa plana de prueba', producto: 'Bolsa Plana', cliente: '', fechaEmision: '2026-10-29', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS', ancho: '13', largo: '17', unidadDimensiones: 'IN', calibre: '2.0' };

export function entradaBorrador(codigo: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { codigo, familia: 'BOLSA_PLANA_1', datos: { ...DATOS_BASE, codigo }, ...extra };
}

// Vista JSON de la API en las pruebas (acceso libre a sus campos).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Vista = Record<string, any>;

/** Ejecuta la operación y devuelve el error HTTP que lanza (estado, código y cuerpo); si tiene éxito, la prueba falla. */
export async function falla(promesa: Promise<unknown>): Promise<{ status: number; code?: string; body: Vista }> {
  try { await promesa; } catch (e) {
    const x = e as { getStatus?: () => number; getResponse?: () => Vista };
    return { status: x.getStatus?.() ?? 0, code: x.getResponse?.().code, body: x.getResponse?.() ?? {} };
  }
  throw new Error('Se esperaba un error y la operación tuvo éxito.');
}
