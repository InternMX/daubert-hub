import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ReprocessCaterpillarExecutionDto } from '../src/automations/remisiones-caterpillar/dto/reprocess-caterpillar-execution.dto';

async function validateInput(input: unknown) {
  const dto = plainToInstance(ReprocessCaterpillarExecutionDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('ReprocessCaterpillarExecutionDto', () => {
  it('accepts a nonblank reason and trims surrounding whitespace', async () => {
    const { dto, errors } = await validateInput({ reason: '  E2E controlado de reproceso  ' });
    expect(errors).toHaveLength(0);
    expect(dto.reason).toBe('E2E controlado de reproceso');
  });

  it('rejects a missing reason', async () => {
    const { errors } = await validateInput({});
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });

  it('rejects an empty reason', async () => {
    const { errors } = await validateInput({ reason: '' });
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });

  it('rejects a whitespace-only reason (empty after trim)', async () => {
    const { errors } = await validateInput({ reason: '     ' });
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });

  it('rejects a non-string reason', async () => {
    const { errors } = await validateInput({ reason: 12345 });
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });

  it('rejects a reason longer than the maximum length', async () => {
    const { errors } = await validateInput({ reason: 'x'.repeat(501) });
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });

  it('accepts a reason exactly at the maximum length', async () => {
    const { errors } = await validateInput({ reason: 'x'.repeat(500) });
    expect(errors).toHaveLength(0);
  });

  it('does not silently alter reason content beyond trimming', async () => {
    const { dto } = await validateInput({ reason: 'Motivo   con   espacios internos' });
    expect(dto.reason).toBe('Motivo   con   espacios internos');
  });
});
