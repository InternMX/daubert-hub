import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import type { AuditSourceRow } from '../src/audit/audit-presenter';
import type { ListAuditEventsDto } from '../src/audit/dto/list-audit-events.dto';

function row(overrides: Partial<AuditSourceRow> = {}): AuditSourceRow {
  return {
    cambio_id: '10', fecha: '2026-10-05T15:00:00.000Z', esquema: 'security', tabla: 'users', registro_id: 'user_id=7', operacion: 'UPDATE',
    usuario_id: '1', usuario_email: 'admin@daubertcromwell.com', origen: 'DAUBERT_HUB', request_id: 'req-1',
    datos_anteriores: { email: 'a@x.mx', role: 'GENERAL', password_hash: 'HASH-OLD', token: 'tok-1' },
    datos_nuevos: { email: 'a@x.mx', role: 'ADMIN', password_hash: 'HASH-NEW', password_changed: true, api_key: 'key-1' },
    ...overrides
  };
}

function setup(rows: AuditSourceRow[] = [row()], total = rows.length) {
  const repository = {
    list: vi.fn().mockResolvedValue({ rows, total }),
    findById: vi.fn().mockResolvedValue(rows[0] ?? null),
    findActorDisplayNames: vi.fn().mockResolvedValue(new Map([['1', 'Ana Admin']]))
  };
  return { repository, service: new AuditService(repository as never) };
}

const input = (overrides: Partial<ListAuditEventsDto> = {}) => ({ page: 1, pageSize: 25, ...overrides }) as ListAuditEventsDto;

describe('AuditService.list', () => {
  it('normalizes rows into the stable event DTO with actor name, category, entity and request id', async () => {
    const { service } = setup();
    const result = await service.list(input());

    expect(result.data).toEqual([{
      id: '10',
      occurredAt: '2026-10-05T15:00:00.000Z',
      actor: { id: '1', email: 'admin@daubertcromwell.com', displayName: 'Ana Admin' },
      origin: 'DAUBERT_HUB',
      category: { key: 'USERS', label: 'Usuarios' },
      action: 'UPDATE',
      entity: { key: 'USER', label: 'Usuario' },
      record: { reference: 'user_id=7', label: 'a@x.mx' },
      requestId: 'req-1',
      changedFieldCount: 2
    }]);
  });

  it('never exposes raw JSONB or secrets in the list response', async () => {
    const { service } = setup();
    const text = JSON.stringify(await service.list(input()));
    for (const leaked of ['HASH-OLD', 'HASH-NEW', 'tok-1', 'key-1', 'password_hash', 'datos_anteriores', 'datos_nuevos']) expect(text).not.toContain(leaked);
  });

  it('computes pagination meta and passes page/pageSize through', async () => {
    const { service, repository } = setup([row()], 61);
    const result = await service.list(input({ page: 3, pageSize: 25 }));
    expect(result.meta).toEqual({ page: 3, pageSize: 25, total: 61, totalPages: 3 });
    expect(repository.list).toHaveBeenCalledWith({ from: undefined, to: undefined, userId: undefined, entity: undefined, action: undefined }, 3, 25);
  });

  it('forwards the date, user, entity and action filters to the repository', async () => {
    const { service, repository } = setup();
    await service.list(input({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z', userId: '1', entity: 'USER', action: 'UPDATE' }));
    expect(repository.list).toHaveBeenCalledWith({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z', userId: '1', entity: 'USER', action: 'UPDATE' }, 1, 25);
  });

  it('rejects an inverted or empty date range with 400 before touching the database', async () => {
    const { service, repository } = setup();
    await expect(service.list(input({ from: '2026-10-08T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(input({ from: '2026-10-08T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('skips rows from tables outside the catalog and returns a null actor for system events', async () => {
    const { service } = setup([row({ esquema: 'operacion', tabla: 'remisiones' }), row({ cambio_id: '11', usuario_id: null, usuario_email: null, origen: 'SISTEMA', request_id: null })]);
    const result = await service.list(input());
    expect(result.data.map((event) => event.id)).toEqual(['11']);
    expect(result.data[0]).toMatchObject({ actor: null, origin: 'SISTEMA', requestId: null });
  });

  it('does not look up actor names when no row has an actor', async () => {
    const { service, repository } = setup([row({ usuario_id: null, usuario_email: null })]);
    await service.list(input());
    expect(repository.findActorDisplayNames).toHaveBeenCalledWith([]);
  });
});

describe('AuditService.get', () => {
  it('returns field/before/after changes without raw JSONB or secrets', async () => {
    const { service } = setup();
    const event = await service.get('10');
    expect(event.changes).toEqual([
      { field: 'role', label: 'Rol', before: 'GENERAL', after: 'ADMIN' },
      { field: 'password_changed', label: 'Contraseña modificada', before: null, after: 'Sí' }
    ]);
    const text = JSON.stringify(event);
    for (const leaked of ['HASH-OLD', 'HASH-NEW', 'tok-1', 'key-1', 'password_hash']) expect(text).not.toContain(leaked);
  });

  it('404s for a missing event and for a table outside the catalog', async () => {
    await expect(setup([]).service.get('99')).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup([row({ esquema: 'security', tabla: 'sessions' })]).service.get('10')).rejects.toBeInstanceOf(NotFoundException);
  });
});
