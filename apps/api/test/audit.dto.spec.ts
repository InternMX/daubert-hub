import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListAuditEventsDto } from '../src/audit/dto/list-audit-events.dto';

async function check(value: object) {
  const dto = plainToInstance(ListAuditEventsDto, value);
  return { dto, errors: (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length };
}

describe('ListAuditEventsDto', () => {
  it('defaults to page 1, 25 per page', async () => {
    expect(await check({})).toMatchObject({ dto: { page: 1, pageSize: 25 }, errors: 0 });
  });

  it('accepts valid filters', async () => {
    expect((await check({ page: '2', pageSize: '100', from: '2026-10-01T06:00:00.000Z', to: '2026-10-02T06:00:00.000Z', userId: '12', entity: 'COMPANY', action: 'DELETE' })).errors).toBe(0);
  });

  it.each([{ page: '0' }, { pageSize: '0' }, { pageSize: '101' }, { page: '1.5' }, { from: 'ayer' }, { to: '2026-13-40' }, { userId: '0' }, { userId: '1; DROP TABLE x' }, { userId: 'abc' }, { entity: 'NOPE' }, { action: 'INSERT' }, { unknown: '1' }])('rejects invalid input %j', async (input) => {
    expect((await check(input)).errors).toBeGreaterThan(0);
  });
});
