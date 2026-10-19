import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCompanies } from '../services/companies';
import { assignPaymentAlias, managePaymentAlias, CompanyAliasApiError, type PaymentAliasResolution, type PaymentAliasRecord } from '../services/companyAliases';
import { getPaymentNotificationExecution, type PaymentNotificationExecutionDetail } from '../services/paymentNotifications';
import { PaymentNotificationExecutionDetailPage } from './PaymentNotificationExecutionDetailPage';

vi.mock('../services/companies', () => ({ searchCompanies: vi.fn() }));
vi.mock('../services/companyAliases', async (original) => ({
  ...(await original<typeof import('../services/companyAliases')>()), assignPaymentAlias: vi.fn(), managePaymentAlias: vi.fn()
}));
vi.mock('../services/paymentNotifications', async (original) => ({ ...(await original<typeof import('../services/paymentNotifications')>()), getPaymentNotificationExecution: vi.fn() }));

const fileError = { fileName: 'comprobante-prueba.pdf', detail: 'TEST ALIAS', errorCode: 'ALIAS_NO_CATALOGADO', fileHash: 'a'.repeat(64) };
const company = { id: '122', commercialName: 'Empresa B', companyType: 'PROVEEDOR' as const, legalName: null, rfc: 'AAA010101AAA', matchedAlias: null };
const record: PaymentAliasRecord = { aliasId: '5', companyId: '121', companyName: 'Empresa A', alias: 'TEST ALIAS', normalizedAlias: 'TEST ALIAS', status: 'ACTIVO', type: 'NOMBRE_ARCHIVO', updatedAt: '2026-10-19 10:00:00.123456+00' };
let current: PaymentAliasResolution;
function assigned(value = record): PaymentAliasResolution { return { alias: fileError.detail, normalizedAlias: 'TEST ALIAS', state: 'ACTIVE', assignment: value, company: { id: value.companyId, name: value.companyName } }; }
function detail(): PaymentNotificationExecutionDetail {
  return { executionId: '32', createdAt: '2026-10-19T10:00:00Z', processedAt: null, processingStatus: 'ERROR', outcomeStatus: 'FAILED',
    totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0, fileErrors: 1, summarySent: false, summarySentAt: null,
    reviewStatus: null, reprocessAvailable: true, results: [], fileErrorDetails: [{ ...fileError, aliasResolution: current }] };
}
function renderFiles() { return render(<MemoryRouter initialEntries={['/automations/payment-notifications/32']}><Routes>
  <Route path="/automations/payment-notifications/:executionId" element={<PaymentNotificationExecutionDetailPage />} />
</Routes></MemoryRouter>); }
async function openFile(action?: string) {
  if (action === 'Asignar alias') { fireEvent.click(await screen.findByRole('button', { name: action })); return; }
  fireEvent.click(await screen.findByRole('button', { name: 'Gestionar alias' }));
  if (action) fireEvent.click(await screen.findByRole('button', { name: action }));
}
async function selectCompany() {
  await userEvent.type(screen.getByRole('combobox'), 'Empresa B');
  fireEvent.click(await screen.findByRole('option', { name: /Empresa B/ }));
}

describe('compact file alias management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    current = { alias: fileError.detail, normalizedAlias: 'TEST ALIAS', state: 'UNASSIGNED', assignment: null, company: null };
    vi.mocked(searchCompanies).mockResolvedValue([company]);
    vi.mocked(getPaymentNotificationExecution).mockImplementation(async () => detail());
  });

  it('renders compact rows and opens one file modal without repeating action buttons', async () => {
    current = assigned();
    renderFiles();
    expect(await screen.findByText('Asignado')).toBeInTheDocument();
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Asignar alias' })).not.toBeInTheDocument();
    expect(screen.queryByText('ALIAS_NO_CATALOGADO')).not.toBeInTheDocument();
    await openFile();
    expect(await screen.findByRole('button', { name: 'Cambiar empresa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar alias' })).toBeInTheDocument();
    expect(screen.getByText(/Error histórico reportado por n8n: ALIAS_NO_CATALOGADO/)).toBeInTheDocument();
  });

  it('assigns with server-requested numeric confirmation and re-reads persisted state', async () => {
    vi.mocked(assignPaymentAlias).mockRejectedValueOnce(new CompanyAliasApiError(400, 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED', null))
      .mockImplementationOnce(async () => {
        current = assigned({ ...record, companyId: company.id, companyName: company.commercialName });
        return { companyId: company.id, companyName: company.commercialName, alias: 'TEST ALIAS', normalizedAlias: 'TEST ALIAS', alreadyAssigned: false };
      });
    const view = renderFiles();
    expect(await screen.findByText('Sin asignar')).toBeInTheDocument();
    await openFile('Asignar alias');
    expect(screen.getByLabelText('Alias permanente')).toHaveValue('TEST ALIAS');
    await selectCompany();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(await screen.findByText(/parece un número de documento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(await screen.findByText('Cambio guardado.')).toBeInTheDocument();
    expect(assignPaymentAlias).toHaveBeenLastCalledWith('122', 'TEST ALIAS', true);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de reproceso')).toBeInTheDocument();
    view.unmount(); renderFiles();
    expect(await screen.findByText('Asignado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Asignar alias' })).not.toBeInTheDocument();
    expect(getPaymentNotificationExecution).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
  });

  it('requires explicit reassignment confirmation and updates the row without page reload', async () => {
    current = assigned();
    vi.mocked(managePaymentAlias).mockImplementationOnce(async () => {
      const updated = { ...record, companyId: company.id, companyName: company.commercialName, updatedAt: 'new-version' };
      current = assigned(updated); return updated;
    });
    renderFiles(); await openFile('Cambiar empresa');
    expect(screen.getByText(/Asignación actual: TEST ALIAS → Empresa A/)).toBeInTheDocument();
    await selectCompany();
    expect(screen.getByRole('button', { name: 'Confirmar cambio' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambio' }));
    expect(await screen.findByText('Cambio guardado.')).toBeInTheDocument();
    expect(managePaymentAlias).toHaveBeenCalledWith(record, 'REASSIGN', '122');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByText('Empresa B')).toBeInTheDocument();
    expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
    expect(assignPaymentAlias).not.toHaveBeenCalled();
  });

  it('deactivates with confirmation, keeps the historical error and shows the inactive state', async () => {
    current = assigned();
    vi.mocked(managePaymentAlias).mockImplementationOnce(async () => {
      const updated = { ...record, status: 'INACTIVO' as const };
      current = { ...current, state: 'INACTIVE', assignment: updated, company: null }; return updated;
    });
    renderFiles(); await openFile('Desactivar alias');
    expect(screen.getByRole('button', { name: 'Confirmar desactivación' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    expect(await screen.findByText('Cambio guardado.')).toBeInTheDocument();
    expect(managePaymentAlias).toHaveBeenCalledWith(record, 'DEACTIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByText('Alias desactivado')).toBeInTheDocument();
    expect(screen.getByText('Sin asignar')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente de reproceso')).not.toBeInTheDocument();
  });

  it('does not persist when a destructive action is cancelled', async () => {
    current = assigned(); renderFiles(); await openFile('Desactivar alias');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Cambiar empresa' })).toBeInTheDocument();
    expect(managePaymentAlias).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'ALIAS_ALREADY_ASSOCIATED', /nombre comercial de otra empresa/],
    [403, 'ROLE_NOT_ALLOWED', /No tienes permisos/]
  ] as const)('shows a safe mutation error for HTTP %s', async (status, code, message) => {
    current = assigned();
    vi.mocked(managePaymentAlias).mockRejectedValue(new CompanyAliasApiError(status, code, null));
    renderFiles(); await openFile('Cambiar empresa'); await selectCompany();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambio' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refreshes a stale snapshot without automatically retrying the mutation', async () => {
    current = assigned();
    vi.mocked(managePaymentAlias).mockImplementation(async () => {
      current = assigned({ ...record, companyId: '123', companyName: 'Empresa C', updatedAt: 'new-version' });
      throw new CompanyAliasApiError(409, 'ALIAS_STATE_CHANGED', null);
    });
    renderFiles(); await openFile('Desactivar alias');
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    expect(await screen.findByText(/modificado por otra operación/)).toBeInTheDocument();
    expect(screen.getByText('Empresa asignada: Empresa C')).toBeInTheDocument();
    expect(managePaymentAlias).toHaveBeenCalledOnce();
  });

  it('does not offer management when the current catalog cannot be read', async () => {
    vi.mocked(getPaymentNotificationExecution).mockResolvedValue({ ...detail(), fileErrorDetails: [{ ...fileError, aliasResolution: null }] });
    renderFiles(); expect(await screen.findByText('Estado no disponible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(screen.queryByRole('button', { name: 'Asignar alias' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar alias' })).not.toBeInTheDocument();
  });

  it('invalidates company selection and confirmation when the search changes', async () => {
    current = assigned(); renderFiles(); await openFile('Cambiar empresa'); await selectCompany();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirmar cambio' })).toBeEnabled();
    await userEvent.type(screen.getByRole('combobox'), ' distinta');
    expect(screen.getByRole('button', { name: 'Confirmar cambio' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('renders names and errors as text without exposing file hashes', async () => {
    vi.mocked(getPaymentNotificationExecution).mockResolvedValue({ ...detail(), fileErrorDetails: [{ ...fileError, fileName: '<b>file</b>.pdf', aliasResolution: current }] });
    renderFiles();
    await waitFor(() => expect(screen.getByText('Sin asignar')).toBeInTheDocument());
    expect(screen.queryByText(fileError.fileHash)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Asignar alias' }));
    expect(within(screen.getByRole('dialog')).getByText('<b>file</b>.pdf')).toBeInTheDocument();
  });
});
