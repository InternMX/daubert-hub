import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AdjustDocumentSeriesDto } from '../src/automations/dto/adjust-document-series.dto';

describe('AdjustDocumentSeriesDto', () => {
  it('accepts a positive integer and trims the reason', async () => {
    const input = plainToInstance(AdjustDocumentSeriesDto, { nextFolio: 993, reason: '  Remisión incorrecta.  ' });
    expect(await validate(input)).toHaveLength(0);
    expect(input.reason).toBe('Remisión incorrecta.');
  });

  it.each([
    { nextFolio: 0, reason: 'Motivo' },
    { nextFolio: -1, reason: 'Motivo' },
    { nextFolio: 1.5, reason: 'Motivo' },
    { nextFolio: 1, reason: '' },
    { nextFolio: 1, reason: '   ' }
  ])('rejects invalid adjustment %#', async (value) => {
    expect(await validate(plainToInstance(AdjustDocumentSeriesDto, value))).not.toHaveLength(0);
  });
});
