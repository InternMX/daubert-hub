import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudiExecutionsApiError, getAudiExecution, type AudiExecutionDetail } from '../services/audiExecutions';
import { AudiExecutionDetailDialog } from './AudiExecutionDetailDialog';
import { testAdminUser, testGeneralUser, TestAuthProvider } from '../test/authTestUtils';
import { audiRecoveryErrorMessage } from './audiProcessingPresentation';

vi.mock('../services/audiExecutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/audiExecutions')>()), getAudiExecution: vi.fn()
}));
const getMock = vi.mocked(getAudiExecution);
afterEach(() => vi.unstubAllGlobals());
const detail: AudiExecutionDetail = {
  executionId: '9007199254740993', outcome: 'COMPLETED', startedAt: '2026-08-27T22:39:53.204Z', finishedAt: '2026-08-27T22:40:01.933Z',
  generatedCount: 1, latestErrorMessage: null, sourceDocument: { documentId: '103', filename: 'entrada.xlsx' },
  remittances: [{ remissionId: '11', seriesCode: 'REMISION_AUDI', folio: '9007199254740994', documentDate: '2026-08-27', status: 'GENERADA' }]
};

function detailView(executionId: string, user = testGeneralUser) {
  return <TestAuthProvider value={{ user }}><AudiExecutionDetailDialog executionId={executionId} onClose={vi.fn()} /></TestAuthProvider>;
}

const controls = [
  ['REPROCESS', 'Reprocesar', 'usa folios nuevos'],
  ['RECONCILE', 'Reconciliar', 'con sus folios originales'],
  ['STOP', 'Detener', 'Cancelar es una acción distinta'],
  ['CANCEL', 'Cancelar', 'Detener solo solicita']
] as const;

describe('AudiExecutionDetailDialog', () => {
  beforeEach(() => { getMock.mockReset().mockImplementation(async (executionId) => ({ ...detail, executionId })); });
  it('displays the persisted identity, dates, status and exact folios without requiring reservations', async () => {
    render(detailView(detail.executionId));
    expect(await screen.findByText('entrada.xlsx')).toBeInTheDocument();
    expect(screen.getByText(detail.executionId)).toBeInTheDocument();
    expect(screen.getByText('Completado')).toBeInTheDocument();
    expect(screen.getByText('27 ago 2026 · 16:39')).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Remisión Audi 9007199254740994 — REMISION_AUDI' });
    expect(within(card).getByText('Folio 9007199254740994 — REMISION_AUDI')).toBeInTheDocument();
    expect(within(card).getByText('27 ago 2026')).toBeInTheDocument();
    expect(within(card).getByText('Generada')).toBeInTheDocument();
    expect(within(card).getByText('11')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Diagnóstico registrado')).not.toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);
  });
  it('renders five persisted remissions as individually labelled cards in the scrolling dialog', async () => {
    const remittances = Array.from({ length: 5 }, (_, index) => ({
      ...detail.remittances[0]!, remissionId: String(11 + index), folio: String(9007199254740994n + BigInt(index))
    }));
    getMock.mockResolvedValue({ ...detail, executionId: '8', generatedCount: 5, remittances });
    render(detailView('8'));
    expect(await screen.findByText('entrada.xlsx')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Detalle de ejecución Audi' });
    expect(within(dialog).getAllByRole('article')).toHaveLength(5);
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'General', 'Documento origen', 'Folios reservados', 'Remisiones', 'Evidencia de archivos', 'Historial de acciones'
    ]);
    for (const remission of remittances) {
      const card = within(dialog).getByRole('article', { name: `Remisión Audi ${remission.folio} — REMISION_AUDI` });
      expect(within(card).getByText(`Folio ${remission.folio} — REMISION_AUDI`)).toBeInTheDocument();
      expect(within(card).getByText(remission.remissionId)).toBeInTheDocument();
      expect(within(card).getByText('27 ago 2026')).toBeInTheDocument();
      expect(within(card).getByText('Generada')).toBeInTheDocument();
    }
    expect(dialog).toHaveClass('MuiDialog-paperWidthMd', 'MuiDialog-paperFullWidth', 'MuiDialog-paperScrollPaper');
    expect(within(dialog).getByText('Sin reserva vinculada disponible.')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('8');
  });
  it('renders zero remissions and missing metadata as an ordinary empty state', async () => {
    getMock.mockResolvedValue({ ...detail, executionId: '8', generatedCount: 0, remittances: [], sourceDocument: null, finishedAt: null });
    render(detailView('8'));
    expect(await screen.findByText('Sin remisiones registradas.')).toBeInTheDocument();
    expect(screen.getAllByText('No disponible')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('shows a recorded error on a failed execution even without remissions', async () => {
    getMock.mockResolvedValue({ ...detail, executionId: '8', outcome: 'FAILED', generatedCount: 0, remittances: [], latestErrorMessage: 'No fue posible generar el documento.' });
    render(detailView('8'));
    expect(await screen.findByText('Fallido')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible generar el documento.');
    expect(screen.getByText('Diagnóstico registrado')).toBeInTheDocument();
  });
  it('shows loading then a safe error and retries successfully', async () => {
    let reject: (error: unknown) => void = () => {};
    getMock.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const user = userEvent.setup();
    render(detailView('8'));
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
    render(detailView('9'));
    expect(await screen.findByRole('alert')).toHaveTextContent('La ejecución no existe o no está disponible para Audi.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin remisiones registradas/)).not.toBeInTheDocument();
  });
  it('ignores a pending response for a previously selected execution', async () => {
    let resolve: (value: AudiExecutionDetail) => void = () => {};
    getMock.mockReturnValueOnce(new Promise((resolvePromise) => { resolve = resolvePromise; }));
    const view = render(detailView('7'));
    view.rerender(detailView('8'));
    expect(await screen.findByText('entrada.xlsx')).toBeInTheDocument();
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolve({ ...detail, sourceDocument: { documentId: '1', filename: 'anterior.xlsx' } });
    });
    expect(screen.getByText('entrada.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('anterior.xlsx')).not.toBeInTheDocument();
  });

  it('displays reservation, versioned evidence and attempt details and opens either related execution', async () => {
    const user = userEvent.setup();
    const artifact = { type: 'REMISION_PDF', folio: '988', version: 1, current: false, fileName: 'anterior.pdf',
      sizeBytes: null, sha256: null, status: 'FALTANTE', verifiedAt: detail.startedAt, actionId: '5' };
    const recovery: AudiExecutionDetail = {
      ...detail, n8nExecutionId: '16061', reprocessOfExecutionId: '31', childExecutionId: '33', model: 'ATOMIC',
      reservation: { firstFolio: '988', lastFolio: '990', quantity: 3, status: 'RESERVADA' },
      artifacts: [artifact, { ...artifact, version: 2, current: true, fileName: 'vigente.pdf', status: 'VERIFICADO' }],
      recoveryAttempts: [{ actionId: '5', action: 'RECONCILE', status: 'EXPIRADA', resultCode: 'LEASE_EXPIRED',
        reason: 'Revisar archivos', actorName: 'Operador', createdAt: detail.startedAt, lastHeartbeatAt: detail.startedAt,
        finishedAt: detail.finishedAt, expiresAt: detail.startedAt, error: 'Último intento inconcluso.' }]
    };
    getMock.mockImplementation(async (executionId) => ({ ...recovery, executionId }));
    render(detailView(detail.executionId));
    expect(await screen.findByText('16061')).toBeInTheDocument();
    for (const label of ['988–990', 'RESERVADA', 'anterior.pdf', 'vigente.pdf', 'Histórica', 'Vigente', '1', '2',
      'Expirada', 'LEASE_EXPIRED', 'Último latido', 'Vence', 'Último intento inconcluso.']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    await user.click(screen.getByRole('button', { name: 'Abrir ejecución original 31' }));
    expect(await screen.findByText('16061')).toBeInTheDocument();
    expect(getMock).toHaveBeenLastCalledWith('31');
    await user.click(screen.getByRole('button', { name: 'Abrir ejecución de reproceso 33' }));
    expect(await screen.findByText('16061')).toBeInTheDocument();
    expect(getMock).toHaveBeenLastCalledWith('33');
  });

  it('hides recovery controls for GENERAL even when a response lists an enabled action', async () => {
    getMock.mockResolvedValue({ ...detail, availableActions: controls.map(([action]) => ({ action, enabled: true, disabledReason: null })) });
    render(detailView(detail.executionId));
    await screen.findByText('entrada.xlsx');
    for (const [, label] of controls) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });

  it('disables each ADMIN control and exposes its backend reason with a keyboard-accessible tooltip', async () => {
    const reasons = [
      ['INTEGRATION_NOT_CONFIGURED', 'Integración con n8n pendiente'],
      ['RECOVERY_NOT_INSTALLED', 'La recuperación de Audi aún no está instalada.'],
      ['PENDING_RECONCILIATION', 'La reserva o las remisiones pendientes requieren reconciliación.'],
      ['LEGACY_EXECUTION', 'Esta ejecución histórica requiere recuperación manual.']
    ] as const;
    getMock.mockResolvedValue({ ...detail, availableActions: controls.map(([action], index) => ({
      action, enabled: false, disabledReason: reasons[index]![0]
    })) });
    render(detailView(detail.executionId, testAdminUser));
    await screen.findByText('Acciones');
    for (const [index, [, label]] of controls.entries()) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button.parentElement).toHaveAttribute('tabindex', '0');
      fireEvent.mouseOver(button.parentElement!);
      expect(await screen.findByText(reasons[index]![1])).toBeInTheDocument();
      fireEvent.mouseLeave(button.parentElement!);
    }
  });

  it.each(controls)('confirms %s with a bounded reason, explains consequences and refreshes after a single POST', async (action, label, consequence) => {
    const user = userEvent.setup();
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    getMock.mockResolvedValue({ ...detail, revision: 'ERROR:5',
      availableActions: [{ action, enabled: true, disabledReason: null }] });
    render(detailView(detail.executionId, testAdminUser));
    await user.click(await screen.findByRole('button', { name: label }));
    const confirmation = screen.getByRole('dialog', { name: `${label} ejecución` });
    expect(within(confirmation).getByText(new RegExp(consequence))).toBeInTheDocument();
    expect(within(confirmation).getByText(/no se reutilizan.*no se eliminan/)).toBeInTheDocument();
    const reason = within(confirmation).getByRole('textbox', { name: 'Motivo' });
    const submit = within(confirmation).getByRole('button', { name: `Confirmar ${label.toLowerCase()}` });
    expect(submit).toBeDisabled();
    fireEvent.change(reason, { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'a'.repeat(501) } });
    expect(submit).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'a'.repeat(500) } });
    expect(submit).toBeEnabled();
    fireEvent.change(reason, { target: { value: '  Validar ejecución  ' } });
    fireEvent.submit(submit.closest('form')!);
    fireEvent.submit(submit.closest('form')!);
    expect(submit).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const path = `/api/automations/remissions/audi/executions/${detail.executionId}/${action.toLowerCase()}`;
    const revision = action === 'RECONCILE' || action === 'CANCEL' ? { expectedRevision: 'ERROR:5' } : {};
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ reason: 'Validar ejecución', ...revision })
    }));
    const body = action === 'STOP' ? { code: 'TIMEOUT', message: 'private' }
      : { data: { accepted: true, status: 'DISPATCHED', executionId: detail.executionId, actionId: '5' } };
    respond(new Response(JSON.stringify(body), { status: action === 'STOP' ? 504 : 202 }));
    const message = action === 'STOP' ? 'No se pudo confirmar el resultado; revisa el historial antes de reintentar.'
      : 'Acción enviada a n8n. Consulta el historial para ver el resultado.';
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps each known HTTP failure code to a distinct Spanish message and handles uncoded statuses', () => {
    const cases: [number, string][] = [
      [400, 'INVALID_REQUEST'], [403, 'FORBIDDEN'], [403, 'ROLE_NOT_ALLOWED'],
      [403, 'PASSWORD_CHANGE_REQUIRED'], [403, 'CSRF_ORIGIN_NOT_ALLOWED'],
      [404, 'NOT_FOUND'], [409, 'STALE_REVISION'], [409, 'STALE_ATTEMPT'], [409, 'LEGACY_EXECUTION'],
      [409, 'NOT_ELIGIBLE_STATE'], [409, 'PENDING_RECONCILIATION'], [409, 'PARTIAL_ARTIFACTS'], [409, 'REMISSIONS_ISSUED'],
      [409, 'PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION'], [409, 'N8N_RUNNING'], [409, 'OUTSIDE_TEST_SCOPE'],
      [409, 'OUTSIDE_ALLOWED_SCOPE'], [502, 'INVALID_RESPONSE'], [502, 'NETWORK_ERROR'], [503, 'RECOVERY_NOT_INSTALLED'],
      [503, 'INTEGRATION_NOT_CONFIGURED'], [504, 'TIMEOUT']
    ];
    const messages = cases.map(([status, code]) => audiRecoveryErrorMessage(new AudiExecutionsApiError(status, code)));
    expect(new Set(messages).size).toBe(cases.length);
    for (const message of messages) expect(message).not.toMatch(/No se pudo confirmar la acción\./);
    expect(audiRecoveryErrorMessage(new AudiExecutionsApiError(401))).toMatch(/sesión/);
    expect(audiRecoveryErrorMessage(new AudiExecutionsApiError(500))).toMatch(/error interno/);
  });
});
