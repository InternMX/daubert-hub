import { describe, expect, it } from 'vitest';
import { parsePaymentNotificationFileErrors } from '../src/automations/payment-notifications/payment-notification-file-errors';

const HASH_A = 'a'.repeat(64);
const HASH_B = '0123456789abcdef'.repeat(4);

describe('parsePaymentNotificationFileErrors', () => {
  it('returns [] for null, undefined and empty/blank input', () => {
    expect(parsePaymentNotificationFileErrors(null)).toEqual([]);
    expect(parsePaymentNotificationFileErrors(undefined)).toEqual([]);
    expect(parsePaymentNotificationFileErrors('')).toEqual([]);
    expect(parsePaymentNotificationFileErrors('  \n \r\n ')).toEqual([]);
  });

  it('parses a single valid line', () => {
    expect(parsePaymentNotificationFileErrors(`archivo.pdf: ALIAS_NO_CATALOGADO - PROVEEDOR | HASH=${HASH_A}`)).toEqual([
      { fileName: 'archivo.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'PROVEEDOR', fileHash: HASH_A }
    ]);
  });

  it('parses several lines separated by LF, preserving order', () => {
    const text = `13.-KARINA MEZA.pdf: ALIAS_NO_CATALOGADO - KARINA MEZA | HASH=${HASH_A}\n2.-CTO DE ABASTECIMIENT.pdf: ALIAS_NO_CATALOGADO - CTO DE ABASTECIMIENT | HASH=${HASH_B}`;
    expect(parsePaymentNotificationFileErrors(text)).toEqual([
      { fileName: '13.-KARINA MEZA.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'KARINA MEZA', fileHash: HASH_A },
      { fileName: '2.-CTO DE ABASTECIMIENT.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'CTO DE ABASTECIMIENT', fileHash: HASH_B }
    ]);
  });

  it('supports CRLF (and a trailing newline)', () => {
    const text = `a.pdf: ALIAS_AMBIGUO - X | HASH=${HASH_A}\r\nb.pdf: FECHA_PAGO_NO_ENCONTRADA - Y | HASH=${HASH_B}\r\n`;
    const result = parsePaymentNotificationFileErrors(text);
    expect(result.map((item) => item.fileName)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.map((item) => item.errorCode)).toEqual(['ALIAS_AMBIGUO', 'FECHA_PAGO_NO_ENCONTRADA']);
    expect(result[1]!.fileHash).toBe(HASH_B);
  });

  it('accepts a brand-new error code without any code change (no whitelist)', () => {
    expect(parsePaymentNotificationFileErrors(`x.pdf: NUEVO_ERROR - algo | HASH=${HASH_A}`)[0]?.errorCode).toBe('NUEVO_ERROR');
    expect(parsePaymentNotificationFileErrors(`x.pdf: ERROR_2_FUTURO | HASH=${HASH_A}`)[0]?.errorCode).toBe('ERROR_2_FUTURO');
  });

  it('returns detail=null when the detail is absent or empty', () => {
    expect(parsePaymentNotificationFileErrors(`x.pdf: RUTA_NO_VALIDADA | HASH=${HASH_A}`)).toEqual([
      { fileName: 'x.pdf', errorCode: 'RUTA_NO_VALIDADA', detail: null, fileHash: HASH_A }
    ]);
    expect(parsePaymentNotificationFileErrors(`x.pdf: RUTA_NO_VALIDADA -  | HASH=${HASH_A}`)[0]?.detail).toBeNull();
  });

  it('ignores lines whose HASH is not a valid SHA-256', () => {
    expect(parsePaymentNotificationFileErrors('x.pdf: ALIAS_NO_CATALOGADO - P | HASH=abc123')).toEqual([]);
    expect(parsePaymentNotificationFileErrors(`x.pdf: ALIAS_NO_CATALOGADO - P | HASH=${'g'.repeat(64)}`)).toEqual([]);
    expect(parsePaymentNotificationFileErrors(`x.pdf: ALIAS_NO_CATALOGADO - P | HASH=${HASH_A}00`)).toEqual([]);
  });

  it('ignores lines without a HASH', () => {
    expect(parsePaymentNotificationFileErrors('x.pdf: ALIAS_NO_CATALOGADO - PROVEEDOR')).toEqual([]);
  });

  it('keeps valid lines when mixed with unrelated garbage lines', () => {
    const text = `Error general del flujo\n???\nx.pdf: ALIAS_NO_CATALOGADO - P | HASH=${HASH_A}\n: | HASH=\nTimeout al escribir`;
    expect(parsePaymentNotificationFileErrors(text)).toEqual([
      { fileName: 'x.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'P', fileHash: HASH_A }
    ]);
  });

  it('keeps spaces in file names and details', () => {
    const [item] = parsePaymentNotificationFileErrors(`Pago Enero 2026 (final).pdf: ALIAS_NO_CATALOGADO - CTO DE ABASTECIMIENT SA DE CV | HASH=${HASH_A}`);
    expect(item?.fileName).toBe('Pago Enero 2026 (final).pdf');
    expect(item?.detail).toBe('CTO DE ABASTECIMIENT SA DE CV');
  });

  it('keeps " - " and "|" characters inside the detail', () => {
    const [item] = parsePaymentNotificationFileErrors(`a.pdf: ALIAS_NO_CATALOGADO - A - B | C | HASH=${HASH_A}`);
    expect(item?.detail).toBe('A - B | C');
  });

  it('does not deduplicate repeated lines', () => {
    const line = `x.pdf: ALIAS_NO_CATALOGADO - P | HASH=${HASH_A}`;
    expect(parsePaymentNotificationFileErrors(`${line}\n${line}`)).toHaveLength(2);
  });

  it('never throws on legacy or hostile input', () => {
    const inputs = ['Error: algo salió mal', 'a: b: c: d', '|'.repeat(5000), `${'x'.repeat(20000)}: ${'A'.repeat(20000)}`, '<script>alert(1)</script>', 'HASH=', '\u0000\u0001'];
    for (const input of inputs) expect(() => parsePaymentNotificationFileErrors(input)).not.toThrow();
    expect(parsePaymentNotificationFileErrors('<script>alert(1)</script>')).toEqual([]);
  });

  it('treats markup in fields as plain data', () => {
    const [item] = parsePaymentNotificationFileErrors(`<b>x</b>.pdf: ALIAS_NO_CATALOGADO - <i>P</i> | HASH=${HASH_A}`);
    expect(item?.fileName).toBe('<b>x</b>.pdf');
    expect(item?.detail).toBe('<i>P</i>');
  });
});
