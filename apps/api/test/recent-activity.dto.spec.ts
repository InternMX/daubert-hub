import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListRecentActivityDto } from '../src/recent-activity/dto/list-recent-activity.dto';

async function query(value: object): Promise<{ dto: ListRecentActivityDto; errors: number }> {
  const dto = plainToInstance(ListRecentActivityDto, value);
  return { dto, errors: (await validate(dto)).length };
}

describe('ListRecentActivityDto', () => {
  it('defaults to six and converts a valid integer query value', async () => {
    expect(await query({})).toMatchObject({ dto: { limit: 6 }, errors: 0 });
    expect(await query({ limit: '20' })).toMatchObject({ dto: { limit: 20 }, errors: 0 });
  });

  it.each([{ limit: '0' }, { limit: '21' }, { limit: '1.5' }, { limit: 'invalid' }])('rejects invalid limit %#', async (input) => {
    expect((await query(input)).errors).toBeGreaterThan(0);
  });

  it.each(['PROVIDER', 'CONTACT', 'AUTOMATION', 'CLIENT'])('accepts category %s', async (category) => {
    expect(await query({ category })).toMatchObject({ dto: { limit: 6, category }, errors: 0 });
  });

  it.each(['', 'provider', 'UNKNOWN'])('rejects invalid category %j', async (category) => {
    expect((await query({ category })).errors).toBeGreaterThan(0);
  });
});
