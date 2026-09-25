import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { CompaniesController } from '../src/companies/companies.controller';
import { SuggestDropboxPathDto } from '../src/companies/dto/suggest-dropbox-path.dto';
import { COMPANY_TYPE_DROPBOX_FOLDERS, DROPBOX_PATH_MAX_LENGTH, normalizeDropboxPath, suggestDropboxPath } from '../src/payment-notification-settings/dropbox-path';

describe('suggestDropboxPath — canonical type mapping', () => {
  it.each([
    ['PROVEEDOR', 'PROVEEDORES/ACME'],
    ['SERVICIO', 'PROVEEDOR DE SERVICIOS/ACME'],
    ['FLETE', 'FLETES/ACME'],
    ['CLIENTE', 'CLIENTES/ACME']
  ])('%s -> %s', (type, expected) => {
    expect(suggestDropboxPath(type, 'ACME')).toBe(expected);
  });

  it('matches the documented example', () => {
    expect(suggestDropboxPath('FLETE', 'TRANSPORTES KARINA')).toBe('FLETES/TRANSPORTES KARINA');
  });

  it('exposes exactly the four canonical folders and never a Dropbox root or drive prefix', () => {
    expect(COMPANY_TYPE_DROPBOX_FOLDERS).toEqual({ PROVEEDOR: 'PROVEEDORES', SERVICIO: 'PROVEEDOR DE SERVICIOS', FLETE: 'FLETES', CLIENTE: 'CLIENTES' });
    for (const type of Object.keys(COMPANY_TYPE_DROPBOX_FOLDERS)) {
      const suggestion = suggestDropboxPath(type, 'X')!;
      expect(suggestion).not.toMatch(/^Dropbox\/|^[A-Za-z]:|^[\\/]|\\/i);
    }
  });

  it.each([['OTRO'], ['flete'], [''], ['__proto__'], ['constructor'], [null], [undefined]])('returns null for the unsupported type %j', (type) => {
    expect(suggestDropboxPath(type as never, 'ACME')).toBeNull();
  });
});

describe('suggestDropboxPath — name normalization', () => {
  it('trims and collapses consecutive whitespace', () => {
    expect(suggestDropboxPath('FLETE', '   TRANSPORTES    KARINA \t ')).toBe('FLETES/TRANSPORTES KARINA');
  });

  it('keeps accents, Ñ, digits and inner punctuation', () => {
    expect(suggestDropboxPath('PROVEEDOR', 'MUÑOZ Y PÉREZ Ñandú S.A. 2025 & CÍA (norte)')).toBe('PROVEEDORES/MUÑOZ Y PÉREZ Ñandú S.A. 2025 & CÍA (norte)');
  });

  it.each([
    ['A<B>C', 'A B C'],
    ['A:B', 'A B'],
    ['A"B', 'A B'],
    ['A|B', 'A B'],
    ['A?B*C', 'A B C'],
    ['A{ANIO}B', 'A ANIO B']
  ])('replaces the invalid character in %j safely', (name, expected) => {
    expect(suggestDropboxPath('PROVEEDOR', name)).toBe(`PROVEEDORES/${expected}`);
  });

  it('turns "/" and "\\" inside the name into spaces, never into extra path segments', () => {
    expect(suggestDropboxPath('FLETE', 'A/B')).toBe('FLETES/A B');
    expect(suggestDropboxPath('FLETE', 'A\\B')).toBe('FLETES/A B');
    expect(suggestDropboxPath('FLETE', 'A / B \\ C')).toBe('FLETES/A B C');
    expect(suggestDropboxPath('FLETE', 'A/B')!.split('/')).toHaveLength(2);
  });

  it('strips trailing dots and spaces (Windows would drop them silently)', () => {
    expect(suggestDropboxPath('FLETE', 'ACME S.A. ')).toBe('FLETES/ACME S.A');
    expect(suggestDropboxPath('FLETE', 'ACME...')).toBe('FLETES/ACME');
    expect(suggestDropboxPath('FLETE', 'ACME . . ')).toBe('FLETES/ACME');
  });

  it('never produces "." or ".." as the name segment', () => {
    for (const name of ['.', '..', '...', ' . ', '. .']) expect(suggestDropboxPath('FLETE', name)).toBeNull();
    expect(suggestDropboxPath('FLETE', '../ACME')).toBe('FLETES/.. ACME');
    expect(normalizeDropboxPath(suggestDropboxPath('FLETE', '../ACME'))).toBe('FLETES/.. ACME');
  });

  it('returns null for blank names and names made only of unsafe characters', () => {
    for (const name of ['', '   ', '\t\n', '///', '\\\\', '<>:"|?*', '{}', null, undefined]) expect(suggestDropboxPath('FLETE', name as never)).toBeNull();
  });

  it('respects the existing path length limit', () => {
    const suggestion = suggestDropboxPath('SERVICIO', 'N'.repeat(500))!;
    expect(suggestion.length).toBeLessThanOrEqual(DROPBOX_PATH_MAX_LENGTH);
    expect(suggestion.startsWith('PROVEEDOR DE SERVICIOS/N')).toBe(true);
    const spaced = suggestDropboxPath('FLETE', `${'N'.repeat(190)} ${'M'.repeat(50)}`)!;
    expect(spaced.length).toBeLessThanOrEqual(DROPBOX_PATH_MAX_LENGTH);
    expect(spaced).not.toMatch(/[\s.]$/);
  });

  it('every non-null suggestion is accepted, unchanged, by the dropboxPath validator', () => {
    const names = ['TRANSPORTES KARINA', 'Ñandú/Ñu', 'A\\B', 'CO. SA DE CV.', 'x'.repeat(400), 'a  b', 'ÁÉÍÓÚ', 'A<B', 'name .', '.hidden', '..x', '- guión -', "O'Neil & Sons", '{ANIO}'];
    for (const type of Object.keys(COMPANY_TYPE_DROPBOX_FOLDERS)) {
      for (const name of names) {
        const suggestion = suggestDropboxPath(type, name);
        if (suggestion === null) continue;
        expect(normalizeDropboxPath(suggestion)).toBe(suggestion);
      }
    }
  });

  it('is pure: same input, same output, no side effects', () => {
    expect(suggestDropboxPath('FLETE', 'ACME')).toBe(suggestDropboxPath('FLETE', 'ACME'));
  });
});

describe('GET /companies/dropbox-path-suggestion', () => {
  const search = vi.fn();
  const controller = new CompaniesController({ search } as never);

  async function validated(payload: object) {
    const dto = plainToInstance(SuggestDropboxPathDto, payload);
    return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
  }

  it('returns the camelCase contract { data: { suggestedDropboxPath } }', async () => {
    const { dto, errors } = await validated({ companyType: 'FLETE', commercialName: 'TRANSPORTES KARINA' });
    expect(errors).toHaveLength(0);
    expect(controller.suggestDropboxPath(dto)).toEqual({ data: { suggestedDropboxPath: 'FLETES/TRANSPORTES KARINA' } });
  });

  it('supports CLIENTE from day one', async () => {
    const { dto } = await validated({ companyType: 'CLIENTE', commercialName: 'Cliente Uno' });
    expect(controller.suggestDropboxPath(dto).data.suggestedDropboxPath).toBe('CLIENTES/Cliente Uno');
  });

  it('trims the name and answers null (not an error) when nothing safe can be suggested', async () => {
    const { dto, errors } = await validated({ companyType: 'PROVEEDOR', commercialName: '  ???  ' });
    expect(errors).toHaveLength(0);
    expect(controller.suggestDropboxPath(dto)).toEqual({ data: { suggestedDropboxPath: null } });
  });

  it('is calculation only: it touches no repository or service', async () => {
    const { dto } = await validated({ companyType: 'SERVICIO', commercialName: 'X' });
    controller.suggestDropboxPath(dto);
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown type', { companyType: 'OTRO', commercialName: 'X' }],
    ['lowercase type', { companyType: 'flete', commercialName: 'X' }],
    ['missing type', { commercialName: 'X' }],
    ['missing name', { companyType: 'FLETE' }],
    ['blank name', { companyType: 'FLETE', commercialName: '   ' }],
    ['over-long name', { companyType: 'FLETE', commercialName: 'x'.repeat(301) }],
    ['unexpected field', { companyType: 'FLETE', commercialName: 'X', companyId: '1' }]
  ])('rejects %s with a validation error (HTTP 400)', async (_label, payload) => {
    expect((await validated(payload)).errors.length).toBeGreaterThan(0);
  });
});
