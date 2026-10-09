import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditApiError, dayStartIso, getAuditEvent, listAuditEvents, nextDayStartIso } from './audit';

afterEach(() => vi.unstubAllGlobals());

const event = {
  id: '10', occurredAt: '2026-10-05T15:00:00.000Z',
  actor: { id: '1', email: 'admin@daubertcromwell.com', displayName: 'Ana Admin' },
  origin: 'DAUBERT_HUB', category: { key: 'USERS', label: 'Usuarios' }, action: 'UPDATE',
  entity: { key: 'USER', label: 'Usuario' }, record: { reference: 'user_id=7', label: 'a@x.mx' }, requestId: 'req-1', changedFieldCount: 1
};
const meta = { page: 1, pageSize: 25, total: 1, totalPages: 1 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('listAuditEvents', () => {
  it('requests the page with only the filters that are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [event], meta }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAuditEvents({ page: 2, pageSize: 25, entity: 'USER', action: 'UPDATE', userId: '1', from: '2026-10-01T06:00:00.000Z' })).resolves.toEqual({ data: [event], meta });

    const url = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x');
    expect(url.pathname).toBe('/api/audit/events');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', pageSize: '25', entity: 'USER', action: 'UPDATE', userId: '1', from: '2026-10-01T06:00:00.000Z' });
  });

  it('exposes the HTTP status (403 for GENERAL) and rejects malformed bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'ROLE_NOT_ALLOWED' }, 403)));
    await expect(listAuditEvents({ page: 1, pageSize: 25 })).rejects.toMatchObject({ status: 403 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ ...event, action: 'TRUNCATE' }], meta })));
    await expect(listAuditEvents({ page: 1, pageSize: 25 })).rejects.toBeInstanceOf(AuditApiError);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(listAuditEvents({ page: 1, pageSize: 25 })).rejects.toMatchObject({ status: 0 });
  });
});

describe('getAuditEvent', () => {
  it('returns the detail with field/before/after changes', async () => {
    const detail = { ...event, changes: [{ field: 'role', label: 'Rol', before: 'GENERAL', after: 'ADMIN' }] };
    const fetchMock = vi.fn().mockResolvedValue(json({ data: detail }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAuditEvent('10')).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenCalledWith('/api/audit/events/10');
  });

  it('rejects a detail without a valid changes list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: event })));
    await expect(getAuditEvent('10')).rejects.toBeInstanceOf(AuditApiError);
  });
});

describe('day boundaries', () => {
  it('map a calendar day to [00:00, next 00:00) in Mexico City time (UTC-6)', () => {
    expect(dayStartIso('2026-10-05')).toBe('2026-10-05T06:00:00.000Z');
    expect(nextDayStartIso('2026-10-05')).toBe('2026-10-06T06:00:00.000Z');
    expect(nextDayStartIso('2026-10-31')).toBe('2026-11-01T06:00:00.000Z');
  });
});
