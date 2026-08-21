import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContact } from '../services/contacts';
import { searchCompanies } from '../services/companies';
import { getContactDirectoryCompany, listContactDirectoryCompanies } from '../services/contactDirectory';
import { ContactsPage } from './ContactsPage';

vi.mock('../services/contactDirectory', () => ({ listContactDirectoryCompanies: vi.fn(), getContactDirectoryCompany: vi.fn() }));
vi.mock('../services/contacts', () => ({ createContact: vi.fn() }));
vi.mock('../services/companies', () => ({ searchCompanies: vi.fn() }));
const listMock = vi.mocked(listContactDirectoryCompanies); const detailMock = vi.mocked(getContactDirectoryCompany); const createMock = vi.mocked(createContact); const companySearchMock = vi.mocked(searchCompanies);
const company = { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const, contactCount: 0 };
const detail = { company: { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const }, contacts: [] };
const lookup = { id: '31', commercialName: 'SILYM', companyType: 'SERVICIO' as const, legalName: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matchedAlias: 'SOLUCIONES INTEGRALES' };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function renderPage(path = '/contacts?company=1&search=almex&page=2&pageSize=25') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/contacts" element={<><ContactsPage /><Location /></>} /></Routes></MemoryRouter>); }
async function selectedPage() { listMock.mockResolvedValue({ data: [company], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue(detail); renderPage(); await screen.findAllByText('ALMEX'); }
async function contextualDrawer() { fireEvent.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[1]!); return screen.findByRole('dialog'); }
async function globalDrawer() { fireEvent.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]!); const drawer = await screen.findByRole('dialog'); await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'Empresa' })).toHaveValue('')); return drawer; }
async function selectMethodType(drawer: HTMLElement, index: number, label: string) { fireEvent.mouseDown(within(drawer).getAllByLabelText('Tipo')[index]!); fireEvent.click(await screen.findByRole('option', { name: label })); }

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('ContactsPage global creation', () => {
  it('renders the global action and opens a company autocomplete with no selected company', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); renderPage('/contacts');
    expect(await screen.findByRole('button', { name: 'Agregar contacto' })).toBeInTheDocument();
    const drawer = await globalDrawer(); expect(within(drawer).getByRole('combobox', { name: 'Empresa' })).toBeInTheDocument(); expect(within(drawer).queryByText('ALMEX')).not.toBeInTheDocument();
  });

  it('keeps the company fixed and hides autocomplete in contextual mode', async () => {
    await selectedPage(); const drawer = await contextualDrawer();
    expect(within(drawer).getByText('Empresa')).toBeInTheDocument(); expect(within(drawer).getByText('ALMEX')).toBeInTheDocument(); expect(within(drawer).queryByRole('combobox', { name: 'Empresa' })).not.toBeInTheDocument();
  });

  it('debounces the company lookup', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); companySearchMock.mockResolvedValue([lookup]); renderPage('/contacts'); const drawer = await globalDrawer(); const input = within(drawer).getByRole('combobox', { name: 'Empresa' });
    const user = userEvent.setup(); await user.click(input); await user.type(input, 'sol'); expect(companySearchMock).not.toHaveBeenCalled(); await waitFor(() => expect(companySearchMock).toHaveBeenCalledWith('sol'), { timeout: 2000 });
  });

  it('requires an explicit result selection and posts that company ID', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); companySearchMock.mockResolvedValue([{ ...lookup, matchedAlias: null, commercialName: 'SOLUCIONES EN DESARROLLO' }]); createMock.mockResolvedValue({ contact: { id: '9' } as never, requestId: 'request-1' }); renderPage('/contacts?search=keep&page=2'); const drawer = await globalDrawer(); const form = within(drawer); const input = form.getByRole('combobox', { name: 'Empresa' });
    const user = userEvent.setup(); await user.click(input); await user.type(input, 'sol'); await waitFor(() => expect(companySearchMock).toHaveBeenCalledWith('sol')); fireEvent.click(await screen.findByText('SOLUCIONES EN DESARROLLO')); expect(screen.queryByText(/Coincidencia por alias:/)).not.toBeInTheDocument();
    fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'María' } }); fireEvent.change(form.getByRole('textbox', { name: 'Valor' }), { target: { value: 'maria@example.test' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ companyId: '31', contactType: 'PERSONA', name: 'María', area: null, position: null, notes: null, methods: [{ type: 'CORREO', value: 'maria@example.test' }] })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(await screen.findByText('Contacto registrado correctamente.')).toBeInTheDocument(); expect(screen.getByTestId('location')).toHaveTextContent('search=keep&page=2');
  });

  it('does not submit typed but unselected company text and Cancelar clears it', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); renderPage('/contacts'); const drawer = await globalDrawer(); const form = within(drawer); fireEvent.change(form.getByRole('combobox', { name: 'Empresa' }), { target: { value: 'ALM' } }); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'María' } }); fireEvent.change(form.getByRole('textbox', { name: 'Valor' }), { target: { value: 'maria@example.test' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' })); expect(await form.findByText('Selecciona una empresa existente.')).toBeInTheDocument(); expect(createMock).not.toHaveBeenCalled(); fireEvent.click(form.getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(createMock).not.toHaveBeenCalled();
  });

  it('retains contact form behavior, methods, contextual refresh, and URL state', async () => {
    createMock.mockResolvedValue({ contact: { id: '9' } as never, requestId: 'request-1' }); await selectedPage(); const drawer = await contextualDrawer(); const form = within(drawer); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: ' María López ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Área' }), { target: { value: ' Compras ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Cargo' }), { target: { value: ' Compradora ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Valor' }), { target: { value: ' maria@example.test ' } }); fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); await selectMethodType(drawer, 1, 'Teléfono'); await selectMethodType(drawer, 2, 'WhatsApp'); const values = form.getAllByRole('textbox', { name: 'Valor' }); fireEvent.change(values[1]!, { target: { value: '+52 449 555 0101' } }); fireEvent.change(values[2]!, { target: { value: '+52 449 555 0102' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ companyId: '1', contactType: 'PERSONA', name: 'María López', area: 'Compras', position: 'Compradora', notes: null, methods: [{ type: 'CORREO', value: 'maria@example.test' }, { type: 'TELEFONO', value: '+52 449 555 0101' }, { type: 'WHATSAPP', value: '+52 449 555 0102' }] })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(detailMock.mock.calls.length).toBeGreaterThan(1); expect(listMock.mock.calls.length).toBeGreaterThan(1); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });
});
