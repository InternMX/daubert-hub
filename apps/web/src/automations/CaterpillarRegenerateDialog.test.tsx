import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaterpillarReprocessApiError, regenerateCaterpillarExecution, type CaterpillarRegenerationResult } from '../services/caterpillarRemissions';
import { CaterpillarRegenerateDialog } from './CaterpillarRegenerateDialog';
import { caterpillarRegenerationErrorMessage, caterpillarRegenerationSuccessMessage } from './caterpillarPresentation';

vi.mock('../services/caterpillarRemissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/caterpillarRemissions')>()),
  regenerateCaterpillarExecution: vi.fn()
}));

const regenerateMock = vi.mocked(regenerateCaterpillarExecution);
const result: CaterpillarRegenerationResult = { originalExecutionId: '300', executionId: '301', status: 'REGENERATION_STARTED', authorization: null };

function renderDialog() {
  const onClose = vi.fn();
  const onRegenerated = vi.fn();
  render(<CaterpillarRegenerateDialog open executionId="300" sourceFilename="programacion.xlsx" onClose={onClose} onRegenerated={onRegenerated} />);
  return { onClose, onRegenerated };
}

describe('CaterpillarRegenerateDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains that it authorizes ONE new emission, keeps the original, records the user, and is not a reprocess', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Regenerar remisiones' })).toBeInTheDocument();
    expect(screen.getByText(/autoriza una sola emisión nueva/i)).toBeInTheDocument();
    expect(screen.getByText(/se conservan/i)).toBeInTheDocument();
    expect(screen.getByText(/no genera una regeneración por sí solo/i)).toBeInTheDocument();
    expect(screen.queryByText(/reprocesar/i)).not.toBeInTheDocument();
  });

  it('keeps the confirmation disabled until a real (non-blank) reason is typed', async () => {
    renderDialog();
    const confirm = screen.getByRole('button', { name: 'Autorizar y regenerar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motivo de la regeneración/), '   ');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motivo de la regeneración/), 'Corrección comercial');
    expect(confirm).toBeEnabled();
  });

  it('sends the trimmed reason and the exact execution id, then reports the parsed result', async () => {
    regenerateMock.mockResolvedValue(result);
    const { onRegenerated } = renderDialog();
    await userEvent.type(screen.getByLabelText(/Motivo de la regeneración/), '  Corrección comercial  ');
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar y regenerar' }));
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledWith(result));
    expect(regenerateMock).toHaveBeenCalledWith('300', 'Corrección comercial');
    expect(regenerateMock).toHaveBeenCalledTimes(1);
  });

  it('shows the backend business rejection verbatim and stays open (no silent retry)', async () => {
    regenerateMock.mockRejectedValue(new CaterpillarReprocessApiError(409, 'Todas las remisiones de la ejecución deben estar canceladas formalmente antes de regenerar.'));
    const { onRegenerated, onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText(/Motivo de la regeneración/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar y regenerar' }));
    expect(await screen.findByText(/canceladas formalmente/)).toBeInTheDocument();
    expect(onRegenerated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(regenerateMock).toHaveBeenCalledTimes(1);
  });
});

describe('regeneration messages', () => {
  it('distinguishes started / already running / already regenerated, and never claims completion', () => {
    expect(caterpillarRegenerationSuccessMessage(result)).toMatch(/Regeneración iniciada\. Nueva ejecución: #301/);
    expect(caterpillarRegenerationSuccessMessage(result)).not.toMatch(/completad/i);
    expect(caterpillarRegenerationSuccessMessage({ ...result, status: 'ALREADY_PROCESSING' })).toMatch(/ya está en curso/);
    expect(caterpillarRegenerationSuccessMessage({ ...result, status: 'ALREADY_REGENERATED' })).toMatch(/ya fue regenerada.*#301/);
  });
  it('tells the user a timeout still left the authorization recorded and that retrying will not duplicate', () => {
    expect(caterpillarRegenerationErrorMessage(new CaterpillarReprocessApiError(504))).toMatch(/quedó registrada.*no se duplicará/);
    expect(caterpillarRegenerationErrorMessage(new CaterpillarReprocessApiError(502))).toMatch(/quedó registrada.*no se duplicará/);
    expect(caterpillarRegenerationErrorMessage(new CaterpillarReprocessApiError(403))).toMatch(/administrador/);
    expect(caterpillarRegenerationErrorMessage(new Error('boom'))).toBe('No fue posible solicitar la regeneración. Intenta nuevamente.');
  });
});
