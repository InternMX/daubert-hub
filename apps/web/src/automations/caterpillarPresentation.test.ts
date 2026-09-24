import { describe, expect, it } from 'vitest';
import { CaterpillarReprocessApiError, type CaterpillarReprocessResult } from '../services/caterpillarRemissions';
import { caterpillarReprocessErrorMessage, caterpillarReprocessSuccessMessage } from './caterpillarPresentation';

function result(overrides: Partial<CaterpillarReprocessResult> = {}): CaterpillarReprocessResult {
  return { originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED', ...overrides };
}

describe('caterpillarReprocessSuccessMessage', () => {
  it('shows the new child executionId for REPROCESS_CREATED', () => {
    expect(caterpillarReprocessSuccessMessage(result({ status: 'REPROCESS_CREATED', executionId: '162' })))
      .toBe('Reproceso iniciado correctamente. Nueva ejecución: #162');
  });

  it('never mentions an executionId for ALREADY_PROCESSING', () => {
    expect(caterpillarReprocessSuccessMessage(result({ status: 'ALREADY_PROCESSING' }))).toBe('El reproceso ya está en curso.');
  });

  it('shows the existing child executionId for ALREADY_REPROCESSED', () => {
    expect(caterpillarReprocessSuccessMessage(result({ status: 'ALREADY_REPROCESSED', executionId: '162' })))
      .toBe('Esta ejecución ya fue reprocesada. Reproceso existente: #162');
  });
});

describe('caterpillarReprocessErrorMessage', () => {
  it('maps 404 to a fixed not-found message', () => {
    expect(caterpillarReprocessErrorMessage(new CaterpillarReprocessApiError(404, 'algo distinto'))).toBe('La ejecución ya no existe o no está disponible.');
  });

  it('shows the backend-provided message for a 409 (covers NOT_ELIGIBLE_STATE/SOURCE_FILE_MISSING/OUTSIDE_TEST_SCOPE)', () => {
    expect(caterpillarReprocessErrorMessage(new CaterpillarReprocessApiError(409, 'El archivo origen está fuera del área permitida para pruebas.')))
      .toBe('El archivo origen está fuera del área permitida para pruebas.');
  });

  it('falls back to a generic 409 message when the backend supplied none', () => {
    expect(caterpillarReprocessErrorMessage(new CaterpillarReprocessApiError(409, undefined))).toBe('Esta ejecución ya no es elegible para reproceso.');
  });

  it('maps 502 to an infrastructure message', () => {
    expect(caterpillarReprocessErrorMessage(new CaterpillarReprocessApiError(502, undefined))).toBe('No fue posible comunicarse correctamente con la automatización.');
  });

  it('maps 504 to a timeout message', () => {
    expect(caterpillarReprocessErrorMessage(new CaterpillarReprocessApiError(504, undefined))).toBe('La automatización tardó demasiado en responder.');
  });

  it('never exposes a raw backend message, status text, token, or URL for an unrecognized error shape', () => {
    const message = caterpillarReprocessErrorMessage(new Error('fetch failed: http://host.docker.internal:5678/webhook-test/cat-test-reprocess token=secret'));
    expect(message).toBe('No fue posible solicitar el reproceso. Intenta nuevamente.');
    expect(message).not.toMatch(/token|webhook|5678/i);
  });
});
