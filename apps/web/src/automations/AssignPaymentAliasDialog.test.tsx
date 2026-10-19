import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCompanies } from '../services/companies';
import { assignPaymentAlias, CompanyAliasApiError } from '../services/companyAliases';
import { PaymentNotificationFileErrors } from './PaymentNotificationFileErrors';

vi.mock('../services/companies', () => ({ searchCompanies: vi.fn() }));
vi.mock('../services/companyAliases', async (original) => ({
  ...(await original<typeof import('../services/companyAliases')>()), assignPaymentAlias: vi.fn()
}));

const fileError = { fileName: '10.-1800006184145.pdf', detail: '1800006184145', errorCode: 'ALIAS_NO_CATALOGADO', fileHash: 'a'.repeat(64) };
const company = { id: '121', commercialName: 'Empresa elegida', companyType: 'PROVEEDOR' as const, legalName: null, rfc: 'AAA010101AAA', matchedAlias: null };

async function openAndSelect() {
  render(<PaymentNotificationFileErrors fileErrors={[fileError]} titleId="errors" />);
  fireEvent.click(screen.getByRole('button', { name: 'Asignar alias' }));
  expect(screen.getByLabelText('Alias detectado')).toHaveValue('1800006184145');
  await userEvent.type(screen.getByRole('combobox'), 'Empresa');
  fireEvent.click(await screen.findByRole('option', { name: /Empresa elegida/ }));
}

describe('assigning permanent aliases from file errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchCompanies).mockResolvedValue([company]);
  });

  it('searches existing companies, requires server-requested confirmation, and preserves the original error after saving', async () => {
    vi.mocked(assignPaymentAlias)
      .mockRejectedValueOnce(new CompanyAliasApiError(400, 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED', null))
      .mockResolvedValueOnce({ companyId: '121', companyName: company.commercialName, alias: fileError.detail, normalizedAlias: fileError.detail, alreadyAssigned: false });
    await openAndSelect();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(await screen.findByText(/parece un número de documento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(await screen.findByText(/Alias permanente guardado para Empresa elegida/)).toBeInTheDocument();
    expect(assignPaymentAlias).toHaveBeenLastCalledWith('121', '1800006184145', true);
    expect(screen.getByText('ALIAS_NO_CATALOGADO')).toBeInTheDocument();
    expect(screen.getByText(fileError.fileName)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('displays conflicts without closing the reviewed form', async () => {
    vi.mocked(assignPaymentAlias).mockRejectedValue(new CompanyAliasApiError(409, 'ALIAS_ALREADY_ASSOCIATED', null));
    await openAndSelect();
    fireEvent.change(screen.getByLabelText('Alias detectado'), { target: { value: 'Alias revisado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(await screen.findByText(/nombre comercial de otra empresa/)).toBeInTheDocument();
    expect(screen.getByLabelText('Alias detectado')).toHaveValue('Alias revisado');
    expect(assignPaymentAlias).toHaveBeenCalledWith('121', 'Alias revisado', false);
  });

  it('requires a new selection when the company search is edited', async () => {
    await openAndSelect();
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeEnabled();
    await userEvent.type(screen.getByRole('combobox'), ' distinta');
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeDisabled();
    expect(assignPaymentAlias).not.toHaveBeenCalled();
  });

  it('only offers assignment for uncatalogued aliases and cancellation never persists', async () => {
    render(<PaymentNotificationFileErrors fileErrors={[fileError, { ...fileError, errorCode: 'ALIAS_AMBIGUO', fileHash: 'b'.repeat(64) }]} titleId="errors" />);
    expect(screen.getAllByRole('button', { name: 'Asignar alias' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Asignar alias' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(assignPaymentAlias).not.toHaveBeenCalled();
  });
});
