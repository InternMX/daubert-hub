import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AdjustDocumentSeriesDto } from '../src/automations/dto/adjust-document-series.dto';

describe('AdjustDocumentSeriesDto', () => {
  it('accepts a positive integer nextFolio/expectedCurrentFolio and trims the reason', async () => {
    const input = plainToInstance(AdjustDocumentSeriesDto, { expectedCurrentFolio: 994, nextFolio: 993, reason: '  Remisión incorrecta.  ' });
    expect(await validate(input)).toHaveLength(0);
    expect(input.reason).toBe('Remisión incorrecta.');
  });

  it('accepts an explicit backwardFilesystemAcknowledged boolean', async () => {
    const input = plainToInstance(AdjustDocumentSeriesDto, { expectedCurrentFolio: 130, nextFolio: 124, reason: 'Corrección', backwardFilesystemAcknowledged: true });
    expect(await validate(input)).toHaveLength(0);
    expect(input.backwardFilesystemAcknowledged).toBe(true);
  });

  it('accepts a request with backwardFilesystemAcknowledged omitted (forward adjustments never need it)', async () => {
    const input = plainToInstance(AdjustDocumentSeriesDto, { expectedCurrentFolio: 124, nextFolio: 130, reason: 'Corrección' });
    expect(await validate(input)).toHaveLength(0);
    expect(input.backwardFilesystemAcknowledged).toBeUndefined();
  });

  it.each([
    { expectedCurrentFolio: 994, nextFolio: 0, reason: 'Motivo' },
    { expectedCurrentFolio: 994, nextFolio: -1, reason: 'Motivo' },
    { expectedCurrentFolio: 994, nextFolio: 1.5, reason: 'Motivo' },
    { expectedCurrentFolio: 994, nextFolio: 1, reason: '' },
    { expectedCurrentFolio: 994, nextFolio: 1, reason: '   ' },
    { nextFolio: 993, reason: 'Motivo' }, // missing expectedCurrentFolio
    { expectedCurrentFolio: 0, nextFolio: 993, reason: 'Motivo' },
    { expectedCurrentFolio: -1, nextFolio: 993, reason: 'Motivo' },
    { expectedCurrentFolio: 994, nextFolio: 993, reason: 'Motivo', backwardFilesystemAcknowledged: 'yes' }
  ])('rejects invalid adjustment %#', async (value) => {
    expect(await validate(plainToInstance(AdjustDocumentSeriesDto, value))).not.toHaveLength(0);
  });
});
