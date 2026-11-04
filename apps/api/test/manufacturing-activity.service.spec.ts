import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RecentActivityService } from '../src/recent-activity/recent-activity.service';

const ID = '11111111-2222-4333-8444-555555555555';
const base = { variante: null, revision: null, estado: 'BORRADOR', revision_public_id: ID, occurred_at: '2026-11-05T12:00:00Z', actor_id: '2', actor_nombre: 'General Dos', actor_email: 'g2@example.invalid' };

function servicio(manufactura: unknown[], conManufactura = true) {
  const encontrar = vi.fn().mockResolvedValue(manufactura);
  const vacio = { findRecent: vi.fn().mockResolvedValue([]) };
  const origen = { findRecent: vi.fn().mockResolvedValue({ rows: [], contacts: new Map(), companies: new Map(), companyRoles: new Map(), actorDisplayNames: new Map() }) };
  const s = new RecentActivityService(origen as never, vacio as never, vacio as never, vacio as never, { findRecent: vi.fn().mockResolvedValue([]), findActorDisplayNames: vi.fn() } as never, conManufactura ? ({ findRecent: encontrar } as never) : undefined);
  return { s, encontrar };
}
const ACTOR = { userId: '2', role: 'GENERAL' };

describe('Actividad reciente · Hojas de manufactura', () => {
  it('mapea creación y finalización: código, revisión, estado, responsable, fecha y enlace a la hoja; categoría AUTOMATION', async () => {
    const { s } = servicio([
      { ...base, tipo: 'REVISION_FINALIZADA', codigo: 'SCHFPMG001', revision: 1, estado: 'FINALIZADA', occurred_at: '2026-11-05T13:00:00Z' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'IMPFPMG012', variante: 'coex' }
    ]);
    const { data } = await s.list({ limit: 6 }, ACTOR);
    expect(data).toEqual([
      { type: 'MANUFACTURING_REVISION_FINALIZED', category: 'AUTOMATION', title: 'Hoja de manufactura finalizada', entity: 'SCHFPMG001', context: 'REV01 · Finalizada', occurredAt: '2026-11-05T13:00:00.000Z',
        actor: { id: '2', displayName: 'General Dos', email: 'g2@example.invalid' }, link: `/automations/manufacturing-sheets?revision=${ID}` },
      { type: 'MANUFACTURING_DOCUMENT_CREATED', category: 'AUTOMATION', title: 'Hoja de manufactura creada', entity: 'IMPFPMG012-COEX', context: 'Borrador', occurredAt: '2026-11-05T12:00:00.000Z',
        actor: { id: '2', displayName: 'General Dos', email: 'g2@example.invalid' }, link: `/automations/manufacturing-sheets?revision=${ID}` }
    ]);
  });

  it('se mezcla en la misma lista (ordenada por fecha) y solo cuando se pide Todos o Automatizaciones; con otra categoría ni se consulta', async () => {
    const fila = { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'X1' };
    const { s, encontrar } = servicio([fila]);
    expect((await s.list({ limit: 6 }, ACTOR)).data).toHaveLength(1);
    expect(encontrar).toHaveBeenCalledWith(6, ACTOR);
    encontrar.mockClear();
    expect((await s.list({ limit: 6, category: 'CLIENT' as never }, ACTOR)).data).toHaveLength(0);
    expect(encontrar).not.toHaveBeenCalled();
    expect((await s.list({ limit: 6, category: 'AUTOMATION' as never }, ACTOR)).data).toHaveLength(1);
  });

  it('sin identidad de sesión o sin el repositorio, no aporta nada y las demás fuentes siguen funcionando', async () => {
    const { s, encontrar } = servicio([{ ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'X1' }]);
    expect((await s.list({ limit: 6 }, null)).data).toEqual([]);
    expect((await s.list({ limit: 6 })).data).toEqual([]);
    expect(encontrar).not.toHaveBeenCalled();
    expect((await servicio([], false).s.list({ limit: 6 }, ACTOR)).data).toEqual([]);
  });

  it('descarta filas inválidas (sin código, fecha inválida o enlace que no es un UUID): nunca se inventa un evento ni un destino', async () => {
    const { s } = servicio([
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: '  ' }, { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'A', occurred_at: 'no-fecha' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'B', revision_public_id: '../../admin' }, { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'OK', actor_id: null, actor_nombre: null, actor_email: null }
    ]);
    const { data } = await s.list({ limit: 6 }, ACTOR);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ entity: 'OK', actor: null });
  });
});
