import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompanyAddress, deactivateCompanyAddress, listCompanyAddresses, reactivateCompanyAddress, updateCompanyAddress, type CompanyAddress } from '../services/companyAddresses';
import { CompanyAddressesSection } from './CompanyAddressesSection';
import { formatCompanyAddress } from './companyAddressDisplay';

vi.mock('../services/companyAddresses', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAddresses')>()), listCompanyAddresses: vi.fn(), createCompanyAddress: vi.fn(), updateCompanyAddress: vi.fn(), deactivateCompanyAddress: vi.fn(), reactivateCompanyAddress: vi.fn() }));
const listMock = vi.mocked(listCompanyAddresses); const createMock = vi.mocked(createCompanyAddress); const updateMock = vi.mocked(updateCompanyAddress); const deactivateMock = vi.mocked(deactivateCompanyAddress); const reactivateMock = vi.mocked(reactivateCompanyAddress);
const base: CompanyAddress = { id: 'a1', companyId: '121', tipoDireccion: 'ENTREGA', calle: 'Av. Industria', numeroExterior: '100', numeroInterior: 'B', colonia: 'Centro', codigoPostal: '37000', municipio: 'León', estado: 'Guanajuato', pais: 'México', direccionCompleta: null, referencias: 'Portón azul', esPrincipal: true, fechaInicio: '2026-01-01', fechaFin: null, estatus: 'ACTIVA' };

afterEach(() => vi.clearAllMocks());

describe('CompanyAddressesSection', () => {
  it('loads independently and supports retry and the true empty state', async () => {
    let resolve!: (value: CompanyAddress[]) => void; listMock.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce([]);
    const { rerender } = render(<CompanyAddressesSection companyId="121" />);
    expect(screen.getByLabelText('Cargando direcciones')).toBeInTheDocument(); resolve([]);
    expect(await screen.findByText('No hay direcciones registradas para esta empresa.')).toBeInTheDocument();
    rerender(<CompanyAddressesSection companyId="122" />);
    expect(await screen.findByText('No fue posible cargar las direcciones.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay direcciones registradas para esta empresa.')).toBeInTheDocument();
    expect(listMock).toHaveBeenLastCalledWith('122');
  });

  it('prefers direccionCompleta and otherwise formats partial structured data without stray separators', () => {
    expect(formatCompanyAddress({ ...base, direccionCompleta: '  Texto auditado completo  ', calle: 'Ignorada' })).toBe('Texto auditado completo');
    expect(formatCompanyAddress({ ...base, direccionCompleta: null, calle: 'Calle larga', numeroExterior: null, numeroInterior: '2', colonia: null, municipio: null, estado: 'Jalisco', codigoPostal: null, pais: null })).toBe('Calle larga Int. 2, Jalisco');
    expect(formatCompanyAddress({ ...base, direccionCompleta: null, calle: null, numeroExterior: null, numeroInterior: null, colonia: null, municipio: null, estado: null, codigoPostal: null, pais: null })).toBe('Sin detalles de dirección.');
  });

  it('renders long addresses with safe wrapping', async () => {
    const longAddress = `Corredor industrial ${'Norte'.repeat(80)}`;
    listMock.mockResolvedValue([{ ...base, direccionCompleta: longAddress }]);
    render(<CompanyAddressesSection companyId="121" />);

    expect(await screen.findByText(longAddress)).toHaveStyle({ overflowWrap: 'anywhere' });
  });

  it('shows Spanish type, primary and active indicators while hiding inactive addresses until requested', async () => {
    listMock.mockResolvedValue([base, { ...base, id: 'a2', tipoDireccion: 'OPERATIVA', calle: 'Patio anterior', esPrincipal: false, estatus: 'INACTIVA' }]); render(<CompanyAddressesSection companyId="121" />);
    expect(await screen.findByText('Entrega')).toBeInTheDocument(); expect(screen.getByText('Principal')).toBeInTheDocument(); expect(screen.getByText('Activa')).toBeInTheDocument(); expect(screen.queryByText(/Patio anterior/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mostrar direcciones inactivas (1)' }));
    expect(screen.getByText(/Patio anterior/)).toBeInTheDocument(); expect(screen.getByText('Operativa')).toBeInTheDocument(); expect(screen.getByText('Inactiva')).toBeInTheDocument();
  });

  it('adds an address with every schema field normalized', async () => {
    listMock.mockResolvedValue([]); createMock.mockImplementation(async (_companyId, input) => ({ address: { id: 'new', companyId: '121', estatus: 'ACTIVA', ...input }, requestId: null })); const user = userEvent.setup(); render(<CompanyAddressesSection companyId="121" />); await screen.findByText('No hay direcciones registradas para esta empresa.');
    await user.click(screen.getByRole('button', { name: 'Agregar dirección' })); const dialog = screen.getByRole('dialog', { name: 'Agregar dirección' });
    const labels = ['Dirección completa', 'Calle', 'Número exterior', 'Número interior', 'Colonia', 'Código postal', 'Municipio o alcaldía', 'Estado', 'País', 'Referencias', 'Fecha de inicio', 'Fecha de fin', 'Dirección principal']; labels.forEach((label) => expect(within(dialog).getByLabelText(label)).toBeInTheDocument());
    await user.click(within(dialog).getByRole('combobox', { name: 'Tipo de dirección' })); for (const label of ['Fiscal', 'Comercial', 'Operativa', 'Entrega', 'Facturación', 'Otra']) expect(screen.getByRole('option', { name: label })).toBeInTheDocument(); await user.click(screen.getByRole('option', { name: 'Facturación' }));
    fireEvent.change(within(dialog).getByLabelText('Dirección completa'), { target: { value: ' Av. Uno 20 ' } }); fireEvent.change(within(dialog).getByLabelText('Número exterior'), { target: { value: ' 20 ' } }); fireEvent.change(within(dialog).getByLabelText('Fecha de inicio'), { target: { value: '2026-09-02' } }); await user.click(within(dialog).getByLabelText('Dirección principal')); await user.click(within(dialog).getByRole('button', { name: 'Agregar dirección' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith('121', expect.objectContaining({ tipoDireccion: 'FACTURACION', direccionCompleta: 'Av. Uno 20', calle: null, numeroExterior: '20', esPrincipal: true, colonia: null, referencias: null, fechaInicio: '2026-09-02', fechaFin: null })));
    expect(await screen.findByText('Av. Uno 20')).toBeInTheDocument();
  });

  it('requires exactly direccionCompleta or calle for address content', async () => {
    listMock.mockResolvedValue([]); const user = userEvent.setup(); render(<CompanyAddressesSection companyId="121" />); await screen.findByText('No hay direcciones registradas para esta empresa.');
    await user.click(screen.getByRole('button', { name: 'Agregar dirección' })); const dialog = screen.getByRole('dialog', { name: 'Agregar dirección' });
    await user.type(within(dialog).getByLabelText('Colonia'), 'Centro'); await user.click(within(dialog).getByRole('button', { name: 'Agregar dirección' }));
    expect(screen.getByText('Ingresa la dirección completa o la calle.')).toBeInTheDocument(); expect(createMock).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Calle'), 'Reforma'); await user.click(within(dialog).getByRole('button', { name: 'Agregar dirección' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  it('edits, deactivates, reveals, and reactivates an address', async () => {
    listMock.mockResolvedValue([base]); updateMock.mockImplementation(async (_id, input) => ({ address: { ...base, ...input }, requestId: null })); deactivateMock.mockResolvedValue({ ...base, estatus: 'INACTIVA' }); reactivateMock.mockResolvedValue(base); const user = userEvent.setup(); render(<CompanyAddressesSection companyId="121" />); await screen.findByText('Av. Industria No. 100 Int. B, Centro, León, Guanajuato, C.P. 37000, México');
    await user.click(screen.getByRole('button', { name: 'Editar' })); const street = screen.getByRole('textbox', { name: 'Calle' }); expect(screen.getByLabelText('Fecha de inicio')).toHaveValue('2026-01-01'); expect(screen.getByLabelText('Referencias')).toHaveValue('Portón azul'); await user.clear(street); await user.type(street, 'Bodega central'); const editDialog = screen.getByRole('dialog', { name: 'Editar dirección' }); await user.click(within(editDialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('a1', expect.objectContaining({ tipoDireccion: 'ENTREGA', calle: 'Bodega central', referencias: 'Portón azul', fechaInicio: '2026-01-01' }))); await waitForElementToBeRemoved(editDialog); expect(await screen.findByText(/Bodega central No. 100/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desactivar' })); const deactivateDialog = screen.getByRole('dialog', { name: 'Desactivar dirección' }); await user.click(within(deactivateDialog).getByRole('button', { name: 'Desactivar' })); await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith('a1')); await waitForElementToBeRemoved(deactivateDialog);
    await user.click(screen.getByRole('button', { name: 'Mostrar direcciones inactivas (1)' })); await user.click(screen.getByRole('button', { name: 'Reactivar' })); await waitFor(() => expect(reactivateMock).toHaveBeenCalledWith('a1'));
  });
});
