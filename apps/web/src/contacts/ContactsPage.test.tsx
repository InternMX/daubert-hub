import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContact, updateContact } from '../services/contacts';
import { deactivateContactMethod, reactivateContactMethod } from '../services/contactMethods';
import { searchCompanies } from '../services/companies';
import { getContactDirectoryCompany, listContactDirectoryCompanies, type DirectoryContactMethod } from '../services/contactDirectory';
import { ContactsPage } from './ContactsPage';

vi.mock('../services/contactDirectory', () => ({ listContactDirectoryCompanies: vi.fn(), getContactDirectoryCompany: vi.fn() }));
vi.mock('../services/contacts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contacts')>()), createContact: vi.fn(), updateContact: vi.fn() }));
vi.mock('../services/contactMethods', () => ({ deactivateContactMethod: vi.fn(), reactivateContactMethod: vi.fn() }));
vi.mock('../services/companies', () => ({ searchCompanies: vi.fn() }));
const listMock = vi.mocked(listContactDirectoryCompanies); const detailMock = vi.mocked(getContactDirectoryCompany); const createMock = vi.mocked(createContact); const updateMock = vi.mocked(updateContact); const deactivateMock = vi.mocked(deactivateContactMethod); const reactivateMock = vi.mocked(reactivateContactMethod); const companySearchMock = vi.mocked(searchCompanies);
const company = { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const, contactCount: 0 };
const detail = { company: { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const }, contacts: [] };
const lookup = { id: '31', commercialName: 'SILYM', companyType: 'SERVICIO' as const, legalName: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matchedAlias: 'SOLUCIONES INTEGRALES' };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function renderPage(path = '/contacts?company=1&search=almex&page=2&pageSize=25') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/contacts" element={<><ContactsPage /><Location /></>} /></Routes></MemoryRouter>); }
async function selectedPage() { listMock.mockResolvedValue({ data: [company], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue(detail); renderPage(); await screen.findAllByText('ALMEX'); }
async function contextualDrawer() { fireEvent.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[1]!); return screen.findByRole('dialog'); }
async function globalDrawer() { fireEvent.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]!); const drawer = await screen.findByRole('dialog'); await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'Empresa' })).toHaveValue('')); return drawer; }
async function selectMethodType(drawer: HTMLElement, index: number, label: string) { fireEvent.mouseDown(within(drawer).getAllByLabelText('Tipo')[index]!); fireEvent.click(await screen.findByRole('option', { name: label })); }
const activeMethod = { id: '9007199254740993', type: 'CORREO' as const, value: 'activo@example.test', isPrimary: true };
const inactiveMethod = { id: '9007199254740994', type: 'OTRO' as const, value: 'anterior@example.test', isPrimary: false };
function contactDetail(methods: DirectoryContactMethod[] = [activeMethod], inactiveMethods: DirectoryContactMethod[] = [inactiveMethod]) { return { company: detail.company, contacts: [{ id: '20', name: 'Contacto Sintético', contactType: 'PERSONA' as const, area: 'Compras', position: null, notes: 'Nota inicial', isPrimary: false, methods, inactiveMethods }] }; }
async function lifecyclePage(initial = contactDetail()) { listMock.mockResolvedValue({ data: [{ ...company, contactCount: 1 }], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue(initial); renderPage(); await screen.findByText('Contacto Sintético'); }

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

  it('keeps an alias-only server result instead of filtering it by commercial name', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); companySearchMock.mockResolvedValue([lookup]); renderPage('/contacts'); const drawer = await globalDrawer(); const input = within(drawer).getByRole('combobox', { name: 'Empresa' });
    const user = userEvent.setup(); await user.click(input); await user.type(input, 'soluciones inte'); expect(companySearchMock).not.toHaveBeenCalled(); await waitFor(() => expect(companySearchMock).toHaveBeenCalledWith('soluciones inte'), { timeout: 2000 }); expect(await screen.findByRole('option', { name: /SILYM/ })).toBeInTheDocument(); expect(screen.getByText('Coincidencia por alias: SOLUCIONES INTEGRALES')).toBeInTheDocument();
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

describe('ContactsPage contact method lifecycle', () => {
  it('shows only the deactivate action for an active method and cancel sends no request', async () => {
    await lifecyclePage(contactDetail([activeMethod], []));
    expect(screen.queryByText('Medios inactivos (0)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` }));
    expect(await screen.findByRole('menuitem', { name: 'Desactivar' })).toBeInTheDocument();
    expect(screen.queryByText('Editar')).not.toBeInTheDocument(); expect(screen.queryByText('Eliminar')).not.toBeInTheDocument(); expect(screen.queryByText('Confirmar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar medio de contacto' });
    expect(within(dialog).getByText('Este medio dejará de aparecer como activo para este contacto. Podrás reactivarlo posteriormente.')).toBeInTheDocument();
    expect(within(dialog).getByText(`Correo: ${activeMethod.value}`)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(deactivateMock).not.toHaveBeenCalled();
  });

  it('deactivates the correct BIGINT method once, refreshes detail, and preserves URL state', async () => {
    let resolveRequest!: (value: never) => void;
    deactivateMock.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const refreshed = contactDetail([], [activeMethod]);
    await lifecyclePage(contactDetail([activeMethod], []));
    detailMock.mockResolvedValue(refreshed);
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog'); const submit = within(dialog).getByRole('button', { name: 'Desactivar' }); fireEvent.click(submit); fireEvent.click(submit);
    expect(deactivateMock).toHaveBeenCalledTimes(1); expect(deactivateMock).toHaveBeenCalledWith('9007199254740993');
    resolveRequest({} as never);
    expect(await screen.findByText('Medio de contacto desactivado.')).toBeInTheDocument();
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Contacto Sintético')).toBeInTheDocument(); expect(screen.getByText('Sin medios activos')).toBeInTheDocument(); expect(screen.getByText('Medios inactivos (1)')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });

  it('keeps inactive methods collapsed, expands them, and reactivates without confirmation', async () => {
    reactivateMock.mockResolvedValue({} as never);
    await lifecyclePage(contactDetail([], [inactiveMethod]));
    const toggle = screen.getByRole('button', { name: 'Medios inactivos (1)' }); expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(inactiveMethod.value)).not.toBeVisible(); fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByText(inactiveMethod.value)).toBeVisible();
    detailMock.mockResolvedValue(contactDetail([inactiveMethod], []));
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Otro: ${inactiveMethod.value}` }));
    expect(await screen.findByRole('menuitem', { name: 'Reactivar' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivar' }));
    expect(reactivateMock).toHaveBeenCalledWith('9007199254740994'); expect(await screen.findByText('Medio de contacto reactivado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Medios inactivos (1)')).not.toBeInTheDocument()); expect(screen.getByText(inactiveMethod.value)).toBeVisible();
  });

  it('shows safe lifecycle errors without removing the contact', async () => {
    deactivateMock.mockRejectedValue(new Error('backend internals')); await lifecyclePage(contactDetail([activeMethod], []));
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Desactivar' })); fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('No fue posible desactivar el medio de contacto.')).toBeInTheDocument(); expect(screen.queryByText('backend internals')).not.toBeInTheDocument(); expect(screen.getByText('Contacto Sintético')).toBeInTheDocument();
  });
});

describe('ContactsPage contact editing', () => {
  it('shows a distinct contact menu containing only Editar contacto', async () => {
    await lifecyclePage(contactDetail([activeMethod], [])); expect(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' }));
    expect(await screen.findByRole('menuitem', { name: 'Editar contacto' })).toBeInTheDocument(); expect(screen.queryByText('Desactivar contacto')).not.toBeInTheDocument(); expect(screen.queryByText('Eliminar contacto')).not.toBeInTheDocument(); expect(screen.queryByText('Cambiar empresa')).not.toBeInTheDocument(); expect(screen.queryByText('Cambiar tipo')).not.toBeInTheDocument();
  });

  it('opens from the contact menu, refreshes on success, and preserves URL state', async () => {
    const initial = contactDetail([activeMethod], []); const refreshed = { ...initial, contacts: [{ ...initial.contacts[0]!, name: 'Contacto Actualizado', area: 'Compras y Abastecimiento', position: null, notes: 'Nota actualizada' }] };
    updateMock.mockResolvedValue({ contact: { id: '20', companyId: '1', contactType: 'PERSONA', name: 'Contacto Actualizado', area: 'Compras y Abastecimiento', position: null, notes: 'Nota actualizada', status: 'ACTIVO', isPrimary: false }, requestId: 'request-edit' });
    await lifecyclePage(initial); detailMock.mockResolvedValue(refreshed); fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar contacto' }));
    const drawer = await screen.findByRole('dialog'); const form = within(drawer); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Contacto Actualizado' } }); fireEvent.change(form.getByRole('textbox', { name: 'Área' }), { target: { value: 'Compras y Abastecimiento' } }); fireEvent.change(form.getByRole('textbox', { name: 'Cargo' }), { target: { value: '' } }); fireEvent.change(form.getByRole('textbox', { name: 'Observaciones' }), { target: { value: 'Nota actualizada' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('20', { name: 'Contacto Actualizado', area: 'Compras y Abastecimiento', notes: 'Nota actualizada' }));
    expect(await screen.findByText('Contacto actualizado correctamente.')).toBeInTheDocument(); await waitFor(() => expect(screen.queryByText('Editar contacto')).not.toBeInTheDocument()); expect(screen.getByText('Contacto Actualizado')).toBeInTheDocument(); expect(screen.getByText('Compras y Abastecimiento')).toBeInTheDocument(); await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2)); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });
});
