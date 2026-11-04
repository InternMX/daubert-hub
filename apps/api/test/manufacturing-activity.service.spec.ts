import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RecentActivityService } from '../src/recent-activity/recent-activity.service';

const ID = '11111111-2222-4333-8444-555555555555';
const base = { variante: null, revision: null, revision_base: null, revision_public_id: ID, occurred_at: '2026-11-05T12:00:00Z', actor_id: '2', actor_nombre: 'General Dos', actor_email: 'g2@example.invalid' };
const ACTOR_VISTA = { id: '2', displayName: 'General Dos', email: 'g2@example.invalid' };
const LINK = `/automations/manufacturing-sheets?revision=${ID}`;

function servicio(manufactura: unknown[], conManufactura = true) {
  const encontrar = vi.fn().mockResolvedValue(manufactura);
  const vacio = { findRecent: vi.fn().mockResolvedValue([]) };
  const origen = { findRecent: vi.fn().mockResolvedValue({ rows: [], contacts: new Map(), companies: new Map(), companyRoles: new Map(), actorDisplayNames: new Map() }) };
  const s = new RecentActivityService(origen as never, vacio as never, vacio as never, vacio as never, { findRecent: vi.fn().mockResolvedValue([]), findActorDisplayNames: vi.fn() } as never, conManufactura ? ({ findRecent: encontrar } as never) : undefined);
  return { s, encontrar };
}
const ACTOR = { userId: '2', role: 'GENERAL' };

describe('Actividad reciente · Hojas de manufactura', () => {
  it('cada evento describe lo que ocurrió en su fecha: creación del documento inicial, nueva revisión (basada en…) y finalización (REV0n); categoría AUTOMATION y enlace', async () => {
    const { s } = servicio([
      { ...base, tipo: 'REVISION_FINALIZADA', codigo: 'SCHFPMG001', revision: 2, occurred_at: '2026-11-05T15:00:00Z' },
      { ...base, tipo: 'REVISION_CREADA', codigo: 'SCHFPMG001', revision_base: 1, occurred_at: '2026-11-05T14:00:00Z' },
      { ...base, tipo: 'REVISION_FINALIZADA', codigo: 'SCHFPMG001', revision: 1, occurred_at: '2026-11-05T13:00:00Z' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'SCHFPMG001', occurred_at: '2026-11-05T12:00:00Z' }
    ]);
    const { data } = await s.list({ limit: 6 }, ACTOR);
    expect(data.map((d) => [d.type, d.title, d.context])).toEqual([
      ['MANUFACTURING_REVISION_FINALIZED', 'Hoja de manufactura finalizada', 'REV02 · Finalizada'],
      ['MANUFACTURING_REVISION_CREATED', 'Nueva revisión de hoja de manufactura creada', 'Basada en REV01'],
      ['MANUFACTURING_REVISION_FINALIZED', 'Hoja de manufactura finalizada', 'REV01 · Finalizada'],
      ['MANUFACTURING_DOCUMENT_CREATED', 'Hoja de manufactura creada', 'Borrador inicial']
    ]);
    for (const item of data) expect(item).toMatchObject({ category: 'AUTOMATION', entity: 'SCHFPMG001', actor: ACTOR_VISTA, link: LINK });
    expect(data[3]!.occurredAt).toBe('2026-11-05T12:00:00.000Z');
  });

  it('el evento de creación NO refleja el estado actual: una hoja hoy finalizada se sigue mostrando como «Borrador inicial» (sin número de revisión ni estado)', async () => {
    const { s } = servicio([{ ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'IMPFPMG012', variante: 'coex', revision: 3, revision_base: 2 }]);
    const [item] = (await s.list({ limit: 6 }, ACTOR)).data;
    expect(item).toMatchObject({ type: 'MANUFACTURING_DOCUMENT_CREATED', entity: 'IMPFPMG012-COEX', context: 'Borrador inicial' });
    expect(item!.context).not.toMatch(/REV|Finalizada/);
  });

  it('no se inventa nada que la base no demuestre: finalización sin número de revisión, nueva revisión sin base, tipo desconocido, código vacío, fecha o enlace inválidos se descartan', async () => {
    const { s } = servicio([
      { ...base, tipo: 'REVISION_FINALIZADA', codigo: 'A', revision: null },
      { ...base, tipo: 'REVISION_CREADA', codigo: 'B', revision_base: null },
      { ...base, tipo: 'OTRO', codigo: 'C' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: '  ' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'D', occurred_at: 'no-fecha' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'E', revision_public_id: '../../admin' },
      { ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'OK', actor_id: null, actor_nombre: null, actor_email: null }
    ]);
    const { data } = await s.list({ limit: 6 }, ACTOR);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ entity: 'OK', actor: null });
  });

  it('se mezcla en la misma lista (ordenada por fecha) y solo cuando se pide Todos o Automatizaciones; con otra categoría ni se consulta', async () => {
    const { s, encontrar } = servicio([{ ...base, tipo: 'DOCUMENTO_CREADO', codigo: 'X1' }]);
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
});
