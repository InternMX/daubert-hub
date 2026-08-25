import { describe, expect, it, vi } from 'vitest';
import { RecentActivityRepository } from '../src/recent-activity/recent-activity.repository';

describe('RecentActivityRepository', () => {
  it('queries only Hub audit rows and bounds recent request groups with stable ordering', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RecentActivityRepository({ query } as never);

    await expect(repository.findRecent(6)).resolves.toEqual({ rows: [], contacts: new Map(), companies: new Map() });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM audit.cambios change"), [30]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("change.origen = 'DAUBERT_HUB'");
    expect(sql).toContain('change.fecha AS occurred_at');
    expect(sql).toContain('change.request_id IS NOT NULL');
    expect(sql).toContain('GROUP BY request_id');
    expect(sql).toContain('ORDER BY request_occurred_at DESC, request_id DESC');
    expect(sql).toContain('LIMIT $1');
  });

  it('batch resolves current contact and company labels without active-status filters', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ request_id: 'r1', schema_name: 'core', table_name: 'medios_contacto', operation: 'INSERT', before_data: null, after_data: { contacto_id: 7, valor: 'a@test.mx' }, occurred_at: '2026-08-25T10:00:00Z' }])
      .mockResolvedValueOnce([{ id: '7', company_id: '8', contact_type: 'PERSONA', name: 'Ana', area: 'Compras' }])
      .mockResolvedValueOnce([{ id: '8', name: 'Acme' }]);
    const repository = new RecentActivityRepository({ query } as never);

    const result = await repository.findRecent(1);

    expect(result.contacts.get('7')?.name).toBe('Ana');
    expect(result.companies.get('8')).toBe('Acme');
    expect(query.mock.calls[1]?.[0]).not.toContain('estatus');
    expect(query.mock.calls[2]?.[0]).not.toContain('estatus');
  });
});
