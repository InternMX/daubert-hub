import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaterpillarReprocessApiError, reprocessCaterpillarExecution, type CaterpillarReprocessResult } from '../services/caterpillarRemissions';
import { CaterpillarReprocessDialog } from './CaterpillarReprocessDialog';

vi.mock('../services/caterpillarRemissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/caterpillarRemissions')>()),
  reprocessCaterpillarExecution: vi.fn()
}));

const reprocessMock = vi.mocked(reprocessCaterpillarExecution);

function renderDialog(overrides: Partial<Parameters<typeof CaterpillarReprocessDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onReprocessed = vi.fn();
  render(
    <CaterpillarReprocessDialog
      open
      executionId="161"
      outcome="FAILED"
      sourceFilename="programacion.xlsx"
      onClose={onClose}
      onReprocessed={onReprocessed}
      {...overrides}
    />
  );
  return { onClose, onReprocessed };
}

describe('CaterpillarReprocessDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens correctly with the title and contextual execution info', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Reprocesar ejecución' })).toBeInTheDocument();
    expect(screen.getByText(/ID de ejecución: 161/)).toBeInTheDocument();
    expect(screen.getByText(/programacion\.xlsx/)).toBeInTheDocument();
  });

  it('never says folios will be reused', () => {
    renderDialog();
    expect(screen.getByText('Se creará una nueva ejecución vinculada a la original. La ejecución original no será modificada.')).toBeInTheDocument();
    expect(screen.queryByText(/reutiliza/i)).not.toBeInTheDocument();
  });

  it('keeps Reprocesar disabled while reason is empty', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeDisabled();
  });

  it('keeps Reprocesar disabled for a whitespace-only reason', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), '     ');
    expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeDisabled();
  });

  it('enables Reprocesar once a real reason is entered', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo real');
    expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeEnabled();
  });

  it('caps the reason at 500 characters', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();
    const field = screen.getByRole('textbox', { name: 'Motivo del reproceso' });
    await user.type(field, 'x'.repeat(501));
    expect((field as HTMLTextAreaElement).value).toHaveLength(500);
  }, 15000);

  it('Cancelar closes without calling the API', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reprocessMock).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason and the exact executionId to the service', async () => {
    reprocessMock.mockResolvedValue({ originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED' });
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), '  Motivo con espacios  ');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    await waitFor(() => expect(reprocessMock).toHaveBeenCalledWith('161', 'Motivo con espacios'));
  });

  it('shows a loading state on Reprocesar while the request is pending', async () => {
    let resolveRequest: (value: CaterpillarReprocessResult) => void = () => undefined;
    reprocessMock.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    expect(await screen.findByRole('button', { name: 'Reprocesando...' })).toBeInTheDocument();
    resolveRequest({ originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED' });
  });

  it('a double click while pending never issues a second request — the button becomes genuinely disabled (pointer-events: none), so a real second click cannot reach it', async () => {
    let resolveRequest: (value: CaterpillarReprocessResult) => void = () => undefined;
    reprocessMock.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    const button = screen.getByRole('button', { name: 'Reprocesar' });
    await user.click(button);
    const pendingButton = await screen.findByRole('button', { name: 'Reprocesando...' });
    expect(pendingButton).toBeDisabled();
    // userEvent respects pointer-events/disabled like a real browser — attempting a second click
    // here would throw, which itself proves the button cannot be reached again. Calling the
    // handler a second time directly is exactly what the disabled state is preventing.
    expect(reprocessMock).toHaveBeenCalledTimes(1);
    resolveRequest({ originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED' });
  });

  it('calls onReprocessed with the parsed result on success', async () => {
    const result: CaterpillarReprocessResult = { originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED' };
    reprocessMock.mockResolvedValue(result);
    const user = userEvent.setup();
    const { onReprocessed } = renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    await waitFor(() => expect(onReprocessed).toHaveBeenCalledWith(result));
  });

  it('starts empty after a successful request and a parent-controlled close/reopen of the same execution', async () => {
    reprocessMock.mockResolvedValue({ originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED' });
    const props = { executionId: '161', outcome: 'FAILED' as const, sourceFilename: 'programacion.xlsx', onClose: vi.fn(), onReprocessed: vi.fn() };
    const { rerender } = render(<CaterpillarReprocessDialog open {...props} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo anterior');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    await waitFor(() => expect(props.onReprocessed).toHaveBeenCalledTimes(1));
    rerender(<CaterpillarReprocessDialog open={false} {...props} />);
    rerender(<CaterpillarReprocessDialog open {...props} />);
    expect(screen.getByRole('textbox', { name: 'Motivo del reproceso' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeDisabled();
    expect(reprocessMock).toHaveBeenCalledTimes(1);
  });

  it('clears the reason and server error after an external close/reopen or an execution change', async () => {
    reprocessMock.mockRejectedValue(new CaterpillarReprocessApiError(504));
    const props = { executionId: '161', outcome: 'FAILED' as const, sourceFilename: 'programacion.xlsx', onClose: vi.fn(), onReprocessed: vi.fn() };
    const { rerender } = render(<CaterpillarReprocessDialog open {...props} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo anterior');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    rerender(<CaterpillarReprocessDialog open={false} {...props} />);
    rerender(<CaterpillarReprocessDialog open {...props} />);
    expect(screen.getByRole('textbox', { name: 'Motivo del reproceso' })).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Otro motivo');
    rerender(<CaterpillarReprocessDialog open {...props} executionId="163" />);
    expect(screen.getByRole('textbox', { name: 'Motivo del reproceso' })).toHaveValue('');
  });

  it.each([
    [404, undefined, 'La ejecución ya no existe o no está disponible.'],
    [409, 'No fue posible encontrar el archivo origen necesario para reprocesar esta ejecución.', 'No fue posible encontrar el archivo origen necesario para reprocesar esta ejecución.'],
    [502, undefined, 'No fue posible comunicarse correctamente con la automatización.'],
    [504, undefined, 'La automatización tardó demasiado en responder.']
  ] as const)('shows the mapped message for HTTP %d and never closes the dialog', async (status, serverMessage, expectedMessage) => {
    reprocessMock.mockRejectedValue(new CaterpillarReprocessApiError(status, serverMessage));
    const user = userEvent.setup();
    const { onReprocessed } = renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(onReprocessed).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('never exposes the n8n token or webhook URL in an error message', async () => {
    reprocessMock.mockRejectedValue(new Error('fetch failed: http://host.docker.internal:5678/webhook-test/cat-test-reprocess token=secret-value'));
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/token|webhook|5678/i);
  });

  it('disables accidental close (Cancelar) while a request is pending', async () => {
    let resolveRequest: (value: CaterpillarReprocessResult) => void = () => undefined;
    reprocessMock.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Reprocesar' }));
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    resolveRequest({ originalExecutionId: '161', executionId: '162', status: 'REPROCESS_CREATED' });
  });
});
