import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaterpillarCancelRemissionDialog } from './CaterpillarCancelRemissionDialog';
import { cancelCaterpillarRemission, CaterpillarCancellationApiError, type CaterpillarCancelResult, type CaterpillarRemittance } from '../services/caterpillarRemissions';
vi.mock('../services/caterpillarRemissions', async (original) => ({ ...(await original<typeof import('../services/caterpillarRemissions')>()), cancelCaterpillarRemission: vi.fn() }));
const cancel = vi.mocked(cancelCaterpillarRemission);
const remission: CaterpillarRemittance = { remissionId: '100', seriesId: '5', seriesCode: 'REMISION_CAT_P5', folio: '128',
  documentDate: '2026-10-20', pdfPath: 'original.pdf', status: 'GENERADA', revision: '2026-10-20T12:00:00.123456Z', processLabel: null, details: [] };
const result: CaterpillarCancelResult = { status: 'ALREADY_CANCELLED', remissionId: '100', cancellationReason: 'Original', cancellation: null };
describe('Caterpillar individual cancellation dialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('shows exact identity, unknown process honestly, and no folio recovery promise', () => {
    render(<CaterpillarCancelRemissionDialog executionId="14" remission={remission} onClose={vi.fn()} onCancelled={vi.fn()} />);
    expect(screen.getByText(/Folio: 128/)).toBeInTheDocument();
    expect(screen.getByText(/Proceso no determinado/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no recupera folios');
    expect(screen.getByRole('alert')).toHaveTextContent('No verifica si el documento fue enviado');
    expect(screen.getByRole('button', { name: 'Confirmar cancelación' })).toBeDisabled();
  });
  it('trims reason, sends the exact revision and only reports success after API confirmation', async () => {
    let resolve!: (value: CaterpillarCancelResult) => void;
    cancel.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onCancelled = vi.fn(), onClose = vi.fn();
    render(<CaterpillarCancelRemissionDialog executionId="14" remission={remission} onClose={onClose} onCancelled={onCancelled} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '  Motivo  ');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    expect(cancel).toHaveBeenCalledWith('14','100','Motivo',remission.revision);
    expect(onCancelled).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelando...' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    resolve(result);
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(result));
  });
  it('requires refresh after conflict and does not display raw network errors', async () => {
    cancel.mockRejectedValueOnce(new CaterpillarCancellationApiError(409));
    render(<CaterpillarCancelRemissionDialog executionId="14" remission={remission} onClose={vi.fn()} onCancelled={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    expect(await screen.findByText(/La remisión cambió o no es elegible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar cancelación' })).toBeDisabled();
  });
  it('sanitizes unexpected errors and never calls success on failure', async () => {
    cancel.mockRejectedValueOnce(new Error('private SQL token /filesystem'));
    const success = vi.fn();
    render(<CaterpillarCancelRemissionDialog executionId="14" remission={remission} onClose={vi.fn()} onCancelled={success} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Motivo');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    expect(await screen.findByText(/No fue posible confirmar/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/private SQL|token|filesystem/);
    expect(success).not.toHaveBeenCalled();
  });
});
