import { describe, expect, it } from 'vitest';
import {
  buildPaymentDestinationPath,
  DEFAULT_PAYMENT_DESTINATION_PATH,
  DROPBOX_PATH_MAX_LENGTH,
  DropboxPathError,
  normalizeDropboxPath
} from '../src/payment-notification-settings/dropbox-path';

function codeOf(input: string): string | undefined {
  try {
    normalizeDropboxPath(input);
    return undefined;
  } catch (error) {
    return error instanceof DropboxPathError ? error.code : 'UNEXPECTED';
  }
}

describe('normalizeDropboxPath', () => {
  it('returns null for null, undefined and blank input', () => {
    expect(normalizeDropboxPath(null)).toBeNull();
    expect(normalizeDropboxPath(undefined)).toBeNull();
    expect(normalizeDropboxPath('')).toBeNull();
    expect(normalizeDropboxPath('   ')).toBeNull();
  });

  it('accepts a relative path with "/" as-is (the persisted canonical form)', () => {
    expect(normalizeDropboxPath('FLETES/TRANSPORTES KARINA')).toBe('FLETES/TRANSPORTES KARINA');
    expect(normalizeDropboxPath('PROVEEDOR DE SERVICIOS/A&N')).toBe('PROVEEDOR DE SERVICIOS/A&N');
  });

  it('accepts "\\" and mixed separators and normalizes them to "/"', () => {
    expect(normalizeDropboxPath('FLETES\\TRANSPORTES KARINA')).toBe('FLETES/TRANSPORTES KARINA');
    expect(normalizeDropboxPath('FLETES\\SUB/TRANSPORTES KARINA')).toBe('FLETES/SUB/TRANSPORTES KARINA');
  });

  it('trims the whole input and drops a trailing separator', () => {
    expect(normalizeDropboxPath('  FLETES/TRANSPORTES KARINA  ')).toBe('FLETES/TRANSPORTES KARINA');
    expect(normalizeDropboxPath('FLETES/TRANSPORTES KARINA/')).toBe('FLETES/TRANSPORTES KARINA');
    expect(normalizeDropboxPath('FLETES\\TRANSPORTES KARINA\\')).toBe('FLETES/TRANSPORTES KARINA');
  });

  it.each([
    ['C:\\Users\\06\\Documents\\Dropbox\\FLETES'],
    ['D:\\FLETES'],
    ['c:/fletes'],
    ['C:FLETES']
  ])('rejects the Windows absolute path %s', (input) => {
    expect(codeOf(input)).toBe('DROPBOX_PATH_ABSOLUTE');
  });

  it.each([['\\\\servidor\\share\\FLETES'], ['//servidor/share/FLETES']])('rejects the UNC path %s', (input) => {
    expect(codeOf(input)).toBe('DROPBOX_PATH_ABSOLUTE');
  });

  it.each([['/FLETES/KARINA'], ['\\FLETES\\KARINA'], ['/']])('rejects the rooted/POSIX absolute path %s', (input) => {
    expect(codeOf(input)).toBe('DROPBOX_PATH_ABSOLUTE');
  });

  it.each([['..'], ['FLETES/../OTRO'], ['FLETES\\..\\OTRO'], ['./FLETES'], ['FLETES/./KARINA'], ['FLETES/..']])('rejects the traversal segment in %s', (input) => {
    expect(codeOf(input)).toBe('DROPBOX_PATH_TRAVERSAL');
  });

  it('rejects empty segments (double separators)', () => {
    expect(codeOf('FLETES//KARINA')).toBe('DROPBOX_PATH_EMPTY_SEGMENT');
    expect(codeOf('FLETES\\\\KARINA')).toBe('DROPBOX_PATH_EMPTY_SEGMENT');
  });

  it('rejects segments padded with whitespace or ending in a dot', () => {
    expect(codeOf('FLETES / KARINA')).toBe('DROPBOX_PATH_SEGMENT_WHITESPACE');
    expect(codeOf('FLETES/KARINA ')).toBeUndefined();
    expect(codeOf('FLETES /KARINA')).toBe('DROPBOX_PATH_SEGMENT_WHITESPACE');
    expect(codeOf('FLETES/KARINA.')).toBe('DROPBOX_PATH_SEGMENT_WHITESPACE');
  });

  it.each([['FLETES/KA:RINA'], ['FLETES/KA*RINA'], ['FLETES/KA?RINA'], ['FLETES/KA"RINA'], ['FLETES/KA<RINA'], ['FLETES/KA>RINA'], ['FLETES/KA|RINA'], ['FLETES/KA\u0000RINA'], ['FLETES/{ANIO}']])('rejects invalid character in %j', (input) => {
    expect(codeOf(input)).toBe('DROPBOX_PATH_INVALID_CHARACTER');
  });

  it('rejects an over-long path and accepts one exactly at the limit', () => {
    expect(codeOf('A'.repeat(DROPBOX_PATH_MAX_LENGTH + 1))).toBe('DROPBOX_PATH_TOO_LONG');
    expect(codeOf('A'.repeat(DROPBOX_PATH_MAX_LENGTH))).toBeUndefined();
  });

  it('never persists an absolute path: no accepted input contains a drive, a UNC prefix or a leading separator', () => {
    for (const input of ['FLETES/KARINA', 'FLETES\\KARINA', ' FLETES/KARINA/ ']) {
      const result = normalizeDropboxPath(input)!;
      expect(result).not.toMatch(/^[A-Za-z]:|^[\\/]|\\/);
    }
  });
});

describe('buildPaymentDestinationPath', () => {
  it('generates the exact destination with "\\" separators and literal placeholders', () => {
    expect(buildPaymentDestinationPath('FLETES/TRANSPORTES KARINA')).toBe('FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}');
  });

  it('gives the same destination for "/" and "\\" input', () => {
    expect(buildPaymentDestinationPath('FLETES\\TRANSPORTES KARINA')).toBe(buildPaymentDestinationPath('FLETES/TRANSPORTES KARINA'));
  });

  it('keeps the three placeholders intact and unexpanded', () => {
    const destination = buildPaymentDestinationPath('PROVEEDORES/COMPO');
    expect(destination).toContain('{ANIO}');
    expect(destination).toContain('{MES_NUM}');
    expect(destination).toContain('{MES_NOMBRE_TITULO}');
    expect(destination.endsWith('{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}')).toBe(true);
  });

  it('matches the shape of the existing production rows (dropbox "/" -> destination "\\")', () => {
    expect(buildPaymentDestinationPath('PROVEEDORES/COMPO')).toBe('PROVEEDORES\\COMPO\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}');
  });

  it('yields the NOT NULL column default (never a partial path) when there is no dropbox path', () => {
    expect(buildPaymentDestinationPath(null)).toBe(DEFAULT_PAYMENT_DESTINATION_PATH);
    expect(buildPaymentDestinationPath('')).toBe(DEFAULT_PAYMENT_DESTINATION_PATH);
    expect(DEFAULT_PAYMENT_DESTINATION_PATH).toBe('PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}');
  });

  it('refuses to derive a destination from an invalid path', () => {
    expect(() => buildPaymentDestinationPath('C:\\FLETES')).toThrow(DropboxPathError);
    expect(() => buildPaymentDestinationPath('../FLETES')).toThrow(DropboxPathError);
  });
});
