import { describe, expect, it } from 'vitest';
import { audiDiagnostic } from '../src/automations/remisiones-audi/audi-detail-presentation';
import { untrustedAudiDiagnostics } from './support/audi-diagnostic-fixtures';

describe('audiDiagnostic (default deny)', () => {
  it('preserves null when no error was recorded', () => {
    expect(audiDiagnostic(null)).toBeNull();
  });

  it.each(untrustedAudiDiagnostics)('returns only the fixed generic text for $label', ({ message, fragments }) => {
    const result = audiDiagnostic(message);
    expect(result).toBe('La ejecución registró un error. Consulta los registros autorizados para más información.');
    for (const fragment of fragments) expect(result).not.toContain(fragment);
  });

  it.each(['', '   ', '\t\r\n'])('does not turn a present but blank diagnostic into absence: %j', (message) => {
    expect(audiDiagnostic(message)).toBe('La ejecución registró un error. Consulta los registros autorizados para más información.');
  });
});
