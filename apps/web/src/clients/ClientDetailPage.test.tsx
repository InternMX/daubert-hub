import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCompanyAddresses } from '../services/companyAddresses';
import { getCompanyAliases } from '../services/companyAliases';
import { ClientApiError, deactivateClient, getClient, reactivateClient } from '../services/clients';
import { ClientDetailPage } from './ClientDetailPage';

vi.mock('../services/clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/clients')>()),
  getClient: vi.fn(),
  deactivateClient: vi.fn(),
  reactivateClient: vi.fn()
}));
vi.mock('../services/companyAddresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/companyAddresses')>()),
  listCompanyAddresses: vi.fn()
}));
vi.mock('../services/companyAliases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/companyAliases')>()),
  getCompanyAliases: vi.fn()
}));

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/clientAbbreviations')>()),
  listarAbreviaturas: vi.fn().mockResolvedValue({ disponible: true, puedeResolver: false, data: [], conteos: {} })
}));
const getClientMock = vi.mocked(getClient);
const deactivateClientMock = vi.mocked(deactivateClient);
const reactivateClientMock = vi.mocked(reactivateClient);
const listCompanyAddressesMock = vi.mocked(listCompanyAddresses);
const getCompanyAliasesMock = vi.mocked(getCompanyAliases);

function renderPage(path = '/clients/121', state?: { directoryPath: string }) {
  return render(<MemoryRouter initialEntries={[{ pathname: path, state }]}><Routes><Route path="/clients/:clientId" element={<ClientDetailPage />} /><Route path="/clients" element={<div>Directorio de clientes</div>} /></Routes></MemoryRouter>);
}

afterEach(() => vi.clearAllMocks());

describe('ClientDetailPage', () => {
  it('shows read-only client data, notes fallback, and no fiscal state', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Transportes Acme', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Transportes Acme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clients');
    expect(within(screen.getByLabelText('Migas de pan')).getByText('Transportes Acme')).toHaveAttribute('aria-current', 'page');
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.queryByText('Roles')).not.toBeInTheDocument();
    expect(screen.getByText('Sin notas registradas.')).toBeInTheDocument();
    expect(screen.getByText('No hay datos fiscales registrados.')).toBeInTheDocument();
    expect(await screen.findByText('No hay direcciones registradas para esta empresa.')).toBeInTheDocument();
    expect(listCompanyAddressesMock).toHaveBeenCalledWith('121');
    expect(getCompanyAliasesMock).toHaveBeenCalledWith('121');
    expect(screen.getByRole('link', { name: 'Ver contactos' })).toHaveAttribute('href', '/contacts?company=121');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Información general', 'Direcciones', 'Datos fiscales', 'Alias', 'Abreviaturas de código DCMX', 'Contactos relacionados']);
  });

  it('shows fiscal data, multi-role chips, and returns to the filtered directory path', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR', 'CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: 'Pago a 30 días.', fiscal: { id: 'f1', legalName: 'Acme SA de CV', rfc: 'ACM010101AA1', startDate: null, endDate: null } });
    const user = userEvent.setup();
    renderPage('/clients/121', { directoryPath: '/clients?search=Acme&page=2' });

    expect(await screen.findByText('Acme SA de CV')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clients?search=Acme&page=2');
    expect(screen.getByText('ACM010101AA1')).toBeInTheDocument();
    expect(screen.getByText('Proveedor')).toBeInTheDocument();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Volver a clientes' }));
    expect(screen.getByText('Directorio de clientes')).toBeInTheDocument();
  });

  it('shows the CLIENTE lifecycle status, not the company status, for a multi-role client', async () => {
    // company stays ACTIVO (still has PROVEEDOR) while the CLIENTE role itself is inactive.
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'ACTIVO', clientStatus: 'INACTIVO', notes: null, fiscal: null });
    renderPage();

    await screen.findByRole('heading', { name: 'Acme' });
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toBeInTheDocument();
  });

  it.each([
    ['ACTIVO'],
    ['INACTIVO']
  ])('shows Bloqueado, not clientStatus %s, when the company itself is BLOQUEADO', async (clientStatus) => {
    // A BLOQUEADO company must never be presented as a normally active or inactive Client —
    // it is not manageable through the usual deactivate/reactivate flow regardless of the
    // CLIENTE role's own status.
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'CLIENTE', roles: clientStatus === 'ACTIVO' ? ['CLIENTE'] : [], status: 'BLOQUEADO', clientStatus: clientStatus as 'ACTIVO' | 'INACTIVO', notes: null, fiscal: null });
    renderPage();

    await screen.findByRole('heading', { name: 'Acme' });
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
    expect(screen.queryByText('Inactivo')).not.toBeInTheDocument();
  });

  it('preserves an exact BIGINT-style client id in the contacts navigation link', async () => {
    const clientId = '9007199254740993123';
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: clientId, commercialName: 'Acme', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    renderPage(`/clients/${clientId}`);

    await screen.findByRole('heading', { name: 'Acme' });
    expect(screen.getByRole('link', { name: 'Ver contactos' })).toHaveAttribute('href', `/contacts?company=${clientId}`);
  });

  it('shows a directory return for a missing client', async () => {
    getClientMock.mockRejectedValue(new ClientApiError(404, undefined, 'request-404'));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Cliente no encontrado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a clientes' })).toHaveAttribute('href', '/clients');
  });

  it('returns 404 only for a company with no CLIENTE role, never for an inactive one', async () => {
    // A company that never had a CLIENTE role 404s; that is distinct from an inactive
    // CLIENTE, which must remain reachable (covered by the tests above/below).
    getClientMock.mockRejectedValue(new ClientApiError(404, undefined, 'request-no-role'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Cliente no encontrado' })).toBeInTheDocument();
  });

  it('retries a generic error without exposing error details', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockRejectedValueOnce(new ClientApiError(500, undefined, 'request-500')).mockResolvedValueOnce({ id: '121', commercialName: 'Acme', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('No fue posible cargar el cliente. Intenta nuevamente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(getClientMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
  });

  it('deactivates the CLIENTE role without implying other roles are affected', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR', 'CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    deactivateClientMock.mockResolvedValue({ client: { id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'ACTIVO', clientStatus: 'INACTIVO', notes: null, fiscal: null }, requestId: 'request-1' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByRole('button', { name: 'Desactivar cliente' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('El rol de Cliente quedará inactivo.');
    expect(screen.getByRole('dialog')).toHaveTextContent('Los demás roles de esta empresa no se verán afectados.');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Proveedor quedará inactivo');
    await user.click(screen.getByRole('button', { name: 'Desactivar' }));

    await waitFor(() => expect(deactivateClientMock).toHaveBeenCalledWith('121'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toBeInTheDocument();
  });

  it('deactivates a CLIENTE-only client with no other-role caveat', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByRole('button', { name: 'Desactivar cliente' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('El rol de Cliente quedará inactivo.');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Los demás roles');
  });

  it('reactivates the client after deactivation, in the same page session', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR', 'CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    deactivateClientMock.mockResolvedValue({ client: { id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'ACTIVO', clientStatus: 'INACTIVO', notes: null, fiscal: null }, requestId: 'request-2' });
    reactivateClientMock.mockResolvedValue({ client: { id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR', 'CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null }, requestId: 'request-3' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByRole('button', { name: 'Desactivar cliente' }));
    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Reactivar cliente' }));
    await user.click(screen.getByRole('button', { name: 'Reactivar' }));

    await waitFor(() => expect(reactivateClientMock).toHaveBeenCalledWith('121'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desactivar cliente' })).toBeInTheDocument());
  });

  it('remains reachable after a fresh page load (browser refresh) following deactivation, and Reactivar works', async () => {
    // This is the exact lifecycle-discoverability bug: GET /clients/:id previously 404'd
    // once CLIENTE was inactive, making "Reactivar cliente" unreachable after a refresh.
    // A brand-new render (no prior in-memory state) simulates that refresh: getClient
    // must resolve (not reject) and the component must derive "inactive" purely from the
    // clientStatus field on that fresh response.
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'ACTIVO', clientStatus: 'INACTIVO', notes: null, fiscal: null });
    reactivateClientMock.mockResolvedValue({ client: { id: '121', commercialName: 'Acme', companyType: 'PROVEEDOR', roles: ['PROVEEDOR', 'CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null }, requestId: 'request-4' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Acme' });
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reactivar cliente' }));
    await user.click(screen.getByRole('button', { name: 'Reactivar' }));

    await waitFor(() => expect(reactivateClientMock).toHaveBeenCalledWith('121'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desactivar cliente' })).toBeInTheDocument());
  });

  it('remains reachable after a fresh page load when the company itself is also INACTIVO (final-role case)', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'CLIENTE', roles: [], status: 'INACTIVO', clientStatus: 'INACTIVO', notes: null, fiscal: null });
    renderPage();

    await screen.findByRole('heading', { name: 'Acme' });
    expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toBeInTheDocument();
  });

  it('shows a safe lifecycle error without changing status', async () => {
    listCompanyAddressesMock.mockResolvedValue([]);
    getCompanyAliasesMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    getClientMock.mockResolvedValue({ id: '121', commercialName: 'Acme', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, fiscal: null });
    deactivateClientMock.mockRejectedValue({ code: 'CLIENT_ALREADY_INACTIVE' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByRole('button', { name: 'Desactivar cliente' }));
    await user.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByText('No fue posible actualizar el estado del cliente. Intenta nuevamente.')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });
});
