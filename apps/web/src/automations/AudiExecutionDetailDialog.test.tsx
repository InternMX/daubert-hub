import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudiExecutionsApiError, getAudiExecution, type AudiExecutionDetail } from '../services/audiExecutions';
import { AudiExecutionDetailDialog } from './AudiExecutionDetailDialog';

vi.mock('../services/audiExecutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/audiExecutions')>()), getAudiExecution: vi.fn()
}));
const getMock = vi.mocked(getAudiExecution);
const detail: AudiExecutionDetail = {
  executionId: '9007199254740993', outcome: 'COMPLETED', startedAt: '2026-08-27T22:39:53.204Z', finishedAt: '2026-08-27T22:40:01.933Z',
  generatedCount: 1, latestErrorMessage: null, sourceDocument: { documentId: '103', filename: 'entrada.xlsx' },
  remittances: [{ remissionId: '11', seriesCode: 'REMISION_AUDI', folio: '9007199254740994', documentDate: '2026-08-27', status: 'GENERADA' }]
};

describe('AudiExecutionDetailDialog', () => {
  beforeEach(() => { getMock.mockReset().mockResolvedValue(detail); });
  it('displays the persisted identity, dates, status and exact folios without requiring reservations', async () => {
    render(<AudiExecutionDetailDialog executionId={detail.executionId} onClose={vi.fn()} />);
    expect(await screen.findByText('entrada.xlsx')).toBeInTheDocument();
    expect(screen.getByText(detail.executionId)).toBeInTheDocument();
    expect(screen.getByText('Completado')).toBeInTheDocument();
    expect(screen.getByText('27 ago 2026 · 16:39')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Remisiones de la ejecución Audi' });
    expect(within(table).getByText('9007199254740994')).toBeInTheDocument();
    expect(within(table).getByText('27 ago 2026')).toBeInTheDocument();
    expect(within(table).getByText('Generada')).toBeInTheDocument();
    expect(screen.queryByText('Diagnóstico registrado')).not.toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);
  });
  it('renders zero remissions and missing metadata as an ordinary empty state', async () => {
    getMock.mockResolvedValue({ ...detail, generatedCount: 0, remittances: [], sourceDocument: null, finishedAt: null });
    render(<AudiExecutionDetailDialog executionId="8" onClose={vi.fn()} />);
    expect(await screen.findByText('Sin remisiones registradas. No hay folios asociados disponibles.')).toBeInTheDocument();
    expect(screen.getAllByText('No disponible')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('shows a recorded error on a failed execution even without remissions', async () => {
    getMock.mockResolvedValue({ ...detail, outcome: 'FAILED', generatedCount: 0, remittances: [], latestErrorMessage: 'No fue posible generar el documento.' });
    render(<AudiExecutionDetailDialog executionId="8" onClose={vi.fn()} />);
    expect(await screen.findByText('Fallido')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible generar el documento.');
    expect(screen.getByText('Diagnóstico registrado')).toBeInTheDocument();
  });
  it('shows loading then a safe error and retries successfully', async () => {
    let reject: (error: unknown) => void = () => {};
    getMock.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const user = userEvent.setup();
    render(<AudiExecutionDetailDialog executionId="8" onClose={vi.fn()} />);
    expect(screen.getByRole('progressbar', { name: 'Cargando detalle de la ejecución' })).toBeInTheDocument();
    reject(new Error('private database information'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible cargar el detalle de esta ejecución.');
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('entrada.xlsx')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
  });
  it('distinguishes 404 from an existing execution with an empty collection', async () => {
    getMock.mockRejectedValue(new AudiExecutionsApiError(404));
    render(<AudiExecutionDetailDialog executionId="9" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('La ejecución no existe o no está disponible para Audi.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin remisiones registradas/)).not.toBeInTheDocument();
  });
  it('ignores a pending response for a previously selected execution', async () => {
    let resolve: (value: AudiExecutionDetail) => void = () => {};
    getMock.mockReturnValueOnce(new Promise((resolvePromise) => { resolve = resolvePromise; }));
    const view = render(<AudiExecutionDetailDialog executionId="7" onClose={vi.fn()} />);
    view.rerender(<AudiExecutionDetailDialog executionId="8" onClose={vi.fn()} />);
    expect(await screen.findByText('entrada.xlsx')).toBeInTheDocument();
    resolve({ ...detail, sourceDocument: { documentId: '1', filename: 'anterior.xlsx' } });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('anterior.xlsx')).not.toBeInTheDocument();
  });
});
